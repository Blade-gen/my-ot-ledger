<script setup>
import { computed } from 'vue';
import { dateLabel, daysInMonth, formatDuration, monthLabel, summarize, todayInCN, weekdayOf } from '../lib/model.js';
import BarChart from './BarChart.vue';

const props = defineProps({
  view: { type: String, required: true },
  month: { type: String, default: null },
  days: { type: Array, default: () => [] },
  groups: { type: Array, default: () => [] },
  /** 当天还没下班卡时是否按 0 加班计入（影响提示文案） */
  pendingCounts: { type: Boolean, default: false },
});

/* ---------------- 月视图：每日加班时长 ---------------- */
const monthChart = computed(() => {
  const list = props.days;
  if (!list.length || !props.month) return { items: [], avgMinutes: 0, title: '' };

  const summary = summarize(list);
  const avgMinutes = summary.avgMinutes;
  const today = todayInCN();
  const byDate = new Map(list.map((day) => [day.date, day]));
  const total = daysInMonth(props.month);

  // 整月铺满：没有打卡记录的日子也要占位，柱状图才能反映「今天是几号」
  const items = [];
  for (let d = 1; d <= total; d += 1) {
    const date = `${props.month}-${String(d).padStart(2, '0')}`;
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

  return {
    items,
    avgMinutes,
    title: `${monthLabel(props.month)} · 每日加班时长`,
    ariaLabel: `${monthLabel(props.month)} 每日加班时长`,
  };
});

function tipFor(day, grayMinutes = 0) {
  const lines = [
    // 打开 pendingCounts 时，一条卡都没有的「今天」也会进到 days 里，
    // 此时 inTime 是空串，不能套「仅 X 一次打卡」那句话。
    !day.punches.length
      ? '今日暂无打卡记录'
      : day.punches.length >= 2
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
  else if (day.status === 'pending') {
    lines.push(props.pendingCounts ? '今日待更新，暂按 0 加班计入平均' : '今日待更新，暂不纳入统计');
  } else lines.push('不纳入统计');
  return lines;
}

/* ---------------- 全部视图：每月加班时长 ---------------- */
const allChart = computed(() => {
  const list = props.groups.slice().reverse();
  if (!list.length) return { items: [], avgMinutes: 0, title: '每月加班时长' };

  const items = list.map((group) => {
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

  return { items, avgMinutes: 0, title: '每月加班时长', ariaLabel: '每月加班时长' };
});

const chart = computed(() => (props.view === 'all' ? allChart.value : monthChart.value));
</script>

<template>
  <div class="chart-block">
    <p class="chart-title">{{ chart.title }}</p>
    <BarChart
      :items="chart.items"
      :avg-minutes="chart.avgMinutes || 0"
      :label-mode="view === 'month' ? 'day' : 'auto'"
      :aria-label="chart.ariaLabel || '加班时长柱状图'"
    />
    <div class="legend">
      <span class="lg"><i class="sw sw--bar"></i>加班时长</span>
      <span class="lg"><i class="sw sw--avg"></i>平均值</span>
      <span class="lg"><i class="sw sw--dot"></i>忘打卡</span>
      <span class="lg"><i class="sw sw--ex"></i>无数据</span>
    </div>
  </div>
</template>
