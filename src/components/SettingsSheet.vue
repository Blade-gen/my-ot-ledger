<script setup>
import { ref, watch } from 'vue';
import BottomSheet from './BottomSheet.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  cfg: { type: Object, required: true },
  recordCount: { type: Number, default: 0 },
  syncedAt: { type: String, default: '' },
  remoteFound: { type: Boolean, default: false },
  hasLocal: { type: Boolean, default: false },
  source: { type: String, default: 'index' },
});

const emit = defineEmits([
  'close', 'save-workday-end', 'save-min-punches',
  'save-forgot-counts', 'save-pending-counts', 'copy-config', 'reset',
]);

/* 打开面板时把本地草稿同步为当前配置 */
const timeDraft = ref(props.cfg.workdayEnd);
const minDraft = ref(String(props.cfg.minPunches));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    timeDraft.value = props.cfg.workdayEnd;
    minDraft.value = String(props.cfg.minPunches);
  },
);

function submitTime() {
  if (!/^\d{2}:\d{2}$/.test(timeDraft.value)) return;
  emit('save-workday-end', timeDraft.value);
}

function submitMin() {
  const v = Math.min(6, Math.max(1, Number(minDraft.value) || 2));
  minDraft.value = String(v);
  emit('save-min-punches', v);
}

const infoRows = () => [
  ['数据条数', `${props.recordCount} 条`],
  ['最近同步', props.syncedAt ? props.syncedAt.replace('T', ' ').slice(0, 19) : '—'],
  ['数据来源', props.source === 'csv' ? 'all.csv（兜底）' : '按月 JSON'],
  ['仓库默认配置', props.remoteFound ? 'ot-ledger.config.json' : '未提供（可选）'],
  ['本机标记', props.hasLocal ? '有未提交的修改' : '无'],
  ['计算规则', '加班 = 末次打卡 − 标准下班时间'],
];
</script>

<template>
  <BottomSheet :open="open" title="设置" @close="emit('close')">
    <div class="setting-row">
      <div class="setting-text">
        <span class="setting-label">标准下班时间</span>
        <span class="setting-hint">晚于该时间的打卡才算加班</span>
      </div>
      <input
        v-model="timeDraft"
        class="input input--time"
        type="time"
        @change="submitTime"
      />
    </div>

    <div class="setting-row">
      <div class="setting-text">
        <span class="setting-label">最少打卡次数</span>
        <span class="setting-hint">低于该次数视为数据不足，不纳入统计</span>
      </div>
      <input
        v-model="minDraft"
        class="input input--num"
        type="number"
        min="1"
        max="6"
        @change="submitMin"
      />
    </div>

    <div class="setting-row">
      <div class="setting-text">
        <span class="setting-label">忘打卡日计入平均</span>
        <span class="setting-hint">关闭后，末次打卡早于下班时间的日子不计入</span>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          :checked="cfg.forgotCounts"
          @change="emit('save-forgot-counts', $event.target.checked)"
        />
        <span class="switch-track"><span class="switch-thumb"></span></span>
      </label>
    </div>

    <div class="setting-row">
      <div class="setting-text">
        <span class="setting-label">今日未下班计入平均</span>
        <span class="setting-hint">打开后今天按 0 加班计入（含今天还没打卡），避免月初日均偏高</span>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          :checked="cfg.pendingCounts"
          @change="emit('save-pending-counts', $event.target.checked)"
        />
        <span class="switch-track"><span class="switch-thumb"></span></span>
      </label>
    </div>

    <!--
      这里原本有「手动排除某天」（选日期 + 添加按钮），已移除：
      同一天在「每日明细」表格里点一下就能排除，两个入口语义重复，
      且日期控件与「排除」这件事在交互上不直观。
      排除某天的唯一入口现在是明细表最后一列的按钮。
    -->

    <div class="sheet-actions">
      <button type="button" class="btn" @click="emit('copy-config')">复制配置到剪贴板</button>
      <button type="button" class="btn btn--danger" @click="emit('reset')">重置本机标记</button>
    </div>

    <div class="sheet-info">
      <div v-for="([k, v], i) in infoRows()" :key="i" class="info-row">
        <span class="info-key">{{ k }}</span>
        <span class="info-val">{{ v }}</span>
      </div>
    </div>
  </BottomSheet>
</template>
