import {
  computeDays,
  dateLabel,
  daysInMonth,
  formatDuration,
  formatHours,
  lastSyncedAt,
  monthLabel,
  parseRecords,
  STATUS_TEXT,
  summarize,
  todayInCN,
  toggleExclusion,
  weekdayOf,
} from './model.js';
import { renderBars } from './chart.js';
import { store } from './store.js';

const DATA_URL = 'otData/all.csv';

const $ = (id) => document.getElementById(id);

const dom = {
  monthPicker: $('monthPicker'),
  monthLabel: $('monthLabel'),
  btnSettings: $('btnSettings'),
  btnRules: $('btnRules'),
  segmented: $('segmented'),
  heroValue: $('heroValue'),
  heroUnit: $('heroUnit'),
  heroCaption: $('heroCaption'),
  chartTitle: $('chartTitle'),
  chart: $('chart'),
  overviewTitle: $('overviewTitle'),
  statGrid: $('statGrid'),
  cardNote: $('cardNote'),
  detailBody: $('detailBody'),
  detailHead: $('detailHead'),
  detailTitle: $('detailTitle'),
  detailCount: $('detailCount'),
  excludedBlock: $('excludedBlock'),
  excludedChips: $('excludedChips'),
  footnote: $('footnote'),
  backdrop: $('backdrop'),
  sheet: $('sheet'),
  toast: $('toast'),
};

const state = {
  view: 'month',
  month: null,
  records: [],
  syncedAt: '',
  days: [],
  error: null,
  loaded: false,
};

/* ------------------------------------------------------------------ *
 * 通用小工具
 * ------------------------------------------------------------------ */

function svgIcon(path, opts = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', opts.viewBox || '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  if (opts.className) svg.setAttribute('class', opts.className);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', opts.fill || 'currentColor');
  if (opts.fillRule) p.setAttribute('fill-rule', opts.fillRule);
  svg.append(p);
  return svg;
}

const ICON_CHECK = 'M8.1 14.2 4 10.1l1.4-1.4 2.7 2.7 6.5-6.5L16 6.3z';
const ICON_MINUS = 'M4.5 9.2h11v1.6h-11z';
const ICON_DOTS =
  'M10 6.2a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zm0 5.2a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zm0 5.2a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8z';
const ICON_CHART = 'M4 13.6h2.6V16H4zm4.7-4.2h2.6V16H8.7zm4.7-5.4H16V16h-2.6z';
const ICON_CAL = 'M6.4 3.2h1.6v1.6h4V3.2h1.6v1.6h1.6v11.2H4.8V4.8h1.6zm7.2 4.8H6.4v6.4h7.2z';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

let toastTimer = null;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('is-visible');
    setTimeout(() => {
      dom.toast.hidden = true;
    }, 200);
  }, 1800);
}

/* ------------------------------------------------------------------ *
 * 派生数据
 * ------------------------------------------------------------------ */

function settings() {
  return store.get();
}

function recompute() {
  state.days = computeDays(state.records, settings());
  const months = [...new Set(state.days.map((d) => d.month))].sort();
  if (!state.month || !months.includes(state.month)) {
    state.month = months.length ? months[months.length - 1] : todayInCN().slice(0, 7);
  }
}

function daysOfMonth(month) {
  return state.days.filter((d) => d.month === month);
}

function monthGroups() {
  const map = new Map();
  for (const day of state.days) {
    if (!map.has(day.month)) map.set(day.month, []);
    map.get(day.month).push(day);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, days]) => ({ month, days, summary: summarize(days) }));
}

function allExcludedEntries() {
  const cfgEx = settings().exclusions;
  const byDate = new Map();
  for (const [date, value] of Object.entries(cfgEx)) {
    byDate.set(date, { date, note: value.note || '', hasData: false });
  }
  for (const day of state.days) {
    if (!day.excluded) continue;
    const cur = byDate.get(day.date) || { date: day.date, note: '', hasData: false };
    cur.note = day.note || cur.note;
    cur.hasData = true;
    byDate.set(day.date, cur);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function render() {
  if (!state.loaded) return;
  dom.monthLabel.textContent = state.view === 'all' ? '全部时间' : monthLabel(state.month);
  dom.monthPicker.disabled = state.view === 'all';
  for (const btn of dom.segmented.querySelectorAll('.seg')) {
    const active = btn.dataset.view === state.view;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }

  if (state.view === 'all') {
    const days = state.days;
    const summary = summarize(days);
    renderHero(summary, days);
    renderChartAll();
    renderOverview(summary, 'all');
    renderTableMonths();
  } else {
    const days = daysOfMonth(state.month);
    const summary = summarize(days);
    renderHero(summary, days);
    renderChartMonth(state.month, days);
    renderOverview(summary, 'month');
    renderTableDays(days);
  }
  renderExcluded();
  renderFootnote();
}

function renderHero(summary, days) {
  dom.heroValue.textContent = formatHours(summary.avgMinutes, 2);
  dom.heroUnit.textContent = '小时/天';
  const scope =
    state.view === 'all' ? '全部时间' : monthLabel(state.month);
  const parts = [`${scope}共 ${summary.days} 个有效统计日`];
  if (days.length) parts.push(`总加班 ${formatHours(summary.totalMinutes, 1)} 小时`);
  dom.heroCaption.textContent = parts.join(' · ');
}

function tipFor(day, grayMinutes = 0) {
  const lines = [
    day.punches.length >= 2
      ? `上班 ${day.inTime} → 下班 ${day.outTime}`
      : `仅 ${day.inTime} 一次打卡`,
  ];
  if (day.excluded) {
    lines.push(`已排除，不计入统计${day.note ? `（${day.note}）` : ''}`);
    if (day.otMinutes > 0) lines.push(`当日加班 ${formatDuration(day.otMinutes)}`);
    if (grayMinutes > 0) lines.push(`灰柱高度按平均值示意 ${formatDuration(grayMinutes)}`);
  } else if (day.status === 'ok') lines.push(`加班 ${formatDuration(day.otMinutes)}`);
  else if (day.status === 'forgot') lines.push('忘打卡，加班按 0 计');
  else if (day.status === 'incomplete') lines.push('打卡次数不足，不纳入统计');
  else if (day.status === 'pending') lines.push('今日待更新，暂不纳入统计');
  else lines.push('不纳入统计');
  return lines;
}

function renderChartMonth(month, days) {
  dom.chartTitle.textContent = `${monthLabel(month)} · 每日加班时长`;
  if (!days.length) {
    renderBars(dom.chart, { items: [] });
    return;
  }

  const summary = summarize(days);
  const avgMinutes = summary.avgMinutes;
  const today = todayInCN();
  const byDate = new Map(days.map((day) => [day.date, day]));
  const total = daysInMonth(month);

  // 整月铺满：没有打卡记录的日子也要占位，柱状图才能反映「今天是几号」
  const items = [];
  for (let d = 1; d <= total; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const day = byDate.get(date);
    const label = `${d}日`;

    if (!day) {
      const future = date > today;
      items.push({
        key: date,
        label,
        dayNumber: d,
        minutes: 0,
        kind: future ? 'future' : 'empty',
        title: `${dateLabel(date)} ${weekdayOf(date)}`,
        lines: [future ? '尚未到来' : '无打卡记录'],
      });
      continue;
    }

    // 被排除的日子：柱子置灰，高度按（有效统计日的）平均值画出来，
    // 否则高度为 0 的灰柱在图上根本看不见。
    const grayMinutes = avgMinutes > 0 ? avgMinutes : day.otMinutes;
    const minutes = day.excluded
      ? grayMinutes
      : day.counted || day.status === 'ok'
        ? day.otMinutes
        : 0;
    items.push({
      key: date,
      label,
      dayNumber: d,
      minutes,
      kind: day.excluded ? 'excluded' : day.status === 'ok' ? 'ok' : day.status,
      title: `${dateLabel(date)} ${day.weekday}`,
      lines: tipFor(day, day.excluded ? grayMinutes : 0),
    });
  }

  renderBars(dom.chart, {
    items,
    labelMode: 'day',
    avgMinutes,
    ariaLabel: `${monthLabel(month)} 每日加班时长`,
  });
}

function renderChartAll() {
  const groups = monthGroups().slice().reverse();
  dom.chartTitle.textContent = '每月加班时长';
  if (!groups.length) {
    renderBars(dom.chart, { items: [] });
    return;
  }
  const items = groups.map((group) => {
    const s = group.summary;
    return {
      key: group.month,
      label: `${Number(group.month.slice(5, 7))}月`,
      minutes: s.totalMinutes,
      kind: s.totalMinutes > 0 ? 'ok' : 'empty',
      title: monthLabel(group.month),
      lines: [
        `总加班 ${formatDuration(s.totalMinutes)}`,
        `${s.days} 个有效统计日 · 平均 ${formatDuration(s.avgMinutes)}/天`,
      ],
    };
  });
  renderBars(dom.chart, { items, ariaLabel: '每月加班时长' });
}

function statCell(value, unit, label, hint) {
  const wrap = el('div', 'stat');
  const line = el('div', 'stat-value');
  line.append(el('span', 'stat-num', value));
  if (unit) line.append(el('span', 'stat-unit', unit));
  wrap.append(line);
  wrap.append(el('div', 'stat-label', label));
  if (hint) wrap.append(el('div', 'stat-hint', hint));
  return wrap;
}

function renderOverview(summary, view) {
  dom.overviewTitle.textContent = view === 'all' ? '累计概览' : '本月概览';
  dom.statGrid.innerHTML = '';
  const cfg = settings();

  // 「月」与「全部」用同一组指标，口径一致、便于横向对比
  dom.statGrid.append(
    statCell(formatHours(summary.totalMinutes, 1), '小时', '总加班时长'),
  );
  dom.statGrid.append(
    statCell(String(summary.days), '天', '有效统计日', `共 ${summary.recordedDays} 天有打卡`),
  );
  dom.statGrid.append(
    statCell(
      summary.maxDay ? formatHours(summary.maxDay.otMinutes, 1) : '0',
      '小时',
      '最长单日加班',
      summary.maxDay ? `${dateLabel(summary.maxDay.date)} ${summary.maxDay.weekday}` : '暂无',
    ),
  );
  dom.statGrid.append(
    statCell(String(summary.forgotDays), '天', '忘打卡', cfg.forgotCounts ? '按 0 小时计入' : '未计入平均'),
  );

  const notes = [];
  if (summary.latest) {
    notes.push(`最晚下班 ${summary.latest.outTime}（${dateLabel(summary.latest.date)}）`);
  }
  if (summary.excludedDays) notes.push(`已排除 ${summary.excludedDays} 天`);
  if (summary.incompleteDays) notes.push(`数据不足 ${summary.incompleteDays} 天`);
  if (summary.pendingDays) notes.push(`待更新 ${summary.pendingDays} 天`);
  dom.cardNote.textContent = notes.length ? notes.join(' · ') : '暂无异常记录';
}

function badgeFor(day) {
  const map = {
    ok: 'badge--ok',
    forgot: 'badge--warn',
    incomplete: 'badge--muted',
    pending: 'badge--pending',
    excluded: 'badge--excluded',
  };
  return el('span', `badge ${map[day.status] || 'badge--muted'}`, STATUS_TEXT[day.status] || '');
}

function toggleButton(day) {
  const btn = el('button', 'row-toggle');
  btn.type = 'button';
  btn.setAttribute('aria-pressed', String(day.excluded));
  btn.title = day.excluded ? '已排除，点此恢复统计' : '点此从统计中排除';
  btn.setAttribute('aria-label', `${day.date} ${btn.title}`);
  btn.append(day.excluded ? svgIcon(ICON_CHECK) : svgIcon(ICON_MINUS));
  btn.addEventListener('click', () => onToggleExclusion(day.date));
  return btn;
}

/** 明细表头随视图变化：按天时有「排除」，按月时那一列是「查看」 */
function renderDetailHead(columns) {
  dom.detailHead.innerHTML = '';
  for (const col of columns) {
    const th = el('th', col.action ? 'th-act' : null, col.label);
    th.scope = 'col';
    dom.detailHead.append(th);
  }
}

function renderTableDays(days) {
  dom.detailBody.innerHTML = '';
  dom.detailTitle.textContent = '每日明细';
  dom.detailCount.textContent = `${days.length} 天`;
  renderDetailHead([
    { label: '日期' },
    { label: '打卡' },
    { label: '加班' },
    { label: '排除', action: true },
  ]);

  if (!days.length) {
    const tr = el('tr');
    const td = el('td', 'empty-cell', '该月暂无打卡记录');
    td.colSpan = 4;
    tr.append(td);
    dom.detailBody.append(tr);
    return;
  }

  for (const day of days.slice().reverse()) {
    const tr = el('tr', `row${day.excluded ? ' is-excluded' : ''}${day.counted ? '' : ' is-uncounted'}`);
    if (day.weekend) tr.classList.add('is-weekend');

    const tdDate = el('td', 'cell-date');
    tdDate.append(el('span', 'd-main', dateLabel(day.date)));
    tdDate.append(el('span', 'd-sub', day.weekday));
    tr.append(tdDate);

    const tdTime = el('td', 'cell-times');
    tdTime.append(el('span', 't-in', day.inTime));
    tdTime.append(el('span', 't-arrow', '→'));
    if (day.punches.length >= 2) {
      tdTime.append(el('span', 't-out', day.outTime));
    } else {
      tdTime.append(el('span', 't-out t-out--none', '--:--'));
    }
    tr.append(tdTime);

    const tdOt = el('td', 'cell-ot');
    const value = el('span', 'ot-val', day.counted || day.status === 'ok' ? formatDuration(day.otMinutes) : '—');
    if (day.status === 'ok' && day.otMinutes > 0) value.classList.add('is-ot');
    tdOt.append(value);
    tdOt.append(badgeFor(day));
    tr.append(tdOt);

    const tdAct = el('td', 'cell-act');
    tdAct.append(toggleButton(day));
    tr.append(tdAct);

    dom.detailBody.append(tr);
  }
}

/** 「全部」视图按月份汇总：行是月份，因此没有「排除」这一概念 */
function renderTableMonths() {
  dom.detailBody.innerHTML = '';
  const groups = monthGroups();
  dom.detailTitle.textContent = '每月明细';
  dom.detailCount.textContent = `${groups.length} 个月`;
  renderDetailHead([
    { label: '月份' },
    { label: '统计' },
    { label: '加班' },
    { label: '查看', action: true },
  ]);
  if (!groups.length) {
    const tr = el('tr');
    const td = el('td', 'empty-cell', '暂无打卡记录');
    td.colSpan = 4;
    tr.append(td);
    dom.detailBody.append(tr);
    return;
  }
  for (const { month, summary } of groups) {
    const tr = el('tr', 'row');

    const tdDate = el('td', 'cell-date');
    tdDate.append(el('span', 'd-main', `${Number(month.slice(5, 7))}月`));
    tdDate.append(el('span', 'd-sub', month.slice(0, 4)));
    tr.append(tdDate);

    const tdTime = el('td', 'cell-times');
    tdTime.append(el('span', 't-in', `${summary.days} 天`));
    tdTime.append(el('span', 't-arrow', '/'));
    tdTime.append(el('span', 't-out', `${summary.recordedDays} 天有卡`));
    tr.append(tdTime);

    const tdOt = el('td', 'cell-ot');
    const value = el('span', 'ot-val is-ot', `${formatHours(summary.totalMinutes, 1)} 小时`);
    tdOt.append(value);
    tdOt.append(el('span', 'badge badge--muted', `日均 ${formatDuration(summary.avgMinutes)}`));
    tr.append(tdOt);

    const tdAct = el('td', 'cell-act');
    const btn = el('button', 'row-toggle row-toggle--ghost');
    btn.type = 'button';
    btn.title = `查看 ${monthLabel(month)}`;
    btn.setAttribute('aria-label', btn.title);
    btn.append(svgIcon(ICON_CHART));
    btn.addEventListener('click', () => {
      state.view = 'month';
      state.month = month;
      render();
    });
    tdAct.append(btn);
    tr.append(tdAct);

    dom.detailBody.append(tr);
  }
}

function renderExcluded() {
  const entries = allExcludedEntries();
  dom.excludedChips.innerHTML = '';
  dom.excludedBlock.hidden = entries.length === 0;
  if (!entries.length) return;

  for (const entry of entries) {
    const chip = el('div', 'chip');
    chip.append(el('span', 'chip-date', dateLabel(entry.date)));

    const input = el('input', 'chip-note');
    input.type = 'text';
    input.placeholder = '备注';
    input.value = entry.note;
    input.maxLength = 20;
    input.addEventListener('change', () => {
      const next = { ...settings().exclusions };
      next[entry.date] = { excluded: true, note: input.value.trim() };
      store.save({ exclusions: next });
      recompute();
      render();
    });
    chip.append(input);

    const remove = el('button', 'chip-remove');
    remove.type = 'button';
    remove.title = '恢复纳入统计';
    remove.setAttribute('aria-label', `恢复 ${entry.date} 纳入统计`);
    remove.textContent = '×';
    remove.addEventListener('click', () => onToggleExclusion(entry.date));
    chip.append(remove);

    dom.excludedChips.append(chip);
  }
}

function renderFootnote() {
  const cfg = settings();
  const bits = [`标准下班时间 ${cfg.workdayEnd}`, `数据 ${state.records.length} 条`];
  if (state.syncedAt) bits.push(`最近同步 ${state.syncedAt.replace('T', ' ').slice(0, 16)}`);
  if (store.hasLocal()) bits.push('含本机未提交的标记');
  dom.footnote.textContent = bits.join(' · ');
}

function renderRules(host) {
  const cfg = settings();
  const items = [
    ['加班时长 = 末次打卡时间 − 标准下班时间', `（当前 ${cfg.workdayEnd}）`],
    ['一天多次打卡只取首条（上班）与末条（下班）', '中午的卡是早上下班卡，不参与计算'],
    ['末次打卡早于标准下班时间', '视为忘打卡，当天加班记 0'],
    ['打卡次数不足或当天数据未出全', '不纳入统计，避免拉低平均'],
    ['平均加班 = 加班总时长 ÷ 有效统计天数', '被排除的日期不参与任何汇总'],
    ['明细表最后一列用于勾选排除', '再次点击即恢复纳入统计'],
    ['图表中被排除的灰柱按平均值示意高度', '灰柱高度不代表当天真实加班时长'],
  ];
  host.innerHTML = '';
  for (const [main, tail] of items) {
    const li = el('li');
    const strong = el('b', null, main);
    li.append(strong, document.createTextNode(`　${tail}`));
    host.append(li);
  }
}

/* ------------------------------------------------------------------ *
 * 交互
 * ------------------------------------------------------------------ */

function onToggleExclusion(date) {
  const cfg = settings();
  const next = toggleExclusion(cfg.exclusions, date);
  const excluded = Boolean(next[date]);
  store.save({ exclusions: next });
  recompute();
  render();
  toast(excluded ? `已排除 ${dateLabel(date)}，不计入统计` : `已恢复 ${dateLabel(date)}`);
}

function closeSheet() {
  dom.sheet.hidden = true;
  dom.backdrop.hidden = true;
  dom.sheet.innerHTML = '';
  document.body.classList.remove('has-sheet');
}

function openSheet(title, buildBody) {
  dom.sheet.innerHTML = '';
  const head = el('div', 'sheet-head');
  head.append(el('h2', 'sheet-title', title));
  const close = el('button', 'sheet-close');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '×';
  close.addEventListener('click', closeSheet);
  head.append(close);
  dom.sheet.append(head);

  const body = el('div', 'sheet-body');
  buildBody(body);
  dom.sheet.append(body);

  dom.sheet.hidden = false;
  dom.backdrop.hidden = false;
  document.body.classList.add('has-sheet');
}

function openMonthSheet() {
  const groups = monthGroups().slice().reverse();
  openSheet('选择月份', (body) => {
    if (!groups.length) {
      body.append(el('p', 'sheet-empty', '暂无数据'));
      return;
    }
    const list = el('div', 'month-list');
    for (const group of groups) {
      const item = el('button', `month-item${group.month === state.month ? ' is-active' : ''}`);
      item.type = 'button';
      item.append(el('span', 'month-item-label', monthLabel(group.month)));
      item.append(
        el(
          'span',
          'month-item-meta',
          `${group.summary.days} 天 · 日均 ${formatDuration(group.summary.avgMinutes)}`,
        ),
      );
      item.addEventListener('click', () => {
        state.view = 'month';
        state.month = group.month;
        closeSheet();
        render();
      });
      list.append(item);
    }
    body.append(list);
  });
}

function openRulesSheet() {
  openSheet('统计规则', (body) => {
    const list = el('ul', 'rules');
    renderRules(list);
    body.append(list);
    body.append(el('p', 'sheet-note', '规则来自当前设置，修改标准下班时间等设置后即时生效。'));
  });
}

function settingRow(label, hint, control) {
  const row = el('div', 'setting-row');
  const text = el('div', 'setting-text');
  text.append(el('span', 'setting-label', label));
  if (hint) text.append(el('span', 'setting-hint', hint));
  row.append(text, control);
  return row;
}

function switchControl(checked, onChange) {
  const label = el('label', 'switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const track = el('span', 'switch-track');
  track.append(el('span', 'switch-thumb'));
  label.append(input, track);
  return label;
}

function openSettingsSheet() {
  openSheet('设置', (body) => {
    const cfg = settings();

    const time = document.createElement('input');
    time.type = 'time';
    time.className = 'input input--time';
    time.value = cfg.workdayEnd;
    time.addEventListener('change', () => {
      if (!/^\d{2}:\d{2}$/.test(time.value)) return;
      store.save({ workdayEnd: time.value });
      recompute();
      render();
      toast(`标准下班时间已设为 ${time.value}`);
    });
    body.append(settingRow('标准下班时间', '晚于该时间的打卡才算加班', time));

    const minP = document.createElement('input');
    minP.type = 'number';
    minP.className = 'input input--num';
    minP.min = '1';
    minP.max = '6';
    minP.value = String(cfg.minPunches);
    minP.addEventListener('change', () => {
      const v = Math.min(6, Math.max(1, Number(minP.value) || 2));
      minP.value = String(v);
      store.save({ minPunches: v });
      recompute();
      render();
    });
    body.append(settingRow('最少打卡次数', '低于该次数视为数据不足，不纳入统计', minP));

    body.append(
      settingRow(
        '忘打卡日计入平均',
        '关闭后，末次打卡早于下班时间的日子不计入',
        switchControl(cfg.forgotCounts, (checked) => {
          store.save({ forgotCounts: checked });
          recompute();
          render();
        }),
      ),
    );

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'input input--date';
    dateInput.value = todayInCN();
    const addBtn = el('button', 'btn btn--primary', '添加');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
      const date = dateInput.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const next = { ...settings().exclusions, [date]: { excluded: true, note: '' } };
      store.save({ exclusions: next });
      recompute();
      render();
      toast(`已排除 ${dateLabel(date)}`);
    });
    const addWrap = el('div', 'inline-add');
    addWrap.append(dateInput, addBtn);
    body.append(settingRow('手动排除某天', '例如请假、调休（可不在打卡记录中）', addWrap));

    const actions = el('div', 'sheet-actions');
    const copyBtn = el('button', 'btn', '复制配置到剪贴板');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async () => {
      const text = store.exportConfig();
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制，可粘贴到 ot-ledger.config.json');
      } catch {
        toast('复制失败，请在浏览器中手动允许剪贴板');
      }
    });
    const resetBtn = el('button', 'btn btn--danger', '重置本机标记');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => {
      store.reset();
      recompute();
      render();
      closeSheet();
      toast('已重置为本仓库默认配置');
    });
    actions.append(copyBtn, resetBtn);
    body.append(actions);

    const info = el('div', 'sheet-info');
    const rows = [
      ['数据条数', `${state.records.length} 条`],
      ['最近同步', state.syncedAt ? state.syncedAt.replace('T', ' ').slice(0, 19) : '—'],
      ['仓库默认配置', store.remoteFound ? 'ot-ledger.config.json' : '未提供（可选）'],
      ['计算规则', '加班 = 末次打卡 − 标准下班时间'],
    ];
    for (const [k, v] of rows) {
      const line = el('div', 'info-row');
      line.append(el('span', 'info-key', k), el('span', 'info-val', v));
      info.append(line);
    }
    body.append(info);
  });
}

function bindEvents() {
  dom.monthPicker.addEventListener('click', openMonthSheet);
  dom.btnSettings.addEventListener('click', openSettingsSheet);
  dom.btnRules.addEventListener('click', openRulesSheet);
  dom.backdrop.addEventListener('click', closeSheet);
  dom.segmented.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn || btn.dataset.view === state.view) return;
    state.view = btn.dataset.view;
    render();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.sheet.hidden) closeSheet();
  });
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

function showFatal(message, detail) {
  dom.chartTitle.textContent = '数据加载失败';
  dom.chart.innerHTML = '';
  const box = el('div', 'fatal');
  box.append(el('p', 'fatal-title', message));
  if (detail) box.append(el('p', 'fatal-detail', detail));
  const hint = el('p', 'fatal-detail', '提示：直接双击打开 index.html 时浏览器会拦截本地文件读取，请用本地静态服务器或部署到 GitHub Pages。');
  box.append(hint);
  dom.chart.append(box);
}

async function bootstrap() {
  store.init();
  bindEvents();

  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    state.records = parseRecords(text);
    state.syncedAt = lastSyncedAt(state.records);
    state.loaded = true;
  } catch (error) {
    state.error = error;
    dom.chartTitle.textContent = '';
    dom.heroValue.textContent = '—';
    dom.heroCaption.textContent = '未能读取 otData/all.csv';
    dom.detailBody.innerHTML = '';
    showFatal('未能读取 otData/all.csv', String(error && error.message ? error.message : error));
    dom.footnote.textContent = '—';
    return;
  }

  await store.loadRemote();
  recompute();
  render();
  renderFootnote();
}

// 每分钟刷新一次「今日待更新」状态
setInterval(() => {
  if (!state.loaded) return;
  const before = state.days.map((d) => `${d.date}:${d.status}`).join();
  recompute();
  const after = state.days.map((d) => `${d.date}:${d.status}`).join();
  if (before !== after) render();
}, 60000);

void bootstrap();
