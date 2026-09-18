<script setup>
import { computed } from 'vue';
import { STATUS_TEXT, dateLabel, formatDuration, formatHours } from '../lib/model.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  view: { type: String, required: true },
  /** 月视图：按天；全部视图：按月 */
  days: { type: Array, default: () => [] },
  groups: { type: Array, default: () => [] },
});

const emit = defineEmits(['toggle-date', 'open-month']);

const BADGE_CLASS = {
  ok: 'badge--ok',
  forgot: 'badge--warn',
  incomplete: 'badge--muted',
  pending: 'badge--pending',
  excluded: 'badge--excluded',
};

const title = computed(() => (props.view === 'all' ? '每月明细' : '每日明细'));
const countText = computed(() =>
  props.view === 'all' ? `${props.groups.length} 个月` : `${props.days.length} 天`,
);

/** 逆序：最新在前 */
const dayRows = computed(() => props.days.slice().reverse());

function rowClass(day) {
  return [
    'row',
    day.excluded ? 'is-excluded' : '',
    day.counted ? '' : 'is-uncounted',
    day.weekend ? 'is-weekend' : '',
  ];
}

function otText(day) {
  return day.counted || day.status === 'ok' ? formatDuration(day.otMinutes) : '—';
}
</script>

<template>
  <section class="card detail-card">
    <div class="card-head">
      <span class="card-icon">
        <AppIcon name="calendar" :size="16" />
      </span>
      <h2>{{ title }}</h2>
      <span class="card-head-extra">{{ countText }}</span>
    </div>

    <div class="table-wrap">
      <table class="detail-table">
        <thead>
          <tr>
            <th scope="col">{{ view === 'all' ? '月份' : '日期' }}</th>
            <th scope="col">{{ view === 'all' ? '统计' : '打卡' }}</th>
            <th scope="col">加班</th>
            <th scope="col" class="th-act">{{ view === 'all' ? '查看' : '排除' }}</th>
          </tr>
        </thead>

        <tbody>
          <!-- 空状态 -->
          <tr v-if="view === 'all' && !groups.length">
            <td class="empty-cell" colspan="4">暂无打卡记录</td>
          </tr>
          <tr v-else-if="view === 'month' && !days.length">
            <td class="empty-cell" colspan="4">该月暂无打卡记录</td>
          </tr>

          <!-- 月视图：每日 -->
          <template v-else-if="view === 'month'">
            <tr v-for="day in dayRows" :key="day.date" :class="rowClass(day)">
              <td class="cell-date">
                <span class="d-main">{{ dateLabel(day.date) }}</span>
                <span class="d-sub">{{ day.weekday }}</span>
              </td>
              <td class="cell-times">
                <span class="t-in">{{ day.inTime || '--:--' }}</span>
                <span class="t-arrow">→</span>
                <span v-if="day.punches.length >= 2" class="t-out">{{ day.outTime }}</span>
                <span v-else class="t-out t-out--none">--:--</span>
              </td>
              <td class="cell-ot">
                <span
                  class="ot-val"
                  :class="{ 'is-ot': day.status === 'ok' && day.otMinutes > 0 }"
                >{{ otText(day) }}</span>
                <span class="badge" :class="BADGE_CLASS[day.status] || 'badge--muted'">
                  {{ STATUS_TEXT[day.status] || '' }}
                </span>
              </td>
              <td class="cell-act">
                <button
                  type="button"
                  class="row-toggle"
                  :aria-pressed="String(day.excluded)"
                  :title="day.excluded ? '已排除，点此恢复统计' : '点此从统计中排除'"
                  :aria-label="`${day.date} ${day.excluded ? '已排除，点此恢复统计' : '点此从统计中排除'}`"
                  @click="emit('toggle-date', day.date)"
                >
                  <AppIcon :name="day.excluded ? 'check' : 'minus'" :size="16" />
                </button>
              </td>
            </tr>
          </template>

          <!-- 全部视图：每月 -->
          <template v-else>
            <tr v-for="g in groups" :key="g.month" class="row">
              <td class="cell-date">
                <span class="d-main">{{ Number(g.month.slice(5, 7)) }}月</span>
                <span class="d-sub">{{ g.month.slice(0, 4) }}</span>
              </td>
              <td class="cell-times">
                <span class="t-in">{{ g.summary.days }} 天</span>
                <span class="t-arrow">/</span>
                <span class="t-out">{{ g.summary.recordedDays }} 天有卡</span>
              </td>
              <td class="cell-ot">
                <span class="ot-val is-ot">{{ formatHours(g.summary.totalMinutes, 1) }} 小时</span>
                <span class="badge badge--muted">日均 {{ formatDuration(g.summary.avgMinutes) }}</span>
              </td>
              <td class="cell-act">
                <button
                  type="button"
                  class="row-toggle row-toggle--ghost"
                  :title="`查看 ${g.month}`"
                  :aria-label="`查看 ${g.month}`"
                  @click="emit('open-month', g.month)"
                >
                  <AppIcon name="chart" :size="16" />
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>
