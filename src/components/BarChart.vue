<script setup>
/**
 * 极简 SVG 柱状图：右侧刻度 + 虚线网格 + 悬停提示
 *
 * 从原 chart.js 的命令式 DOM 构建改写为声明式模板：
 *   - 布局计算（niceScale / 坐标）保持纯函数，逻辑与原来完全一致
 *   - 悬停/聚焦提示改为响应式状态，不再手动 showTip/hideTip
 *   - 宽度用 ResizeObserver 跟踪（原来靠 clientWidth 读取 + WeakMap）
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps({
  items: { type: Array, default: () => [] },
  /** 'auto' | 'day' */
  labelMode: { type: String, default: 'auto' },
  /** 平均值参考线（分钟），>0 时绘制 */
  avgMinutes: { type: Number, default: 0 },
  ariaLabel: { type: String, default: '加班时长柱状图' },
});

/* 主题色与 app.css 的 --accent 保持一致 */
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

/**
 * 选择「整点 / 整半小时」刻度，保证右侧刻度落在好看的小时值上。
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

/* ---------------- 尺寸跟踪 ---------------- */
const host = ref(null);
const width = ref(0);
let observer = null;

onMounted(() => {
  width.value = Math.round(host.value?.clientWidth || 0);
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0 && w !== width.value) width.value = w;
    });
    observer.observe(host.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});

/* ---------------- 布局计算 ---------------- */
const layout = computed(() => {
  const items = props.items;
  if (!items.length) return null;

  const w = Math.max(240, width.value || 320);
  const h = w < 520 ? 200 : 236;
  const pad = { top: 18, right: 40, bottom: 26, left: 4 };
  const plotW = Math.max(20, w - pad.left - pad.right);
  const plotH = h - pad.top - pad.bottom;
  const y0 = pad.top + plotH;

  const { max, ticks } = niceScale(Math.max(...items.map((it) => it.minutes || 0)));
  const toY = (minutes) => y0 - (minutes / max) * plotH;

  const gridLines = [];
  for (let t = 0; t <= ticks; t += 1) {
    const minutes = (max / ticks) * t;
    gridLines.push({
      y: toY(minutes),
      tickLabel: t === 0 ? '0' : String(Math.round((minutes / 60) * 10) / 10),
      baseline: t === 0,
    });
  }

  const step = plotW / items.length;
  const barW = Math.max(3.4, Math.min(16, step * 0.66));

  const bars = items.map((item, i) => {
    const cx = pad.left + step * (i + 0.5);
    const minutes = item.minutes || 0;
    const kind = item.kind || 'ok';
    const solid = (kind === 'ok' || kind === 'excluded') && minutes > 0;
    const colors = {
      forgot: COLOR.forgot,
      pending: COLOR.pending,
      incomplete: COLOR.incomplete,
      empty: COLOR.empty,
      ok: COLOR.empty,
    };
    return {
      item,
      cx,
      kind,
      // 实心柱
      solid,
      solidY: toY(minutes),
      solidH: Math.max(2, y0 - toY(minutes)),
      solidFill: kind === 'excluded' ? COLOR.excluded : COLOR.bar,
      // 基线上的占位小段（非实心柱时）
      stubFill: colors[kind] || COLOR.empty,
      showStub: !solid && kind !== 'future',
      // 忘打卡的小圆环
      ring: kind === 'forgot',
      showLabel: Boolean(item.label) && labelVisible(item, i, items.length, props.labelMode),
    };
  });

  return {
    w, h, pad, plotW, plotH, y0, step, barW, gridLines, bars,
    avgY: props.avgMinutes > 0 ? toY(props.avgMinutes) : null,
  };
});

/* ---------------- 悬停提示 ---------------- */
const active = ref(-1);

function tipStyle() {
  const l = layout.value;
  if (!l || active.value < 0) return {};
  const bar = l.bars[active.value];
  const hostW = host.value?.clientWidth || l.w;
  const scale = hostW / l.w;
  const left = Math.min(Math.max(bar.cx * scale, 8), Math.max(8, hostW - 8));
  return { left: `${left}px` };
}

const activeItem = computed(() =>
  active.value >= 0 ? props.items[active.value] : null,
);

const svgHeight = computed(() => (layout.value ? layout.value.h : 0));
</script>

<template>
  <!-- class="chart" 复用 app.css 里既有的定位 / 焦点样式（提示框依赖 position:relative） -->
  <div
    ref="host"
    class="chart"
    @pointerleave="active = -1"
  >
    <p v-if="!items.length" class="chart-empty">暂无打卡数据</p>

    <template v-else-if="layout">
      <svg
        :viewBox="`0 0 ${layout.w} ${layout.h}`"
        width="100%"
        :height="svgHeight"
        role="img"
        :aria-label="ariaLabel"
      >
        <!-- 网格线 + 右侧刻度 -->
        <g>
          <template v-for="(g, gi) in layout.gridLines" :key="`g${gi}`">
            <line
              :x1="layout.pad.left"
              :x2="layout.pad.left + layout.plotW"
              :y1="g.y"
              :y2="g.y"
              :stroke="g.baseline ? 'rgba(0, 0, 0, .16)' : COLOR.grid"
              stroke-width="1"
              :stroke-dasharray="g.baseline ? undefined : '3 3'"
              shape-rendering="crispEdges"
            />
            <text
              :x="layout.pad.left + layout.plotW + 8"
              :y="g.y + 4"
              :fill="COLOR.axis"
              font-size="11"
              font-family="inherit"
            >{{ g.tickLabel }}</text>
          </template>
        </g>

        <!-- 平均值参考线 -->
        <g v-if="layout.avgY !== null">
          <line
            :x1="layout.pad.left"
            :x2="layout.pad.left + layout.plotW"
            :y1="layout.avgY"
            :y2="layout.avgY"
            :stroke="COLOR.avgLine"
            stroke-width="1"
            stroke-dasharray="4 3"
          />
        </g>

        <!-- 柱子 -->
        <g>
          <template v-for="(bar, i) in layout.bars" :key="bar.item.key ?? i">
            <rect
              v-if="bar.solid"
              :x="bar.cx - layout.barW / 2"
              :y="bar.solidY"
              :width="layout.barW"
              :height="bar.solidH"
              :rx="Math.min(3, layout.barW / 2)"
              :fill="bar.solidFill"
            />
            <rect
              v-else-if="bar.showStub"
              :x="bar.cx - layout.barW / 2"
              :y="layout.y0 - 2"
              :width="layout.barW"
              height="2"
              rx="1"
              :fill="bar.stubFill"
            />

            <circle
              v-if="bar.ring"
              :cx="bar.cx"
              :cy="layout.y0 - 13"
              r="2.8"
              fill="#fff"
              :stroke="COLOR.forgot"
              stroke-width="1.6"
            />

            <text
              v-if="bar.showLabel"
              :x="bar.cx"
              :y="layout.h - 8"
              :fill="COLOR.axis"
              font-size="11"
              text-anchor="middle"
              font-family="inherit"
            >{{ bar.item.label }}</text>

            <!-- 命中区域（整列）：指针进入 / 聚焦时显示提示 -->
            <rect
              :x="layout.pad.left + layout.step * i"
              :y="layout.pad.top"
              :width="layout.step"
              :height="layout.plotH"
              fill="transparent"
              tabindex="0"
              role="button"
              :aria-label="bar.item.title || bar.item.label || ''"
              @pointerenter="active = i"
              @pointermove="active = i"
              @focus="active = i"
              @blur="active = -1"
            />
          </template>
        </g>
      </svg>

      <!-- 提示框 -->
      <div
        v-if="activeItem"
        class="chart-tip is-visible"
        :style="tipStyle()"
      >
        <strong>{{ activeItem.title || activeItem.label }}</strong>
        <span v-for="(line, li) in activeItem.lines || []" :key="li">{{ line }}</span>
      </div>
    </template>
  </div>
</template>
