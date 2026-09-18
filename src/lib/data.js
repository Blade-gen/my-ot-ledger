/**
 * 数据加载层
 *
 * 数据源优先级：
 *   1. otData/index.json（月份清单）+ otData/YYYY-MM.json（按月归档）—— 主路径
 *   2. otData/all.csv —— 兼容兜底，仅在 index.json 拉不到时使用
 *
 * 为什么按月取：
 *   「月」视图只用到当月记录，「全部」视图只需要按月汇总。
 *   历史越长，全量 all.csv 的下载与解析就越是纯浪费
 *   —— 首屏成本本应只与当月记录数有关，因此按需加载单月文件，
 *   并把已取到的月份缓存在内存里。
 */

import { filterByMonth, parseRecords, recordsFromJSON } from './model.js';

const INDEX_URL = 'otData/index.json';
const LEGACY_CSV_URL = 'otData/all.csv';

/** 防止 ?t= 时间戳把 CDN 缓存彻底打穿：同一次会话内复用同一个值 */
const CACHE_BUST = Date.now();

const monthCache = new Map();
let indexCache = null;
let legacyRecords = null;

async function fetchText(url) {
  const res = await fetch(`${url}?t=${CACHE_BUST}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJSON(url) {
  return JSON.parse(await fetchText(url));
}

/**
 * 读取月份清单。
 * 返回 { months: ['2026-09', ...]（升序）, counts, total, updatedAt, source }
 */
export async function loadIndex() {
  if (indexCache) return indexCache;

  try {
    const json = await fetchJSON(INDEX_URL);
    // 兼容两种清单写法：
    //   A. { months: ['2026-09'], counts: { '2026-09': 27 } }   ← build-index.mjs 的输出
    //   B. { months: [{ month: '2026-09', count: 27 }] }
    const rawList = Array.isArray(json) ? json : json && json.months;
    const rawCounts = (!Array.isArray(json) && json && json.counts) || {};

    const counts = {};
    for (const [name, value] of Object.entries(rawCounts)) {
      if (Number.isFinite(value)) counts[name] = value;
    }
    const months = (Array.isArray(rawList) ? rawList : [])
      .map((m) => {
        const name = typeof m === 'string' ? m : m && m.month;
        // 写法 B：计数挂在月份条目上
        if (m && typeof m === 'object' && Number.isFinite(m.count) && name) counts[name] = m.count;
        return name;
      })
      .filter((m) => /^\d{4}-\d{2}$/.test(String(m || '')))
      .map(String)
      .sort();

    // 清单为空说明构建脚本还没跑过，退回 all.csv 更稳妥
    if (months.length) {
      const total = months.reduce((sum, m) => sum + (counts[m] || 0), 0);
      indexCache = {
        months,
        counts,
        total,
        updatedAt: (json && json.updated_at) || '',
        source: 'index',
      };
      return indexCache;
    }
  } catch {
    /* 落到下面的 all.csv 兜底 */
  }

  const records = await loadLegacyCsv();
  const months = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort();
  indexCache = {
    months,
    counts: {},
    total: records.length,
    updatedAt: '',
    source: 'csv',
  };
  return indexCache;
}

async function loadLegacyCsv() {
  if (legacyRecords) return legacyRecords;
  legacyRecords = parseRecords(await fetchText(LEGACY_CSV_URL));
  return legacyRecords;
}

/**
 * 取某个月的记录。已取过的月份直接命中内存缓存。
 * 单月文件缺失/损坏时返回空数组，由调用方决定如何提示。
 */
export async function loadMonth(month) {
  if (monthCache.has(month)) return monthCache.get(month);

  let records = [];
  if (indexCache && indexCache.source === 'csv') {
    records = filterByMonth(await loadLegacyCsv(), month);
  } else {
    try {
      records = recordsFromJSON(await fetchText(`otData/${month}.json`));
    } catch {
      // 月度文件缺失：回退到 all.csv（若也没有则保持空数组）
      try {
        records = filterByMonth(await loadLegacyCsv(), month);
      } catch {
        records = [];
      }
    }
  }

  monthCache.set(month, records);
  return records;
}

/** 「全部」视图：逐月取回全部记录后合并 */
export async function loadAllMonths(months, onProgress) {
  const out = [];
  let done = 0;
  for (const month of months) {
    out.push(...(await loadMonth(month)));
    done += 1;
    if (onProgress) onProgress(done, months.length);
  }
  return out;
}

/** 某个月份是否已在内存里（用于避免切换月份时闪一下全局 loading） */
export function isMonthCached(month) {
  return monthCache.has(month);
}

/** 当前生效的数据源（用于页脚/设置面板展示） */
export function dataSource() {
  return indexCache ? indexCache.source : 'index';
}
