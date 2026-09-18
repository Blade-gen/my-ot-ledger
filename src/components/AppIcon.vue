<script setup>
/**
 * 统一图标组件，路径来自 Remix Icon（见 lib/icons.js）。
 * 一律 fill=currentColor，颜色由外层 CSS 的 color 控制。
 */
import { computed } from 'vue';
import { ICON_PATHS, ICON_VIEW_BOX } from '../lib/icons.js';

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
});

const d = computed(() => ICON_PATHS[props.name] || '');
</script>

<template>
  <svg
    :viewBox="ICON_VIEW_BOX"
    :width="size"
    :height="size"
    fill="currentColor"
    aria-hidden="true"
    class="icon"
  >
    <path :d="d" />
  </svg>
</template>
