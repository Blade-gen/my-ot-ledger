/**
 * 看板核心状态：数据加载（按月懒加载 / 全量 / all.csv 兜底）、
 * 派生统计、视图与月份切换、排除标记。
 *
 * 加载策略（与原实现保持一致，已通过浏览器测试）：
 *   - 首屏只读 index.json + 最新一个月
 *   - 「全部」视图首次进入才逐月补齐，带进度
 *   - 单月文件缺失时回退 all.csv
 */
import { computed, ref, shallowRef } from 'vue';
import {
  computeDays,
  lastSyncedAt,
  summarize,
  todayInCN,
  toggleExclusion,
} from '../lib/model.js';
import {
  dataSource,
  isMonthCached,
  loadAllMonths,
  loadIndex,
  loadMonth,
} from '../lib/data.js';
import { useSettings } from './useSettings.js';

export function useLedger() {
  const settings = useSettings();

  /* ---------------- 状态 ---------------- */
  const view = ref('month'); // 'month' | 'all'
  const month = ref(null);
  const index = shallowRef(null);
  const allLoaded = ref(false);
  const busy = ref(false);
  const loaded = ref(false);
  const fatal = ref(null); // { message, detail }

  /**
   * 可选的月份清单 —— 唯一来源是 index.json。
   * 不要用「当前已加载的记录」去反推可选月份：月视图下只加载了当月，
   * 那样月份选择器就只剩一项（踩过的坑）。
   */
  const months = computed(() => index.value?.months || []);

  /** 当前视图的原始记录（月视图=当月；全部视图=所有月合并） */
  const records = shallowRef([]);
  const syncedAt = ref('');
  const source = ref('index');

  /* ---------------- 全局 loading ---------------- */
  const loadingVisible = ref(true); // 首屏即显示，避免高度坍缩
  const loadingText = ref('正在加载数据…');
  const loadingProgress = ref(null); // { done, total }
  let showTimer = null;

  /**
   * 显示全局遮罩。delay>0 时延后显示：
   * 命中缓存或网速快时不闪一下遮罩，观感更稳。
   */
  function showLoading(text, { delay = 0, progress = null } = {}) {
    clearTimeout(showTimer);
    const paint = () => {
      loadingText.value = text || '正在加载数据…';
      loadingProgress.value = progress;
      loadingVisible.value = true;
    };
    if (delay > 0) showTimer = setTimeout(paint, delay);
    else paint();
  }

  function hideLoading() {
    clearTimeout(showTimer);
    loadingVisible.value = false;
    loadingProgress.value = null;
  }

  function updateProgress(done, total) {
    if (!loadingVisible.value) return;
    loadingProgress.value = { done, total };
  }

  /* ---------------- 派生数据 ---------------- */
  const days = computed(() => computeDays(records.value, settings.cfg.value));

  const daysOfMonth = computed(() =>
    days.value.filter((d) => d.month === month.value),
  );

  const groups = computed(() => {
    const map = new Map();
    for (const day of days.value) {
      if (!map.has(day.month)) map.set(day.month, []);
      map.get(day.month).push(day);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([m, list]) => ({ month: m, days: list, summary: summarize(list) }));
  });

  /** 当前视图对应的天数组 */
  const activeDays = computed(() =>
    view.value === 'all' ? days.value : daysOfMonth.value,
  );

  const summary = computed(() => summarize(activeDays.value));

  const excludedEntries = computed(() => {
    const cfgEx = settings.cfg.value.exclusions || {};
    const byDate = new Map();
    for (const [date, value] of Object.entries(cfgEx)) {
      byDate.set(date, { date, note: value.note || '' });
    }
    for (const day of days.value) {
      if (!day.excluded) continue;
      const cur = byDate.get(day.date) || { date: day.date, note: '' };
      cur.note = day.note || cur.note;
      byDate.set(day.date, cur);
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  });

  /* ---------------- 加载 ---------------- */

  /**
   * 同步提交某个月的数据。
   *
   * ⚠️ month 与 records 必须在**同一个同步块**里改：
   * activeDays 是「按 month 过滤 records」算出来的，若先改 month 再 await 取值，
   * 中间会渲染出「新月份 + 旧数据」的组合 —— 过滤结果为空，
   * 于是界面上闪一下全 0 的概览与「该月暂无打卡记录」。
   * 放在同一个 tick 里改，Vue 会合并成一次渲染，不会出现这个空档。
   */
  function commitMonth(target, list) {
    month.value = target;
    records.value = list;
    syncedAt.value = lastSyncedAt(list);
    allLoaded.value = false;
    loaded.value = true;
  }

  /** 首次载入：index.json + 最新一个月 */
  async function bootstrap() {
    showLoading('正在加载数据…');
    try {
      index.value = await loadIndex();
      source.value = dataSource();

      if (!months.value.length) throw new Error('otData 中没有可用的打卡数据');

      const target = months.value[months.value.length - 1];
      // 先取数据、再一次性提交，避免中途渲染出空状态
      const list = await loadMonth(target);
      commitMonth(target, list);
    } catch (error) {
      fatal.value = {
        message: '未能读取 otData 数据',
        detail: String(error?.message || error),
      };
      hideLoading();
      return;
    }

    // 仓库级配置在渲染前就位，避免先按默认值画一遍再跳变
    await settings.loadRemote();
    hideLoading();
  }

  /** 切换视图：按需补齐数据 */
  async function selectView(next) {
    if (busy.value || next === view.value) return;
    busy.value = true;
    try {
      if (next === 'all') {
        let list = records.value;
        if (!allLoaded.value) {
          const all = months.value;
          showLoading(`正在加载全部 ${all.length} 个月的数据…`, {
            delay: 120,
            progress: { done: 0, total: all.length },
          });
          list = await loadAllMonths(all, updateProgress);
          allLoaded.value = true;
        }
        // records 与 view 同步块内一起改，避免「全部视图 + 单月数据」的中间帧
        records.value = list;
        view.value = 'all';
      } else {
        // 全量数据在手时，过滤当月即可正确渲染，无需等网络
        if (allLoaded.value) {
          view.value = 'month';
        } else {
          const list = await loadMonth(month.value);
          commitMonth(month.value, list);
          view.value = 'month';
        }
      }
    } catch (error) {
      fatal.value = { message: '数据加载失败', detail: String(error?.message || error) };
    } finally {
      hideLoading();
      busy.value = false;
    }
  }

  /** 选中某个月：已缓存则只做一次局部刷新 */
  async function selectMonth(target) {
    if (busy.value) return;
    // 已经在看这个月的月视图时才忽略；否则「全部」视图里点同一月份的
    // 「查看」会被这里挡掉，导致切不回月视图
    if (view.value === 'month' && target === month.value) return;
    busy.value = true;
    const cached = isMonthCached(target);
    try {
      if (!cached) showLoading(`正在加载 ${target} 的数据…`, { delay: 120 });
      // 关键：先 await 拿到数据，再和 month 一起提交（见 commitMonth 注释）
      const list = await loadMonth(target);
      commitMonth(target, list);
      view.value = 'month';
    } catch (error) {
      fatal.value = { message: '数据加载失败', detail: String(error?.message || error) };
    } finally {
      hideLoading();
      busy.value = false;
    }
  }

  /** 每分钟刷新「今日待更新」：days 是 computed，重算即反映最新状态 */
  function tick() {
    if (!loaded.value) return;
    // 触发一次重算（today 变化会改变 pending 判定）
    records.value = records.value.slice();
  }

  /* ---------------- 排除标记 ---------------- */
  function toggleDate(date) {
    const next = toggleExclusion(settings.cfg.value.exclusions, date);
    settings.save({ exclusions: next });
    return Boolean(next[date]);
  }

  function setNote(date, note) {
    const next = { ...settings.cfg.value.exclusions };
    next[date] = { excluded: true, note };
    settings.save({ exclusions: next });
  }

  const today = () => todayInCN();

  return {
    // 状态
    view, month, months, index, busy, loaded, fatal, records, syncedAt, source,
    // loading
    loadingVisible, loadingText, loadingProgress, hideLoading,
    // 派生
    days, daysOfMonth, groups, activeDays, summary, excludedEntries, today,
    // 动作
    bootstrap, selectView, selectMonth, toggleDate, setNote, tick,
  };
}
