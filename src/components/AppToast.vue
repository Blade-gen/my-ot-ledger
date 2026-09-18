<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  message: { type: String, default: '' },
});
</script>

<template>
  <div
    v-if="visible || message"
    class="toast"
    :class="{ 'is-visible': visible }"
    role="status"
    aria-live="polite"
  >{{ message }}</div>
</template>
