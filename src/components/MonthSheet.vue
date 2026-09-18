<script setup>
import { computed } from 'vue';
import { formatDuration, monthLabel } from '../lib/model.js';
import BottomSheet from './BottomSheet.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  months: { type: Array, default: () => [] },
  counts: { type: Object, default: () => ({}) },
  current: { type: String, default: null },
  /** 当前月份的汇总，仅用于当前选中项展示日均 */
  summary: { type: Object, default: null },
});

const emit = defineEmits(['close', 'pick']);

/** 最新的月份排在前面 */
const list = computed(() =>
  props.months
    .slice()
    .reverse()
    .map((m) => {
      const parts = [];
      if (Number.isFinite(props.counts[m])) parts.push(`${props.counts[m]} 条记录`);
      if (m === props.current && props.summary) {
        parts.push(`${props.summary.days} 天 · 日均 ${formatDuration(props.summary.avgMinutes)}`);
      }
      return { month: m, text: monthLabel(m), meta: parts.join(' · ') || '点击查看' };
    }),
);
</script>

<template>
  <BottomSheet :open="open" title="选择月份" @close="emit('close')">
    <p v-if="!list.length" class="sheet-empty">暂无数据</p>
    <div v-else class="month-list">
      <button
        v-for="item in list"
        :key="item.month"
        type="button"
        class="month-item"
        :class="{ 'is-active': item.month === current }"
        @click="emit('pick', item.month)"
      >
        <span class="month-item-label">{{ item.text }}</span>
        <span class="month-item-meta">{{ item.meta }}</span>
      </button>
    </div>
  </BottomSheet>
</template>
