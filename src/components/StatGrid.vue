<script setup>
import { computed } from 'vue';
import { dateLabel, formatHours } from '../lib/model.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  summary: { type: Object, required: true },
  view: { type: String, required: true },
  forgotCounts: { type: Boolean, default: true },
});

const title = computed(() => (props.view === 'all' ? '累计概览' : '本月概览'));

const cells = computed(() => {
  const s = props.summary;
  return [
    {
      value: formatHours(s.totalMinutes, 1),
      unit: '小时',
      label: '总加班时长',
      hint: '',
    },
    {
      value: String(s.days),
      unit: '天',
      label: '有效统计日',
      hint: `共 ${s.recordedDays} 天有打卡`,
    },
    {
      value: s.maxDay ? formatHours(s.maxDay.otMinutes, 1) : '0',
      unit: '小时',
      label: '最长单日加班',
      hint: s.maxDay ? `${dateLabel(s.maxDay.date)} ${s.maxDay.weekday}` : '暂无',
    },
    {
      value: String(s.forgotDays),
      unit: '天',
      label: '忘打卡',
      hint: props.forgotCounts ? '按 0 小时计入' : '未计入平均',
    },
  ];
});

const note = computed(() => {
  const s = props.summary;
  const notes = [];
  if (s.latest) notes.push(`最晚下班 ${s.latest.outTime}（${dateLabel(s.latest.date)}）`);
  if (s.excludedDays) notes.push(`已排除 ${s.excludedDays} 天`);
  if (s.incompleteDays) notes.push(`数据不足 ${s.incompleteDays} 天`);
  if (s.pendingDays) notes.push(`待更新 ${s.pendingDays} 天`);
  return notes.length ? notes.join(' · ') : '暂无异常记录';
});
</script>

<template>
  <section class="card">
    <div class="card-head">
      <span class="card-icon">
        <AppIcon name="chart" :size="16" />
      </span>
      <h2>{{ title }}</h2>
    </div>
    <div class="stat-grid">
      <div v-for="(cell, i) in cells" :key="i" class="stat">
        <div class="stat-value">
          <span class="stat-num">{{ cell.value }}</span>
          <span v-if="cell.unit" class="stat-unit">{{ cell.unit }}</span>
        </div>
        <div class="stat-label">{{ cell.label }}</div>
        <div v-if="cell.hint" class="stat-hint">{{ cell.hint }}</div>
      </div>
    </div>
    <p class="card-note">{{ note }}</p>
  </section>
</template>
