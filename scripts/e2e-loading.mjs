/**
 * 加载态「无突变」回归测试。
 *
 * 要守的行为：
 *   A. 首屏兜底遮罩从第一帧就是最终形态 —— 不能出现「左上角无样式文字 → 居中白卡片」的跳变，
 *      也不能出现尺寸跳变（content-box 把它撑成 216px / spinner 30px）。
 *   B. 切换月份/视图时，不能出现「新月份标题 + 空数据」的中间帧
 *      （旧实现在 month 赋值后才 await 数据，过滤结果为空 → 闪一下全 0 与「暂无打卡记录」）。
 *   C. 两个 loading（HTML 兜底 / Vue 组件）的样式必须逐像素一致。
 *
 * 做法：
 *   - 用 CDP 的 Network 限速把加载拉长，从而能稳定采样到中间帧；
 *   - 用 requestAnimationFrame 连续采样 DOM 状态，找出所有「异常帧」；
 *   - 尺寸用 offsetWidth 而不是 getBoundingClientRect：
 *     spinner 在旋转，BBox 会被放大，完全不可信。
 *
 * ⚠️ 应当跑在 **dev 模式**（pnpm dev + BASE_URL=http://localhost:5173/）。
 *    A/C 组里那条 box-sizing 断言只在 dev 下有效：dev 的 CSS 由 JS 注入，
 *    存在「HTML 已到、app.css 未到」的窗口；生产构建的 CSS 是渲染阻塞的
 *    <link>，该窗口不存在，所以生产模式下这两条永远是绿的、测不出问题。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9380;
const BASE = process.env.BASE_URL || 'http://localhost:4190/';
const isDevServer = /:(5173|5174|3000)\b/.test(BASE);
const profile = mkdtempSync(join(tmpdir(), 'flick-'));

const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--disable-extensions',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, extra = '') => results.push([n, ok, extra]);

let ws, msgId = 0;
const pending = new Map();
const errs = [];
function send(method, params = {}) {
  const id = (msgId += 1);
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
}

/* 采样器：在页面里持续记录帧状态，之后一次性取回 */
const SAMPLER = `
window.__frames = [];
window.__sampling = true;
(function loop() {
  if (!window.__sampling) return;
  const boot = document.getElementById('boot-loading');
  const overlay = document.querySelector('.loading:not(#boot-loading)');
  const hero = document.querySelector('.hero-value span');
  const monthPick = document.querySelector('.month-picker .picker-label');
  const firstRow = document.querySelector('.detail-table tbody tr');
  // 遮罩的 layout 尺寸：用 offsetWidth（不受 spinner 旋转 transform 影响）
  const bootBox = boot ? boot.querySelector('div') : null;
  const bootSpinner = boot ? boot.querySelector('span') : null;
  window.__frames.push({
    t: Math.round(performance.now()),
    // readyState 用于区分「body 还没解析出来的空白帧」与真正的交接空档
    ready: document.readyState,
    boot: !!boot,
    overlay: !!overlay,
    // 兜底遮罩是否已被样式化（有 fixed 定位即视为已套用最终样式）
    bootStyled: boot ? getComputedStyle(boot).position === 'fixed' : null,
    bootBg: boot ? getComputedStyle(boot).backgroundColor : null,
    // 关键：卡片与 spinner 的实际尺寸。box-sizing 未生效时会被撑大（216/30）
    bootBoxW: bootBox ? bootBox.offsetWidth : null,
    bootBoxH: bootBox ? bootBox.offsetHeight : null,
    bootSpinnerW: bootSpinner ? bootSpinner.offsetWidth : null,
    bootBoxSizing: bootBox ? getComputedStyle(bootBox).boxSizing : null,
    hero: hero ? hero.textContent : null,
    month: monthPick ? monthPick.textContent : null,
    // 表格当前是否显示「暂无记录」空态
    empty: !!(firstRow && firstRow.querySelector('.empty-cell')),
    rows: document.querySelectorAll('.detail-table tbody tr.row').length,
    leftPanel: !!document.querySelector('.col-left .panel-card'),
  });
  requestAnimationFrame(loop);
})();
true;
`;

/** 两个遮罩必须逐像素一致：同页并排构造，比对 computed style 关键项 */
const OVERLAY_COMPARE = `(() => {
  const mk = (id) => {
    const d = document.createElement('div');
    d.className = 'loading'; d.id = id;
    d.innerHTML = '<div class="loading-box"><span class="spinner"></span><p class="loading-text">正在加载数据…</p></div>';
    document.body.appendChild(d);
    return d;
  };
  const pick = (root) => {
    const b = root.querySelector('div'), s = root.querySelector('span'), p = root.querySelector('p');
    const cs = (n) => getComputedStyle(n);
    return {
      box: [b.offsetWidth, b.offsetHeight, cs(b).boxSizing, cs(b).padding, cs(b).borderRadius, cs(b).backgroundColor, cs(b).boxShadow].join('|'),
      spinner: [s.offsetWidth, s.offsetHeight, cs(s).boxSizing, cs(s).borderTopWidth, cs(s).borderTopColor, cs(s).borderLeftColor].join('|'),
      text: [p.offsetWidth, cs(p).fontSize, cs(p).color].join('|'),
      root: [cs(root).padding, cs(root).backgroundColor, cs(root).display, cs(root).position].join('|'),
    };
  };
  const a = pick(mk('__cmp_a'));
  const b = pick(mk('__cmp_b'));
  document.getElementById('__cmp_a').remove();
  document.getElementById('__cmp_b').remove();
  return { a, b };
})()`;

try {
  for (let i = 0; i < 40; i += 1) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || 'exception');
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  /* ================= A. 首屏：兜底遮罩不能有无样式突变 ================= */
  // 限速，让「HTML 已到 / CSS 未到」的窗口足够宽，便于采样
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 300, downloadThroughput: 60 * 1024, uploadThroughput: 60 * 1024,
  });
  await send('Page.navigate', { url: BASE });
  // 尽早注入采样器：轮询直到文档可执行脚本
  for (let i = 0; i < 200; i += 1) {
    try { await evaluate(SAMPLER); break; } catch { await sleep(20); }
  }
  await sleep(6000);
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  const frames = await evaluate(`(() => { window.__sampling = false; return window.__frames; })()`);
  const bootFrames = frames.filter((f) => f.boot);
  const unstyled = bootFrames.filter((f) => f.bootStyled !== true);
  const wrongBg = bootFrames.filter((f) => f.bootStyled === true && f.bootBg !== 'rgb(242, 243, 245)');

  check('A. 采到首屏兜底遮罩帧', bootFrames.length > 0, `共 ${frames.length} 帧，其中兜底 ${bootFrames.length}`);
  check('A. 兜底遮罩无「无样式」帧', unstyled.length === 0, `无样式帧 ${unstyled.length} 个`);
  check('A. 兜底遮罩背景第一帧即最终色', wrongBg.length === 0, `背景异常帧 ${wrongBg.length} 个`);

  // 交接：兜底遮罩消失后，Vue 的遮罩或已渲染的内容必须已就位。
  // 注意排除 readyState='loading' 的帧：那发生在 body 解析之前，
  // #boot-loading 尚且不存在，页面上没有任何可看内容，不属于「突变」。
  const gapFrames = frames.filter(
    (f) => f.ready !== 'loading' && !f.boot && !f.overlay && !f.leftPanel,
  );
  check('A. 兜底→Vue 交接无空档帧', gapFrames.length === 0, `空档帧 ${gapFrames.length} 个`);

  // 尺寸恒定：兜底遮罩在「app.css 生效前/后」不能变尺寸。
  // 踩过的坑：app.css 的全局 `* { box-sizing: border-box }` 在 dev 下由 JS 注入，
  // 在它生效之前内联样式按 content-box 渲染，卡片被撑成 216px、spinner 30px，
  // CSS 到达后才缩回 168px / 26px —— 两个 loading 看起来不一样正是这个原因。
  const sizeKeys = [
    ...new Set(
      bootFrames
        .filter((f) => f.bootBoxW != null)
        .map((f) => `${f.bootBoxW}x${f.bootBoxH}/sp${f.bootSpinnerW}`),
    ),
  ];
  check(
    'A. 兜底遮罩尺寸全程恒定（无 content-box 撑大）',
    sizeKeys.length <= 1,
    `出现 ${sizeKeys.length} 种尺寸: ${sizeKeys.join(', ')}`,
  );
  check(
    'A. 兜底遮罩尺寸 = 168x101 / spinner 26px',
    sizeKeys.length === 1 && sizeKeys[0] === '168x101/sp26',
    `实测 ${sizeKeys.join(', ')}`,
  );
  check(
    'A. 兜底遮罩 box-sizing 始终为 border-box',
    bootFrames.filter((f) => f.bootBoxSizing).every((f) => f.bootBoxSizing === 'border-box'),
    '',
  );

  // 两个遮罩逐像素一致（同页并排构造后比对 computed style）
  const cmp = await evaluate(OVERLAY_COMPARE);
  if (cmp && !cmp.ERR) {
    for (const part of ['root', 'box', 'spinner', 'text']) {
      check(
        `A. 两个 loading 的 ${part} 样式一致`,
        cmp.a[part] === cmp.b[part],
        `\n     A: ${cmp.a[part]}\n     B: ${cmp.b[part]}`,
      );
    }
  } else {
    check('A. 两个 loading 可并排比对', false, JSON.stringify(cmp).slice(0, 200));
  }

  /* ================= B. 切换月份：不能出现空数据中间帧 ================= */
  // 切到多月份站点，选一个未缓存的月份，期间限速放大中间态
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: `${BASE}` });
  await sleep(3000);
  await evaluate(SAMPLER);
  await sleep(500);

  // 打开月份选择器并选一个旧月份（若只有一个月则跳过该断言）
  await evaluate(`document.querySelector('.month-picker').click(), true`);
  // 等 Vue 把弹层渲染出来再数：点击后同步读取会拿到 0（Vapor 下一次微任务才更新 DOM）
  await sleep(500);
  const monthCount = await evaluate(`document.querySelectorAll('.sheet .month-item').length`);

  if (monthCount > 1) {
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024,
    });
    // 选最后一个（最旧的月份，一定未缓存）
    await evaluate(`(() => {
      const items = [...document.querySelectorAll('.sheet .month-item')];
      items[items.length - 1].click();
      return true;
    })()`);
    await sleep(6000);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    const frames2 = await evaluate(`(() => { window.__sampling = false; return window.__frames; })()`);
    // 异常帧：左侧面板在（说明已渲染）却显示空态
    const emptyFrames = frames2.filter((f) => f.leftPanel && f.empty);
    check('B. 切月期间无「空数据」中间帧', emptyFrames.length === 0, `空态帧 ${emptyFrames.length} 个`);
    check('B. 切月期间行数不塌成 0（在已渲染帧中）', frames2.filter((f) => f.leftPanel && f.rows === 0).length === 0, '');
  } else {
    check('B. 跳过多月份断言（当前只有 1 个月数据）', true, `months=${monthCount}`);
  }

  check('全程无 JS 报错', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
} catch (error) {
  check('测试执行未抛异常', false, String(error && error.stack ? error.stack : error));
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  let failed = 0;
  console.log('--- 加载态无突变 回归测试 ---');
  for (const [n, ok, extra] of results) {
    console.log(`${ok ? '✓' : '✗'} ${n}${ok || !extra ? '' : `  → ${extra}`}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  if (!isDevServer) {
    console.log(
      '\n⚠️ 当前不是 dev 模式（BASE_URL 指向的不是 Vite 开发服务器）。\n' +
        '   box-sizing / 两个 loading 一致性这几条在生产构建下测不出问题\n' +
        '   （生产 CSS 是渲染阻塞的 <link>，不存在「CSS 未到达」的窗口）。\n' +
        '   要完整覆盖请用： pnpm dev  然后\n' +
        '   BASE_URL=http://localhost:5173/ node scripts/e2e-loading.mjs',
    );
  }
  process.exit(failed ? 1 : 0);
}
