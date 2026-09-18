<script setup>
import { ref, watch } from 'vue';
import { dateLabel } from '../lib/model.js';

const props = defineProps({
  entries: { type: Array, default: () => [] },
});

const emit = defineEmits(['change-note', 'restore']);

/** 本地草稿：输入过程中不直接写 store，change（失焦/回车）时才提交 */
const drafts = ref({});

watch(
  () => props.entries,
  (list) => {
    const next = {};
    for (const e of list) next[e.date] = e.note;
    drafts.value = next;
  },
  { immediate: true, deep: true },
);
</script>

<template>
  <div v-if="entries.length" class="excluded-block">
    <h3>已排除的日期</h3>
    <div class="chips">
      <div v-for="entry in entries" :key="entry.date" class="chip">
        <span class="chip-date">{{ dateLabel(entry.date) }}</span>
        <input
          class="chip-note"
          type="text"
          placeholder="备注"
          maxlength="20"
          :value="drafts[entry.date] ?? entry.note"
          @input="drafts[entry.date] = $event.target.value"
          @change="emit('change-note', entry.date, drafts[entry.date] ?? '')"
        />
        <button
          type="button"
          class="chip-remove"
          title="恢复纳入统计"
          :aria-label="`恢复 ${entry.date} 纳入统计`"
          @click="emit('restore', entry.date)"
        >×</button>
      </div>
    </div>
  </div>
</template>
