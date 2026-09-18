<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { dateLabel, formatHours, monthLabel } from './lib/model.js';
import { useLedger } from './composables/useLedger.js';
import { useSettings } from './composables/useSettings.js';
import { useToast } from './composables/useToast.js';

import TopBar from './components/TopBar.vue';
import HeroPanel from './components/HeroPanel.vue';
import ChartBlock from './components/ChartBlock.vue';
import StatGrid from './components/StatGrid.vue';
import DetailTable from './components/DetailTable.vue';
import ExcludedChips from './components/ExcludedChips.vue';
import MonthSheet from './components/MonthSheet.vue';
import RulesSheet from './components/RulesSheet.vue';
import SettingsSheet from './components/SettingsSheet.vue';
import LoadingOverlay from './components/LoadingOverlay.vue';
import AppToast from './components/AppToast.vue';

const ledger = useLedger();
const settings = useSettings();
const { message: toastMessage, visible: toastVisible, toast } = useToast();

const {
  view, month, months, index, loaded, fatal, records, syncedAt, source,
  loadingVisible, loadingText, loadingProgress,
  activeDays, groups, summary, excludedEntries,
  bootstrap, selectView, selectMonth, toggleDate, setNote, tick,
} = ledger;

/* ---------------- 弹层状态 ---------------- */
const sheet = ref(null); // null | 'month' | 'rules' | 'settings'

const monthText = computed(() => {
  if (view.value === 'all') return '全部时间';
  if (!loaded.value) return '加载中…';
  return month.value ? monthLabel(month.value) : '';
});

const scopeText = computed(() =>
  view.value === 'all' ? '全部时间' : month.value ? monthLabel(month.value) : '',
);

/* ---------------- 页脚 ---------------- */
const footnote = computed(() => {
  const cfg = settings.cfg.value;
  const srcText = source.value === 'csv' ? 'all.csv（兜底）' : '按月 JSON';
  const bits = [`标准下班时间 ${cfg.workdayEnd}`, `数据 ${records.value.length} 条`];
  if (view.value === 'all' && index.value) bits.push(`共 ${index.value.months.length} 个月`);
  if (syncedAt.value) bits.push(`最近同步 ${syncedAt.value.replace('T', ' ').slice(0, 16)}`);
  bits.push(`来源 ${srcText}`);
  if (settings.hasLocal.value) bits.push('含本机未提交的标记');
  return bits.join(' · ');
});

/* ---------------- 交互 ---------------- */
async function onToggleDate(date) {
  const excluded = toggleDate(date);
  toast(excluded ? `已排除 ${dateLabel(date)}，不计入统计` : `已恢复 ${dateLabel(date)}`);
}

function onNoteChange(date, note) {
  setNote(date, note);
}

function onPickMonth(target) {
  sheet.value = null;
  selectMonth(target);
}

function onOpenMonthFromTable(target) {
  selectMonth(target);
}

async function onCopyConfig() {
  try {
    await navigator.clipboard.writeText(settings.exportConfig());
    toast('已复制，可粘贴到 ot-ledger.config.json');
  } catch {
    toast('复制失败，请在浏览器中允许剪贴板');
  }
}

function onReset() {
  settings.reset();
  sheet.value = null;
  toast('已重置为本仓库默认配置');
}

function onKeydown(event) {
  if (event.key === 'Escape' && sheet.value) sheet.value = null;
}

/* ---------------- 生命周期 ---------------- */
let timer = null;

onMounted(async () => {
  settings.init();
  document.addEventListener('keydown', onKeydown);
  await bootstrap();
  // 每分钟刷新「今日待更新」状态
  timer = setInterval(tick, 60000);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  clearInterval(timer);
});
</script>

<template>
  <div class="page">
    <TopBar
      :view="view"
      :month-text="monthText"
      @pick-month="sheet = 'month'"
      @open-settings="sheet = 'settings'"
      @open-rules="sheet = 'rules'"
      @change-view="selectView"
    />

    <div class="layout">
      <!--
        数据未就绪时不渲染左侧面板。
        遮罩此刻盖在上面，这里是第二道保险：万一将来有别的代码路径
        出现「先改月份、后到数据」的中间态，也不会闪出全 0 的概览与空图表。
      -->
      <div v-if="loaded" class="col col-left">
        <section class="card panel-card">
          <HeroPanel :summary="summary" :days="activeDays" :scope-text="scopeText" />
          <ChartBlock
            :view="view"
            :month="month"
            :days="activeDays"
            :groups="groups"
            :pending-counts="settings.cfg.value.pendingCounts"
          />
        </section>
      </div>

      <div class="col col-right">
        <!-- 致命错误 -->
        <section v-if="fatal" class="card">
          <div class="fatal">
            <p class="fatal-title">{{ fatal.message }}</p>
            <p class="fatal-detail">{{ fatal.detail }}</p>
            <p class="fatal-detail">提示：直接双击打开 index.html 时浏览器会拦截本地文件读取，请用本地静态服务器或部署到 GitHub Pages。</p>
          </div>
        </section>

        <template v-else-if="loaded">
          <StatGrid
            :summary="summary"
            :view="view"
            :forgot-counts="settings.cfg.value.forgotCounts"
          />
          <DetailTable
            :view="view"
            :days="activeDays"
            :groups="groups"
            @toggle-date="onToggleDate"
            @open-month="onOpenMonthFromTable"
          />
          <ExcludedChips
            :entries="excludedEntries"
            @change-note="onNoteChange"
            @restore="onToggleDate"
          />
          <p class="footnote">{{ footnote }}</p>
        </template>
      </div>
    </div>

    <!-- 弹层 -->
    <MonthSheet
      :open="sheet === 'month'"
      :months="months"
      :counts="index?.counts || {}"
      :current="month"
      :summary="summary"
      @close="sheet = null"
      @pick="onPickMonth"
    />
    <RulesSheet
      :open="sheet === 'rules'"
      :workday-end="settings.cfg.value.workdayEnd"
      :forgot-counts="settings.cfg.value.forgotCounts"
      :pending-counts="settings.cfg.value.pendingCounts"
      @close="sheet = null"
    />
    <SettingsSheet
      :open="sheet === 'settings'"
      :cfg="settings.cfg.value"
      :record-count="records.length"
      :synced-at="syncedAt"
      :remote-found="settings.remoteFound.value"
      :has-local="settings.hasLocal.value"
      :source="source"
      @close="sheet = null"
      @save-workday-end="settings.save({ workdayEnd: $event })"
      @save-min-punches="settings.save({ minPunches: $event })"
      @save-forgot-counts="settings.save({ forgotCounts: $event })"
      @save-pending-counts="settings.save({ pendingCounts: $event })"
      @copy-config="onCopyConfig"
      @reset="onReset"
    />

    <!-- 全局 loading：首屏即渲染，避免高度坍缩 -->
    <LoadingOverlay :visible="loadingVisible" :text="loadingText" :progress="loadingProgress" />
    <AppToast :visible="toastVisible" :message="toastMessage" />
  </div>
</template>
