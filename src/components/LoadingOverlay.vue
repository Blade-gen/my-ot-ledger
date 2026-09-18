<script setup>
/**
 * 全局 loading 遮罩。
 *
 * DOM 结构与 index.html 里那份首屏兜底遮罩 (#boot-loading) **完全一致**
 * （同样的 class），样式来自 index.html 的内联 <style> —— 两处共用一份定义，
 * 所以从第一帧到 Vue 接管之间不会出现任何视觉差异。
 * ⚠️ 改这里的 class 名/结构时，必须同步改 index.html 的兜底遮罩。
 *
 * 本组件还负责移除那份兜底遮罩。
 * 为什么由这里移除、而不是在 main.js 里 mount() 之后直接删：
 *   Vue 的首次渲染不保证在 mount() 返回时就落到 DOM 上（Vapor 下实测会晚一帧）。
 *   若在 mount() 后同步删除兜底遮罩，就会出现「兜底已删、Vue 还没画」的一帧空白
 *   —— 正是要避免的突变。
 *   放在本组件的 onMounted 里，顺序天然是「Vue 遮罩已插入 → 再删兜底」。
 */
import { onMounted } from 'vue';

defineProps({
  visible: { type: Boolean, default: false },
  text: { type: String, default: '正在加载数据…' },
  /** { done, total } | null */
  progress: { type: Object, default: null },
});

onMounted(() => {
  document.getElementById('boot-loading')?.remove();
});
</script>

<template>
  <div v-if="visible" class="loading" role="status" aria-live="polite">
    <div class="loading-box">
      <span class="spinner" aria-hidden="true"></span>
      <p class="loading-text">{{ text }}</p>
      <div v-if="progress" class="loading-bar">
        <span
          class="loading-bar-fill"
          :style="{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }"
        ></span>
      </div>
    </div>
  </div>
</template>
