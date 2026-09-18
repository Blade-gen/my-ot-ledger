<script setup>
import { computed } from 'vue';
import { formatDuration, formatHours } from '../lib/model.js';

const props = defineProps({
  summary: { type: Object, required: true },
  days: { type: Array, default: () => [] },
  scopeText: { type: String, default: '' },
});

const heroValue = computed(() => formatHours(props.summary.avgMinutes, 2));

const caption = computed(() => {
  const parts = [`${props.scopeText}共 ${props.summary.days} 个有效统计日`];
  if (props.days.length) {
    parts.push(`总加班 ${formatHours(props.summary.totalMinutes, 1)} 小时`);
  }
  return parts.join(' · ');
});

const avgText = computed(() => formatDuration(props.summary.avgMinutes));
</script>

<template>
  <div class="hero">
    <div class="hero-value">
      <span>{{ heroValue }}</span>
      <span class="hero-unit">小时/天</span>
    </div>
    <p class="hero-caption">{{ caption }}</p>
  </div>
</template>
