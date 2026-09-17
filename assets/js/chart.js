/**
 * 极简 SVG 柱状图：右侧刻度 + 虚线网格 + 悬停提示
 *
 * items: [{
 *   key, label, dayNumber?, showLabel?,
 *   minutes,                 // 柱子高度（分钟）
 *   kind: 'ok' | 'excluded' | 'forgot' | 'pending' | 'incomplete' | 'empty' | 'future',
 *   title, lines: []
 * }]
 *
 * opts:
 *   labelMode    'auto'（默认）| 'day'（按日：1日/7日/14日/21日/28日）
 *   avgMinutes   平均值（分钟），> 0 时画一条虚线参考
 */

const NS = 'http://www.w3.org/2000/svg';

/** 主题色（与 app.css 的 --accent 保持一致） */
const COLOR = {
  bar: '#f4575a',
  excluded: '#d7d7dd',
  forgot: '#f4575a',
  pending: '#e3e3e8',
  incomplete: '#dcdce2',
  empty: '#e8e8ec',
  grid: 'rgba(0, 0, 0, .08)',
  axis: '#9c9ca4',
  avgLine: '#bfbfc8',
};

function node(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  return el;
}

/**
 * 选择「整点/整半小时」的刻度，保证右侧刻度落在好看的小时值上。
 * 返回 { max, ticks }，max 单位为分钟。
 */
function niceScale(value) {
  const steps = [15, 30, 60, 120, 180, 240, 300, 600, 1200];
  const target = Math.max(value, 15);
  for (const step of steps) {
    const ticks = Math.ceil(target / step);
    if (ticks <= 5) return { max: step * ticks, ticks: Math.max(ticks, 1) };
  }
  const step = 1200;
  return { max: step * Math.ceil(target / step), ticks: Math.ceil(target / step) };
}

const HOST_STATE = new WeakMap();
let observer = null;

function ensureObserver() {
  if (observer || typeof ResizeObserver === 'undefined') return observer;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const state = HOST_STATE.get(entry.target);
      if (!state) continue;
      const width = Math.round(entry.contentRect.width);
      if (width === state.width || width <= 0) continue;
      draw(entry.target, state.opts, width);
    }
  });
  return observer;
}

export function renderBars(host, opts) {
  const width = Math.round(host.clientWidth || 0);
  draw(host, opts, width);
  const obs = ensureObserver();
  if (obs && !HOST_STATE.get(host)) obs.observe(host);
  HOST_STATE.set(host, { opts, width });
}

/** 该柱是否需要在横轴上显示文字 */
function labelVisible(item, i, total, labelMode) {
  if (item.showLabel !== undefined) return item.showLabel;
  if (labelMode === 'day') {
    const n = Number(item.dayNumber);
    return n === 1 || n % 7 === 0;
  }
  const stride = Math.ceil(total / 8);
  return i % stride === 0 || i === total - 1;
}

function draw(host, opts, width) {
  const { items, labelMode = 'auto', avgMinutes = 0 } = opts;
  host.innerHTML = '';
  if (!items || !items.length) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = '暂无打卡数据';
    host.append(empty);
    return;
  }

  const w = Math.max(240, width || 320);
  const h = w < 520 ? 200 : 236;
  const pad = { top: 18, right: 40, bottom: 26, left: 4 };
  const plotW = Math.max(20, w - pad.left - pad.right);
  const plotH = h - pad.top - pad.bottom;
  const y0 = pad.top + plotH;

  const { max, ticks } = niceScale(Math.max(...items.map((it) => it.minutes || 0)));
  const toY = (minutes) => y0 - (minutes / max) * plotH;

  const svg = node('svg', {
    viewBox: `0 0 ${w} ${h}`,
    width: '100%',
    height: h,
    role: 'img',
    'aria-label': opts.ariaLabel || '加班时长柱状图',
  });

  // 柱子用实心色，不用渐变
  const barFill = opts.barColor || COLOR.bar;

  // 网格线 + 右侧刻度
  for (let t = 0; t <= ticks; t += 1) {
    const minutes = (max / ticks) * t;
    const y = toY(minutes);
    svg.append(
      node('line', {
        x1: pad.left,
        x2: pad.left + plotW,
        y1: y,
        y2: y,
        stroke: t === 0 ? 'rgba(0, 0, 0, .16)' : COLOR.grid,
        'stroke-width': 1,
        'stroke-dasharray': t === 0 ? null : '3 3',
        'shape-rendering': 'crispEdges',
      }),
    );
    const label = node('text', {
      x: pad.left + plotW + 8,
      y: y + 4,
      fill: COLOR.axis,
      'font-size': 11,
      'font-family': 'inherit',
    });
    label.textContent = t === 0 ? '0' : String(Math.round((minutes / 60) * 10) / 10);
    svg.append(label);
  }

  const step = plotW / items.length;
  const barW = Math.max(3.4, Math.min(16, step * 0.66));

  // 平均值参考线：只要当天均值可算就显示
  if (avgMinutes > 0) {
    const y = toY(avgMinutes);
    svg.append(
      node('line', {
        x1: pad.left,
        x2: pad.left + plotW,
        y1: y,
        y2: y,
        stroke: COLOR.avgLine,
        'stroke-width': 1,
        'stroke-dasharray': '4 3',
      }),
    );
    const tag = node('text', {
      x: pad.left + 2,
      y: y - 4,
      fill: COLOR.avgLine,
      'font-size': 10,
      'font-family': 'inherit',
    });
    tag.textContent = '平均值';
    svg.append(tag);
  }

  items.forEach((item, i) => {
    const cx = pad.left + step * (i + 0.5);
    const minutes = item.minutes || 0;
    const kind = item.kind || 'ok';

    if ((kind === 'ok' || kind === 'excluded') && minutes > 0) {
      const y = toY(minutes);
      svg.append(
        node('rect', {
          x: cx - barW / 2,
          y,
          width: barW,
          height: Math.max(2, y0 - y),
          rx: Math.min(3, barW / 2),
          fill: kind === 'excluded' ? COLOR.excluded : barFill,
        }),
      );
    } else if (kind !== 'future') {
      // 忘打卡 / 待更新 / 数据不足 / 无数据：基线上画一小段占位
      const colors = {
        forgot: COLOR.forgot,
        pending: COLOR.pending,
        incomplete: COLOR.incomplete,
        empty: COLOR.empty,
        ok: COLOR.empty,
      };
      svg.append(
        node('rect', {
          x: cx - barW / 2,
          y: y0 - 2,
          width: barW,
          height: 2,
          rx: 1,
          fill: colors[kind] || COLOR.empty,
        }),
      );
    }

    // 忘打卡：基线上方画一个小空心圆环，形状上区别于柱体
    if (kind === 'forgot') {
      svg.append(
        node('circle', {
          cx,
          cy: y0 - 13,
          r: 2.8,
          fill: '#fff',
          stroke: COLOR.forgot,
          'stroke-width': 1.6,
        }),
      );
    }

    if (item.label && labelVisible(item, i, items.length, labelMode)) {
      const text = node('text', {
        x: cx,
        y: h - 8,
        fill: COLOR.axis,
        'font-size': 11,
        'text-anchor': 'middle',
        'font-family': 'inherit',
      });
      text.textContent = item.label;
      svg.append(text);
    }

    // 命中区域（整列）
    const hit = node('rect', {
      x: pad.left + step * i,
      y: pad.top,
      width: step,
      height: plotH,
      fill: 'transparent',
      tabindex: '0',
      role: 'button',
      'aria-label': item.title || item.label || '',
    });
    hit.addEventListener('pointerenter', () => showTip(host, svg, cx, pad, item));
    hit.addEventListener('pointermove', () => showTip(host, svg, cx, pad, item));
    hit.addEventListener('focus', () => showTip(host, svg, cx, pad, item));
    hit.addEventListener('pointerleave', () => hideTip(host));
    hit.addEventListener('blur', () => hideTip(host));
    svg.append(hit);
  });

  host.append(svg);
  host.dataset.chartWidth = String(w);
}

function showTip(host, svg, cx, pad, item) {
  let tip = host.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    host.append(tip);
  }
  tip.innerHTML = '';
  const title = document.createElement('strong');
  title.textContent = item.title || item.label || '';
  tip.append(title);
  for (const line of item.lines || []) {
    const p = document.createElement('span');
    p.textContent = line;
    tip.append(p);
  }

  const svgW = Number(host.dataset.chartWidth) || svg.clientWidth || 320;
  const scale = (host.clientWidth || svgW) / svgW;
  const left = Math.min(Math.max(cx * scale, 8), Math.max(8, (host.clientWidth || 320) - 8));
  tip.style.left = `${left}px`;
  tip.classList.add('is-visible');
}

function hideTip(host) {
  const tip = host.querySelector('.chart-tip');
  if (tip) tip.classList.remove('is-visible');
}
