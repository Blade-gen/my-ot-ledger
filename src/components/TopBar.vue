<script setup>
import AppIcon from './AppIcon.vue';

defineProps({
  view: { type: String, required: true }, // 'month' | 'all'
  monthText: { type: String, default: '' },
});

const emit = defineEmits(['pick-month', 'open-settings', 'open-rules', 'change-view']);
</script>

<template>
  <header class="topbar">
    <div class="topbar-side"></div>
    <div class="topbar-main">
      <div class="title-row">
        <h1 class="app-title">加班时长</h1>
        <button
          type="button"
          class="icon-btn icon-btn--title"
          aria-label="统计规则"
          aria-haspopup="dialog"
          @click="emit('open-rules')"
        >
          <AppIcon name="info" :size="18" />
        </button>
      </div>
      <button
        type="button"
        class="month-picker"
        aria-haspopup="dialog"
        :disabled="view === 'all'"
        @click="emit('pick-month')"
      >
        <!-- 左侧占位与右侧箭头等宽，让「文字」本身居于整行中心。
             没有它时 flex 会把文字+箭头作为整体居中，
             文字就会被箭头挤得偏左（实测偏 7.5px）。 -->
        <span class="picker-spacer" aria-hidden="true"></span>
        <span class="picker-label">{{ monthText }}</span>
        <AppIcon name="caret" class="picker-caret" :size="16" />
      </button>
    </div>
    <div class="topbar-side right">
      <button
        type="button"
        class="icon-btn"
        aria-label="设置"
        aria-haspopup="dialog"
        @click="emit('open-settings')"
      >
        <AppIcon name="dots" />
      </button>
    </div>
  </header>

  <div class="segmented" role="tablist" aria-label="统计范围">
    <button
      type="button"
      class="seg"
      :class="{ 'is-active': view === 'month' }"
      role="tab"
      :aria-selected="view === 'month'"
      @click="emit('change-view', 'month')"
    >月</button>
    <button
      type="button"
      class="seg"
      :class="{ 'is-active': view === 'all' }"
      role="tab"
      :aria-selected="view === 'all'"
      @click="emit('change-view', 'all')"
    >全部</button>
  </div>
</template>
