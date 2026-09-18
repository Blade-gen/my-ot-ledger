<script setup>
/** 底部弹出面板（月份选择 / 统计规则 / 设置共用外壳） */
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
});
const emit = defineEmits(['close']);
</script>

<template>
  <template v-if="open">
    <div class="sheet-backdrop" @click="emit('close')"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <h2 class="sheet-title">{{ title }}</h2>
        <button
          type="button"
          class="sheet-close"
          aria-label="关闭"
          @click="emit('close')"
        >×</button>
      </div>
      <div class="sheet-body">
        <slot />
      </div>
    </div>
  </template>
</template>
