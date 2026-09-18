/**
 * Vue Vapor 重构版：端到端浏览器验证（CDP，无第三方依赖）
 * 覆盖：首屏渲染、懒加载、视图切换、月份选择、排除/恢复、loading、失败路径。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9360;
const BASE = process.env.BASE_URL || 'http://localhost:4190/';
const profile = mkdtempSync(join(tmpdir(), 'cdpvue-'));

/**
 * 首屏断言用的「期望值」从 otData/ 现算，不要写死数字。
 *
 * otData 是由外部私有仓库定时推送的**数据**，每次推送都会让
 * 「有效统计日 / 明细行数 / 日均」变化 —— 写死 1.79、9 行这类数字时，
 * 一次例行的数据同步就会让测试变红，看起来像回归，其实是数据变了。
 * （真实踩到：09-18 推送后 1.79 变 1.61、9 行变 10 行。）
 * 这里直接复用站点自己的 src/lib/model.js，保证算的是同一套口径。
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { computeDays, recordsFromJSON, summarize, formatHours } = await import(
  pathToFileURL(join(root, 'src/lib/model.js')).href
);

/** 取 otData 里最新的那个月（与站点首屏选月的规则一致） */
function expectedFirstScreen() {
  const months = readdirSync(join(root, 'otData'))
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .sort();
  const latest = months[months.length - 1].replace(/\.json$/, '');
  const records = recordsFromJSON(readFileSync(join(root, 'otData', `${latest}.json`), 'utf8'));
  const settings = { workdayEnd: '17:30', minPunches: 2, forgotCounts: true, pendingCounts: false, exclusions: {} };
  const days = computeDays(records, settings, {});
  const summary = summarize(days);
  // 月份弹层里显示的是 index.json 的 counts（不是单月 JSON 的长度），
  // 所以这里也从 index.json 取，与界面同源
  const index = JSON.parse(readFileSync(join(root, 'otData/index.json'), 'utf8'));
  return {
    month: latest,
    // 明细表按天出行；pending 的那天也会出行，所以用 days.length
    rows: days.length,
    hero: formatHours(summary.avgMinutes),
    count: index.counts?.[latest],
  };
}
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--disable-extensions',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, extra = '') => results.push([n, ok, extra]);

let ws, msgId = 0;
const pending = new Map();
const requested = [];
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
const hasFile = (name) => requested.some((u) => pathOf(u).endsWith(name));

/** 首屏的期望值，从 otData 现算（见 expectedFirstScreen 注释） */
const expect = expectedFirstScreen();

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

  /* ---------- 1) 首屏 ---------- */
  await send('Page.navigate', { url: BASE });
  await sleep(3000);

  const first = await evaluate(`(() => {
    const g = (id) => document.getElementById(id);
    return {
      hasApp: !!document.querySelector('.page'),
      bootOverlayGone: !document.getElementById('boot-loading'),
      vueOverlayGone: !document.querySelector('.loading'),
      hero: document.querySelector('.hero-value span')?.textContent ?? null,
      caption: document.querySelector('.hero-caption')?.textContent ?? null,
      month: document.querySelector('.month-picker .picker-label')?.textContent ?? null,
      chartTitle: document.querySelector('.chart-title')?.textContent ?? null,
      statNums: [...document.querySelectorAll('.stat-num')].map(n => n.textContent),
      rows: document.querySelectorAll('#detailBody tr.row, .detail-table tbody tr.row').length,
      bars: document.querySelectorAll('.chart svg rect').length,
      footnote: document.querySelector('.footnote')?.textContent ?? null,
      fatal: !!document.querySelector('.fatal'),
      segActive: document.querySelector('.seg.is-active')?.textContent?.trim(),
    };
  })()`);

  check('应用已挂载', first.hasApp === true, JSON.stringify(first));
  check('首屏兜底遮罩已移除', first.bootOverlayGone === true);
  check('Vue loading 遮罩已隐藏', first.vueOverlayGone === true);
  // 期望值由 otData 现算（见 expectedFirstScreen 注释），不写死数字
  check(`hero 日均 = ${expect.hero}`, first.hero === expect.hero, String(first.hero));
  check('月份标签 = 2026年9月', first.month === '2026年9月', String(first.month));
  check('图表标题正确', first.chartTitle === '2026年9月 · 每日加班时长', String(first.chartTitle));
  check(`明细 ${expect.rows} 行`, first.rows === expect.rows, String(first.rows));
  check('图表柱子已渲染', first.bars > 28, String(first.bars));
  check('无错误块', first.fatal === false);
  check('默认选中「月」', first.segActive === '月', String(first.segActive));
  check('页脚来源 = 按月 JSON', (first.footnote || '').includes('来源 按月 JSON'), String(first.footnote));
  check('首屏只请求最新 1 个月', monthFiles().filter(u => u.includes('2026-09')).length === 1, JSON.stringify(monthFiles()));
  check('首屏请求了 index.json', hasFile('index.json'));
  check('首屏未请求 all.csv', !hasFile('all.csv'));

  /* ---------- 1b) 月份选择器：文字必须居中 + 箭头与文字同高 ---------- */
  const picker = await evaluate(`(() => {
    const main = document.querySelector('.topbar-main');
    const wrap = document.querySelector('.month-picker');
    const label = wrap.querySelector('.picker-label');
    const svg = wrap.querySelector('svg');
    const spacer = wrap.querySelector('.picker-spacer');
    const R = (n) => { const r = n.getBoundingClientRect(); return { cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, w: r.width, h: r.height }; };
    const m = R(main), l = R(label), s = R(svg), sp = R(spacer);
    return {
      labelOffset: +(l.cx - m.cx).toFixed(2),
      spacerW: +sp.w.toFixed(2), svgW: +s.w.toFixed(2), svgH: +s.h.toFixed(2),
      vDelta: +(s.cy - l.cy).toFixed(2),
      labelH: +l.h.toFixed(2),
      viewBox: svg.getAttribute('viewBox'),
      icons: document.querySelectorAll('svg.icon').length,
      nonRemixIcons: [...document.querySelectorAll('svg')]
        .filter((n) => !n.classList.contains('icon') && !n.closest('.chart'))
        .length,
    };
  })()`);

  check('月份文字居中（偏移 < 1px）', Math.abs(picker.labelOffset) < 1, `偏移 ${picker.labelOffset}px`);
  check('占位与箭头等宽', picker.spacerW === picker.svgW, `占位 ${picker.spacerW} vs 箭头 ${picker.svgW}`);
  check('箭头垂直居中对齐文字', Math.abs(picker.vDelta) < 1.5, `垂直差 ${picker.vDelta}px`);
  check('箭头高度接近文字行高', Math.abs(picker.svgH - picker.labelH) <= 6, `箭头 ${picker.svgH} vs 文字行高 ${picker.labelH}`);
  check('图标使用 Remix viewBox', picker.viewBox === '0 0 24 24', String(picker.viewBox));
  check('无遗留非 Remix 图标', picker.nonRemixIcons === 0, `剩 ${picker.nonRemixIcons} 个`);

  /* ---------- 1c) 月份选择器 hover 背景必须贴合可见内容 ----------
     按钮盒子里左侧有 16px 的隐形 spacer（为「文字居中」而留的占位）。
     若把 hover 背景直接画在按钮上，可见内容「文字 + 箭头」会整体偏右：
     文字左侧空 8+16+3 = 27px，而箭头右侧只有 8px —— 肉眼就是左侧空一大块。
     正确做法是把背景画在 ::before 上，只覆盖可见内容并左右各留 8px。
     这里用 CDP 真的派发一次 hover，再读 ::before 的计算样式来核对。 */
  const pickerRect = await evaluate(`(() => {
    const r = document.querySelector('.month-picker').getBoundingClientRect();
    return { cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pickerRect.cx, y: pickerRect.cy, button: 'none' });
  await sleep(300);

  const hoverBg = await evaluate(`(() => {
    const btn = document.querySelector('.month-picker');
    const label = btn.querySelector('.picker-label');
    const svg = btn.querySelector('svg');
    const cs = getComputedStyle(btn, '::before');
    const R = (n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right }; };
    const b = R(btn), l = R(label), s = R(svg);
    // ::before 的左边界（inset 的 left 值，相对按钮 padding box）
    const beforeLeft = parseFloat(cs.left);
    return {
      bg: cs.backgroundColor,
      // 按钮自身的背景必须仍是透明的。
      // 这是**最关键**的一条：最初就是这个 bug —— 背景画在按钮盒子上，
      // 连带左侧 16px 隐形 spacer 一起被染色，看起来左侧空一大块。
      // 只量 ::before 的话，把背景改回按钮上会测不出来（假绿）。
      btnBg: getComputedStyle(btn).backgroundColor,
      beforeLeft,
      // 背景左缘到文字左缘 / 箭头右缘到背景右缘，两者应相等
      gapLeft: +(l.l - (b.l + beforeLeft)).toFixed(1),
      gapRight: +(b.r - s.r).toFixed(1),
      // 顺带确认伪元素没有盖住内容（z-index: -1）
      contentZ: getComputedStyle(svg).zIndex,
    };
  })()`);

  check('hover 时背景已显示', /rgba?\(/.test(hoverBg.bg) && hoverBg.bg !== 'rgba(0, 0, 0, 0)', String(hoverBg.bg));
  check('hover 背景不画在按钮盒子上（避免带上隐形 spacer）',
    hoverBg.btnBg === 'rgba(0, 0, 0, 0)', `按钮自身背景 = ${hoverBg.btnBg}`);
  check('hover 背景左缘避开隐形 spacer',
    Math.abs(hoverBg.beforeLeft - 19) < 0.5, `::before left = ${hoverBg.beforeLeft}px（应为 19 = 箭头 16 + gap 3）`);
  check('hover 背景左右留白相等（贴合可见内容）',
    Math.abs(hoverBg.gapLeft - hoverBg.gapRight) < 0.5,
    `左 ${hoverBg.gapLeft}px vs 右 ${hoverBg.gapRight}px`);

  // 移开鼠标，避免影响后续断言
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400, button: 'none' });
  await sleep(200);

  /* ---------- 1d) 点按高亮必须全局关闭 ----------
     移动端点按控件时，浏览器会叠加一块**半透明系统色**高亮。
     Chrome for Android 的默认值是 rgba(51, 181, 229, 0.4) 的蓝色，
     画在元素的整个 border-box 上、由合成器直接叠在所有内容之上
     （弹层遮罩也压不住）—— 表现就是「点一下闪出一个蓝色方块」。
     必须在 html 上全局关掉。这里逐个元素核对计算值，
     因为该属性**可继承**：只在 html 上写一次即可覆盖全站，
     但若哪天有人删掉它、或某元素被重新设回默认值，这条断言要能发现。 */
  const tapHighlight = await evaluate(`(() => {
    const pick = (sel) => {
      const n = document.querySelector(sel);
      return n ? getComputedStyle(n).webkitTapHighlightColor : null;
    };
    return {
      html: pick('html'),
      picker: pick('.month-picker'),
      seg: pick('.seg'),
      iconBtn: pick('.icon-btn'),
      chartRect: pick('.chart svg rect'),
    };
  })()`);
  const allTransparent = Object.values(tapHighlight).every((v) => v === 'rgba(0, 0, 0, 0)');
  check('点按高亮已全局关闭（无蓝色方块）', allTransparent, JSON.stringify(tapHighlight));

  /* ---------- 2) 切到「全部」 ---------- */
  await evaluate(`[...document.querySelectorAll('.seg')].find(b => b.textContent.trim() === '全部').click(), true`);
  await sleep(2500);

  const all = await evaluate(`(() => ({
    chartTitle: document.querySelector('.chart-title')?.textContent,
    overviewTitle: document.querySelector('.card h2')?.textContent,
    rows: document.querySelectorAll('.detail-table tbody tr.row').length,
    countExtra: document.querySelector('.card-head-extra')?.textContent,
    monthDisabled: document.querySelector('.month-picker')?.disabled,
    segActive: document.querySelector('.seg.is-active')?.textContent?.trim(),
    fatal: !!document.querySelector('.fatal'),
    overlayGone: !document.querySelector('.loading'),
  }))()`);

  check('全部视图无错误', all.fatal === false, JSON.stringify(all));
  check('全部视图标题 = 每月加班时长', all.chartTitle === '每月加班时长', String(all.chartTitle));
  check('全部视图 1 个月', all.countExtra === '1 个月', String(all.countExtra));
  check('全部视图 1 行', all.rows === 1, String(all.rows));
  check('全部视图禁用月份选择', all.monthDisabled === true);
  check('全部视图遮罩已隐藏', all.overlayGone === true);

  /* ---------- 3) 月份选择器 ---------- */
  await evaluate(`[...document.querySelectorAll('.seg')].find(b => b.textContent.trim() === '月').click(), true`);
  await sleep(1500);
  await evaluate(`document.querySelector('.month-picker').click(), true`);
  await sleep(600);

  const sheet = await evaluate(`(() => {
    const s = document.querySelector('.sheet');
    return {
      open: !!s,
      title: s?.querySelector('.sheet-title')?.textContent,
      labels: [...(s?.querySelectorAll('.month-item-label') || [])].map(n => n.textContent),
      metas: [...(s?.querySelectorAll('.month-item-meta') || [])].map(n => n.textContent),
    };
  })()`);
  check('月份弹层已打开', sheet.open === true, JSON.stringify(sheet));
  check('弹层标题 = 选择月份', sheet.title === '选择月份', String(sheet.title));
  check('列出 2026年9月', sheet.labels.includes('2026年9月'), JSON.stringify(sheet.labels));
  check('显示记录条数', (sheet.metas[0] || '').includes(`${expect.count} 条记录`), JSON.stringify(sheet.metas));

  await evaluate(`document.querySelector('.sheet .month-item').click(), true`);
  await sleep(1200);
  const picked = await evaluate(`(() => ({
    sheetClosed: !document.querySelector('.sheet'),
    month: document.querySelector('.month-picker .picker-label')?.textContent,
    fatal: !!document.querySelector('.fatal'),
  }))()`);
  check('选月后弹层关闭', picked.sheetClosed === true);
  check('选月后月份不变', picked.month === '2026年9月', String(picked.month));

  /* ---------- 4) 排除 / 恢复 ---------- */
  const before = await evaluate(`document.querySelectorAll('.stat-num')[1].textContent`);
  await evaluate(`document.querySelector('.detail-table tbody tr.row .row-toggle').click(), true`);
  await sleep(900);

  const excluded = await evaluate(`(() => ({
    days: document.querySelectorAll('.stat-num')[1].textContent,
    chips: document.querySelectorAll('.chip').length,
    chipVisible: !!document.querySelector('.excluded-block'),
    toast: document.querySelector('.toast')?.textContent ?? '',
    ls: localStorage.getItem('ot-ledger:v1'),
    footnote: document.querySelector('.footnote')?.textContent,
  }))()`);

  check('排除后 chip 出现', excluded.chips === 1, JSON.stringify(excluded));
  check('已排除区显示', excluded.chipVisible === true);
  check('排除后有效天数 -1', Number(excluded.days) === Number(before) - 1, `${before} -> ${excluded.days}`);
  check('toast 提示已排除', (excluded.toast || '').includes('已排除'), excluded.toast);
  check('写入 localStorage', (excluded.ls || '').includes('exclusions'), String(excluded.ls).slice(0, 80));
  check('页脚标记本机修改', (excluded.footnote || '').includes('含本机未提交的标记'), String(excluded.footnote));

  // 备注
  await evaluate(`(() => { const i = document.querySelector('.chip-note'); i.value = '调休'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(600);
  const noteSaved = await evaluate(`localStorage.getItem('ot-ledger:v1')`);
  check('备注已写入配置', (noteSaved || '').includes('调休'), String(noteSaved).slice(0, 140));

  // 恢复
  await evaluate(`document.querySelector('.chip-remove').click(), true`);
  await sleep(900);
  const restored = await evaluate(`(() => ({
    days: document.querySelectorAll('.stat-num')[1].textContent,
    chips: document.querySelectorAll('.chip').length,
    blockGone: !document.querySelector('.excluded-block'),
  }))()`);
  check('恢复后 chip 消失', restored.chips === 0, JSON.stringify(restored));
  check('恢复后有效天数回到原值', restored.days === before, `${before} vs ${restored.days}`);

  /* ---------- 5) 设置 / 规则弹层 ---------- */
  await evaluate(`document.querySelector('[aria-label="设置"]').click(), true`);
  await sleep(600);
  const settingsSheet = await evaluate(`(() => {
    const s = document.querySelector('.sheet');
    const body = s?.querySelector('.sheet-body');
    const head = s?.querySelector('.sheet-head');
    return {
      title: s?.querySelector('.sheet-title')?.textContent,
      rows: [...(s?.querySelectorAll('.setting-label') || [])].map(n => n.textContent),
      infoKeys: [...(s?.querySelectorAll('.info-key') || [])].map(n => n.textContent),
      infoVals: [...(s?.querySelectorAll('.info-val') || [])].map(n => n.textContent),
      hasSwitch: !!s?.querySelector('.switch input'),
      // 两个「计入平均」开关：忘打卡默认开、今日未下班默认关
      switches: [...(s?.querySelectorAll('.switch input') || [])].map(n => n.checked),
      // 「手动排除某天」已移除：不应再有日期输入或主按钮
      hasDateInput: !!s?.querySelector('.input--date'),
      hasPrimaryBtn: !!s?.querySelector('.btn--primary'),
      // 滚动结构：容器不滚动，body 独立滚动（修滚动条的前提）
      sheetOverflowY: s ? getComputedStyle(s).overflowY : null,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
      headPosition: head ? getComputedStyle(head).position : null,
    };
  })()`);
  check('设置弹层打开', settingsSheet.title === '设置', JSON.stringify(settingsSheet));
  check('设置项齐全（4 项）', settingsSheet.rows.length === 4, JSON.stringify(settingsSheet.rows));
  check('含「今日未下班计入平均」开关', settingsSheet.rows.includes('今日未下班计入平均'), JSON.stringify(settingsSheet.rows));
  check('忘打卡默认开、今日未下班默认关', JSON.stringify(settingsSheet.switches) === '[true,false]', JSON.stringify(settingsSheet.switches));
  check('已移除「手动排除某天」', settingsSheet.hasDateInput === false && settingsSheet.hasPrimaryBtn === false, JSON.stringify(settingsSheet));
  check('信息区含数据来源', settingsSheet.infoKeys.includes('数据来源'), JSON.stringify(settingsSheet.infoKeys));
  // 仓库默认配置必须真的随产物发布：
  //   产物里少了 ot-ledger.config.json 时 fetch 只是 404 被静默忽略，
  //   页面不会报错，只会在这里显示「未提供（可选）」—— 正是这条断言要抓的回归。
  //   （v1 的 workflow 有 `cp ot-ledger.config.json _site/`，重写成 Vite 时漏过。）
  check('仓库默认配置已随产物发布', settingsSheet.infoVals.includes('ot-ledger.config.json'), JSON.stringify(settingsSheet.infoVals));
  check('弹层容器不滚动、body 独立滚动', settingsSheet.sheetOverflowY === 'hidden' && settingsSheet.bodyOverflowY === 'auto', JSON.stringify(settingsSheet));
  check('标题栏为 flex 固定（非 sticky）', settingsSheet.headPosition === 'static', String(settingsSheet.headPosition));
  // 真正验证滚动条样式已定义：扫描样式表里的 ::-webkit-scrollbar 规则。
  // 注意必须排除 :hover 变体 —— 它在样式表里排在后面，
  // 若不排除会把基础规则覆盖掉（background-clip 读成空）。
  const scrollbarCss = await evaluate(`(() => {
    let thumb = null, track = null, bar = null;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        const sel = r.selectorText || '';
        if (!sel.includes('.sheet-body') || !sel.includes('scrollbar')) continue;
        if (sel.includes(':hover')) continue;
        if (sel.includes('::-webkit-scrollbar-thumb')) thumb = r.style;
        else if (sel.includes('::-webkit-scrollbar-track')) track = r.style;
        else if (sel.endsWith('::-webkit-scrollbar')) bar = r.style;
      }
    }
    return {
      barWidth: bar?.width ?? null,
      trackBg: track?.backgroundColor ?? null,
      thumbRadius: thumb?.borderRadius ?? null,
      thumbClip: thumb?.backgroundClip ?? null,
      thumbBorder: thumb?.border ?? null,
    };
  })()`);
  check('滚动条已重绘（细滑块 + 透明轨道）',
    scrollbarCss.barWidth === '8px' && scrollbarCss.thumbClip === 'content-box' && /transparent/.test(scrollbarCss.trackBg || ''),
    JSON.stringify(scrollbarCss));

  // 结构验证：内容超高时由 body 滚动、容器自己不滚动。
  // 用一个很矮的视口强制内容溢出（设置面板已精简到 3 项，正常视口下不会溢出）。
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 380, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  const scrollState = await evaluate(`(() => {
    const s = document.querySelector('.sheet');
    const body = s.querySelector('.sheet-body');
    return {
      bodyScrollable: body.scrollHeight > body.clientHeight,
      sheetScrollable: s.scrollHeight > s.clientHeight,
      bodyClientH: body.clientHeight, bodyScrollH: body.scrollHeight,
    };
  })()`);
  check('内容超高时由 body 承担滚动（容器不滚）',
    scrollState.bodyScrollable === true && scrollState.sheetScrollable === false,
    JSON.stringify(scrollState));

  // 滚动到底：标题栏应保持可见（flex 固定，不是被卷走）
  const headStays = await evaluate(`(() => {
    const s = document.querySelector('.sheet');
    const body = s.querySelector('.sheet-body');
    const head = s.querySelector('.sheet-head');
    body.scrollTop = body.scrollHeight;
    const box = head.getBoundingClientRect();
    const sheetBox = s.getBoundingClientRect();
    return { headTop: +box.top.toFixed(1), sheetTop: +sheetBox.top.toFixed(1), scrolled: body.scrollTop > 0 };
  })()`);
  check('滚动到底时标题栏仍固定可见',
    headStays.scrolled && Math.abs(headStays.headTop - headStays.sheetTop) < 2,
    JSON.stringify(headStays));
  await evaluate(`document.querySelector('.sheet-body').scrollTop = 0, true`);
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  // 改标准下班时间 -> 统计应重算
  // 注意：输入框是 v-model，必须派发 input 事件才会更新绑定的值，
  // 只派发 change 的话组件读到的仍是旧值（这不是应用的问题）。
  const heroBefore = await evaluate(`document.querySelector('.hero-value span').textContent`);
  await evaluate(`(() => {
    const i = document.querySelector('.input--time');
    i.value = '18:00';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const heroAfter = await evaluate(`document.querySelector('.hero-value span').textContent`);
  check('改下班时间后统计重算', heroBefore !== heroAfter, `${heroBefore} -> ${heroAfter}`);

  // 还原
  await evaluate(`(() => {
    const i = document.querySelector('.input--time');
    i.value = '17:30';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(700);
  const heroRestored = await evaluate(`document.querySelector('.hero-value span').textContent`);
  check('还原后统计恢复', heroRestored === heroBefore, `${heroBefore} vs ${heroRestored}`);
  await evaluate(`document.querySelector('.sheet-close').click(), true`);
  await sleep(400);
  check('弹层可关闭', (await evaluate(`!document.querySelector('.sheet')`)) === true);

  await evaluate(`document.querySelector('[aria-label="统计规则"]').click(), true`);
  await sleep(500);
  check('规则弹层打开', (await evaluate(`document.querySelector('.sheet-title')?.textContent`)) === '统计规则');
  await evaluate(`document.querySelector('.sheet-close').click(), true`);
  await sleep(300);

  /* ---------- 6) 响应式：图表随窗口尺寸重绘 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 800, deviceScaleFactor: 1, mobile: true });
  await sleep(800);
  const narrow = await evaluate(`(() => {
    const svg = document.querySelector('.chart svg');
    return { viewBox: svg?.getAttribute('viewBox'), bars: document.querySelectorAll('.chart svg rect').length };
  })()`);
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(500);
  check('窄屏下图表仍渲染', narrow.bars > 28, JSON.stringify(narrow));

  check('全程无 JS 报错', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
} catch (error) {
  check('测试执行未抛异常', false, String(error && error.stack ? error.stack : error));
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  let failed = 0;
  console.log('--- Vue Vapor 端到端验证 ---');
  for (const [n, ok, extra] of results) {
    console.log(`${ok ? '✓' : '✗'} ${n}${ok || !extra ? '' : `  → ${extra}`}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
}
