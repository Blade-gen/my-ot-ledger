/**
 * Vue 版：懒加载 / 兜底 / 失败路径 验证。
 * 前置：node scripts/make-fixtures.mjs 生成 .tmp-* 站点，并用 serve 托管仓库根目录。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9361;
const SITE = process.env.SITE_URL || 'http://localhost:4191';
const profile = mkdtempSync(join(tmpdir(), 'cdpfix-'));
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--disable-extensions',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, extra = '') => results.push([n, ok, extra]);

let ws, msgId = 0;
const pending = new Map();
let requested = [];
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
const pathOf = (u) => u.split('?')[0];
const monthFiles = () => [...new Set(requested.filter((u) => /\/otData\/\d{4}-\d{2}\.json$/.test(pathOf(u))).map(pathOf))];
const hasFile = (n) => requested.some((u) => pathOf(u).endsWith(n));

const state = () => evaluate(`(() => ({
  mounted: !!document.querySelector('.page'),
  month: document.querySelector('.month-picker .picker-label')?.textContent ?? null,
  hero: document.querySelector('.hero-value span')?.textContent ?? null,
  rows: document.querySelectorAll('.detail-table tbody tr').length,
  chartTitle: document.querySelector('.chart-title')?.textContent ?? null,
  footnote: document.querySelector('.footnote')?.textContent ?? null,
  fatal: !!document.querySelector('.fatal'),
  fatalTitle: document.querySelector('.fatal-title')?.textContent ?? null,
  overlay: !!document.querySelector('.loading'),
}))()`);

try {
  for (let i = 0; i < 40; i += 1) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    if (m.method === 'Network.requestWillBeSent') requested.push(m.params.request.url);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || 'exception');
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  /* ================= 多月份 ================= */
  requested = [];
  await send('Page.navigate', { url: `${SITE}/.tmp-multi/` });
  await sleep(2800);
  let s = await state();

  check('[多月份] 首屏渲染成功', s.mounted && !s.fatal, JSON.stringify(s));
  check('[多月份] 加载最新月份', s.month === '2026年9月', String(s.month));
  check('[多月份] 首屏只请求 1 个单月文件', monthFiles().length === 1, JSON.stringify(monthFiles()));
  check('[多月份] 首屏请求 index.json', hasFile('index.json'));
  check('[多月份] 首屏未请求 all.csv', !hasFile('all.csv'));

  // 切入全部视图：应补齐「尚未加载」的月份（2026-09 首屏已在缓存里，不应重复请求）
  requested = [];
  await evaluate(`[...document.querySelectorAll('.seg')].find(b => b.textContent.trim() === '全部').click(), true`);
  await sleep(3000);
  s = await state();
  const allMonths = monthFiles();
  check('[多月份] 全部视图 3 个月', (await evaluate(`document.querySelector('.card-head-extra')?.textContent`)) === '3 个月', '');
  check(
    '[多月份] 只补拉缺失的 2 个月（09 已在缓存）',
    allMonths.length === 2 && ['2026-07', '2026-08'].every((m) => allMonths.some((f) => f.includes(m))),
    JSON.stringify(allMonths),
  );
  check('[多月份] 全部视图无错误', !s.fatal, JSON.stringify(s));

  // 冷启动直接选旧月份：只应请求那一个月
  await send('Page.navigate', { url: `${SITE}/.tmp-multi/` });
  await sleep(2500);
  requested = [];
  await evaluate(`document.querySelector('.month-picker').click(), true`);
  await sleep(500);
  await evaluate(`[...document.querySelectorAll('.sheet .month-item')].find(n => n.textContent.includes('7月')).click(), true`);
  await sleep(2500);
  s = await state();
  const cold = monthFiles();
  check('[多月份] 冷启动选旧月份只拉该月', cold.length === 1 && cold[0].includes('2026-07'), JSON.stringify(cold));
  check('[多月份] 旧月份渲染正确', s.month === '2026年7月' && s.rows > 0 && s.hero === '2.02', JSON.stringify(s));
  check('[多月份] 旧月份图表标题正确', s.chartTitle === '2026年7月 · 每日加班时长', String(s.chartTitle));

  /* ================= pendingCounts 开关（默认关） =================
     .tmp-multi 里给「今天」放了一条只有上班、没有下班的卡 —— 该日状态为 pending。
     开关默认关 -> 不计入平均；打开 -> 按 0 加班计入，日均随之变化。 */
  requested = [];
  await send('Page.navigate', { url: `${SITE}/.tmp-multi/` });
  await sleep(2800);

  /** 读取当前统计：有效天数、总时长、日均、pending 天数、今日那行的 badge */
  const stats = () => evaluate(`(() => {
    const nums = [...document.querySelectorAll('.stat-num')].map(n => n.textContent);
    const rows = [...document.querySelectorAll('.detail-table tbody tr.row')];
    const todayRow = rows.find(r => r.classList.contains('is-uncounted') || /待更新/.test(r.textContent));
    return {
      hero: document.querySelector('.hero-value span')?.textContent ?? null,
      caption: document.querySelector('.hero-caption')?.textContent ?? null,
      days: nums[1], total: nums[0],
      note: document.querySelector('.card-note')?.textContent ?? '',
      pendingRow: todayRow ? todayRow.textContent.replace(/\\s+/g, ' ').trim() : null,
      fault: !!document.querySelector('.fatal'),
    };
  })()`);

  const off = await stats();
  check('[开关] 默认关闭时统计正常', !off.fault && off.hero !== null, JSON.stringify(off));
  check('[开关] 默认关闭：note 里有「待更新 N 天」', /待更新 \d+ 天/.test(off.note), off.note);
  check('[开关] 默认关闭：今日行标为待更新', (off.pendingRow || '').includes('待更新'), String(off.pendingRow));

  // 打开设置，打开「今日未下班计入平均」
  await evaluate(`document.querySelector('[aria-label="设置"]').click(), true`);
  await sleep(700);
  await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('.sheet .switch input')];
    // 第二个开关即「今日未下班计入平均」
    const target = boxes[1];
    target.checked = true;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  await evaluate(`document.querySelector('.sheet-close').click(), true`);
  await sleep(500);

  const on = await stats();
  check('[开关] 打开后有效天数 +1', Number(on.days) === Number(off.days) + 1, `${off.days} -> ${on.days}`);
  check('[开关] 打开后日均变化（分母变大）', on.hero !== off.hero, `${off.hero} -> ${on.hero}`);
  check('[开关] 打开后总时长不变（0 分钟不影响分子）', on.total === off.total, `${off.total} vs ${on.total}`);
  check('[开关] 打开后今日行仍标为待更新', (on.pendingRow || '').includes('待更新'), String(on.pendingRow));

  // 恢复默认（关闭），避免影响后续断言
  await evaluate(`document.querySelector('[aria-label="设置"]').click(), true`);
  await sleep(700);
  await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('.sheet .switch input')];
    boxes[1].checked = false;
    boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  await evaluate(`document.querySelector('.sheet-close').click(), true`);
  await sleep(500);
  const restored = await stats();
  check('[开关] 重新关闭后回到默认值', restored.days === off.days && restored.hero === off.hero, `${JSON.stringify(restored)} vs ${JSON.stringify(off)}`);

  /* ================= 兜底（只有 all.csv） ================= */
  requested = [];
  await send('Page.navigate', { url: `${SITE}/.tmp-fallback/` });
  await sleep(2800);
  s = await state();
  check('[兜底] 渲染成功', s.mounted && !s.fatal, JSON.stringify(s));
  check('[兜底] 使用 all.csv', hasFile('all.csv'), JSON.stringify(requested.map(pathOf).slice(-4)));
  check('[兜底] 未请求单月文件', monthFiles().length === 0, JSON.stringify(monthFiles()));
  check('[兜底] 页脚标记兜底来源', (s.footnote || '').includes('all.csv（兜底）'), String(s.footnote));
  check('[兜底] 加载最新月份', s.month === '2026年9月', String(s.month));

  /* ================= 空数据（失败路径） ================= */
  await send('Page.navigate', { url: `${SITE}/.tmp-empty/` });
  await sleep(3000);
  s = await state();
  check('[空数据] 不卡在 loading', s.overlay === false, JSON.stringify(s));
  check('[空数据] 显示错误块', s.fatal === true, JSON.stringify(s));
  check('[空数据] 错误标题非空', !!s.fatalTitle, String(s.fatalTitle));
  check('[空数据] 无 JS 崩溃', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
} catch (error) {
  check('测试执行未抛异常', false, String(error && error.stack ? error.stack : error));
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  let failed = 0;
  console.log('--- 懒加载 / 兜底 / 失败路径（Vue 版）---');
  for (const [n, ok, extra] of results) {
    console.log(`${ok ? '✓' : '✗'} ${n}${ok || !extra ? '' : `  → ${extra}`}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
}
