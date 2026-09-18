import { parseCSV } from './csv.js';

/* ------------------------------------------------------------------ *
 * 时间 / 日期工具（全部按北京时间处理，不依赖浏览器本地时区）
 * ------------------------------------------------------------------ */

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const CN_TZ = 'Asia/Shanghai';

/** 北京时间下的今天，YYYY-MM-DD */
export function todayInCN() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: CN_TZ });
}

/** 北京时间下的当前时刻，自 0 点起的分钟数 */
export function nowMinutesInCN() {
  const s = new Date().toLocaleTimeString('en-GB', {
    timeZone: CN_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** 日期字符串加减天数 */
export function shiftDate(date, delta) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
  return [
    t.getUTCFullYear(),
    String(t.getUTCMonth() + 1).padStart(2, '0'),
    String(t.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** 星期序号，0=周日 */
export function weekdayIndex(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayOf(date) {
  return WEEKDAYS[weekdayIndex(date)];
}

export function isWeekend(date) {
  const w = weekdayIndex(date);
  return w === 0 || w === 6;
}

/** "17:30" -> 1050 */
export function hhmmToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return 17 * 60 + 30;
  const h = Math.min(23, Number(m[1]));
  const mi = Math.min(59, Number(m[2]));
  return h * 60 + mi;
}

/** 1050 -> "17:30" */
export function minutesToHHMM(min) {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 1050 -> "17:30:00" 形式的时间部分 */
export function timeOf(record) {
  return minutesToHHMM(record.minute);
}

/** 分钟 -> "1小时31分" */
export function formatDuration(min) {
  const v = Math.max(0, Math.round(min));
  if (v === 0) return '0分';
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分`;
}

/** 分钟 -> 小时数字字符串，最多两位小数且去掉多余的 0 */
export function formatHours(min, digits = 2) {
  const s = (Math.max(0, min) / 60).toFixed(digits);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** 月份 + 1 -> {month:'2026-10', year:2026, index:10} */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 该月的自然天数，用于把柱状图铺满整月 */
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 该月全部日期，'YYYY-MM-DD' 数组 */
export function monthDates(month) {
  const total = daysInMonth(month);
  const out = [];
  for (let d = 1; d <= total; d += 1) out.push(`${month}-${String(d).padStart(2, '0')}`);
  return out;
}

export function dateLabel(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/* ------------------------------------------------------------------ *
 * 数据解析
 * ------------------------------------------------------------------ */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/** 记录按「日期 + 分钟」升序，保证同一天内按时间先后排列 */
function sortRecords(records) {
  records.sort((a, b) => (a.date === b.date ? a.minute - b.minute : a.date < b.date ? -1 : 1));
  return records;
}

/** 一条原始行 -> 打卡记录；ATTDATE 不含合法时间时返回 null */
function toRecord(get) {
  const att = String(get('ATTDATE') ?? '').trim();
  const m = DATE_RE.exec(att);
  if (!m) return null;

  const str = (name) => {
    const v = get(name);
    return v === null || v === undefined ? '' : String(v).trim();
  };
  const hh = Number(m[4]);
  const mm = Number(m[5]);

  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    minute: hh * 60 + mm,
    location: str('LOCATIONTYPE'),
    address: str('ATTADDRESS'),
    source: str('SOURCE'),
    firstSeen: str('_FIRST_SEEN'),
    lastSeen: str('_LAST_SEEN'),
  };
}

/**
 * 解析 otData/all.csv 文本 -> 打卡记录数组（按时间升序）
 *
 * 这是兼容路径：数据源改为按月 JSON 后仍保留，用于 index.json 缺失时兜底。
 */
export function parseRecords(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim().toUpperCase());
  const iDate = header.indexOf('ATTDATE');
  if (iDate < 0) throw new Error('all.csv 缺少 ATTDATE 列');

  const col = (name) => header.indexOf(name);
  const iLoc = col('LOCATIONTYPE');
  const iAddr = col('ATTADDRESS');
  const iSrc = col('SOURCE');
  const iFirst = col('_FIRST_SEEN');
  const iLast = col('_LAST_SEEN');

  const records = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const record = toRecord((name) => {
      switch (name) {
        case 'ATTDATE':
          return row[iDate];
        case 'LOCATIONTYPE':
          return iLoc >= 0 ? row[iLoc] : '';
        case 'ATTADDRESS':
          return iAddr >= 0 ? row[iAddr] : '';
        case 'SOURCE':
          return iSrc >= 0 ? row[iSrc] : '';
        case '_FIRST_SEEN':
          return iFirst >= 0 ? row[iFirst] : '';
        case '_LAST_SEEN':
          return iLast >= 0 ? row[iLast] : '';
        default:
          return '';
      }
    });
    if (record) records.push(record);
  }

  return sortRecords(records);
}

/** 键名统一成大写，兼容 JSON 里的 ATTDATE 与 _first_seen 两种写法 */
function upperKeys(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[String(key).trim().toUpperCase()] = value;
  return out;
}

/**
 * 解析按月归档的 JSON -> 打卡记录数组
 *
 * 接受三种形态，容错优先（坏文件返回空数组，而不是让整站挂掉）：
 *   1. otData/YYYY-MM.json 的完整对象：{ month, records: [...] }
 *   2. 裸数组：[{ ATTDATE, ... }]
 *   3. 上面两种的 JSON 文本
 */
export function recordsFromJSON(input) {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (data && !Array.isArray(data) && Array.isArray(data.records)) data = data.records;
  if (!Array.isArray(data)) return [];

  const records = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const u = upperKeys(row);
    const record = toRecord((name) => u[name]);
    if (record) records.push(record);
  }
  return sortRecords(records);
}

/** 只保留某个（YYYY-MM）月份的记录 */
export function filterByMonth(records, month) {
  return records.filter((r) => r.date.slice(0, 7) === month);
}

/** 数据自身的最后同步时间（取 _last_seen 最大值） */
export function lastSyncedAt(records) {
  let max = '';
  for (const r of records) {
    const v = r.lastSeen || r.firstSeen;
    if (v && v > max) max = v;
  }
  return max;
}

/**
 * 按天归组。凌晨 5 点前的打卡视为前一天的下班卡（跨天加班）。
 */
export function groupByDate(records) {
  const byDate = new Map();
  for (const r of records) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  const dates = [...byDate.keys()].sort();
  const days = [];
  for (const date of dates) {
    const list = byDate.get(date).slice().sort((a, b) => a.minute - b.minute);
    const allEarly = list.every((r) => r.minute < 5 * 60);
    const prev = days[days.length - 1];
    if (allEarly && prev && prev.date === shiftDate(date, -1)) {
      prev.punches.push(...list);
      prev.punches.sort((a, b) => a.minute - b.minute);
      continue;
    }
    days.push({ date, punches: list });
  }
  return days;
}

/* ------------------------------------------------------------------ *
 * 统计模型
 * ------------------------------------------------------------------ */

/** 单日状态说明（用于表格与图表着色） */
export const STATUS_TEXT = {
  ok: '正常',
  forgot: '忘打卡',
  pending: '今日待更新',
  incomplete: '数据不足',
  excluded: '已排除',
};

/**
 * 计算每天的加班时长
 *
 * 规则：
 *  1. 一天多次打卡时，只有「第一条（上班）」与「最后一条（下班）」参与计算，
 *     中午的卡是早上下班卡，对加班无影响。
 *  2. 最后一条打卡晚于标准下班时间 -> 加班 = 最后打卡 - 标准下班时间。
 *  3. 最后一条打卡早于标准下班时间 -> 视为忘打卡，加班时长记 0。
 *  4. 打卡次数少于 minPunches（默认 2）-> 数据不足，不计入统计。
 *  5. 今天（一条卡都没有，或还没打出晚于下班时间的卡）-> 今日待更新。
 *     默认（pendingCounts 未显式打开）不计入平均；打开后按 0 加班计入。
 *  6. 被标记为「不纳入统计」的日期不参与任何汇总。
 */
export function computeDays(records, settings, ctx = {}) {
  const today = ctx.today || todayInCN();
  const endMinutes = hhmmToMinutes(settings.workdayEnd);
  const minPunches = Math.max(1, Number(settings.minPunches) || 2);
  const exclusions = settings.exclusions || {};

  const groups = groupByDate(records);

  // 「今天一条卡都没有」时也要补一天 —— 但只在 pendingCounts 打开时补。
  // groupByDate 只会产出「数据里出现过的日期」，于是「还没打卡的今天」根本不在 days 里，
  // 「今日待更新」无从谈起：pendingCounts 只对「打了上班卡、还没打下班卡」的今天生效，
  // 对「今天一条卡都没有」完全失效（实测 9/18 无记录，开关怎么切日均都是 1.79；
  // 打开后应为 968/10 = 1.61）。
  // 关闭时不补：那天不参与任何统计，凭空多一行没有打卡记录的日期只会让
  // 「有打卡 N 天」虚高，还给用户一个没有意义的「排除」按钮。
  // 仅在已加载数据确实覆盖了今天所在月份时补，避免在看 7 月时凭空多出一个 9/18。
  if (
    settings.pendingCounts === true &&
    !groups.some((g) => g.date === today) &&
    records.some((r) => r.date.slice(0, 7) === today.slice(0, 7))
  ) {
    groups.push({ date: today, punches: [] });
    groups.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  return groups.map(({ date, punches }) => {
    const marker = exclusions[date];
    const excluded = Boolean(marker && marker.excluded !== false);
    const first = punches[0];
    const last = punches[punches.length - 1];

    let status;
    let otMinutes = 0;

    if (!punches.length) {
      // 只有上面补出来的「今天」会是空打卡
      status = 'pending';
    } else if (date === today && last.minute <= endMinutes) {
      // 当天还没打出晚于下班时间的卡，数据未完整
      status = 'pending';
    } else if (punches.length < minPunches) {
      status = 'incomplete';
    } else if (last.minute <= endMinutes) {
      status = 'forgot';
    } else {
      status = 'ok';
      otMinutes = last.minute - endMinutes;
    }

    // 「今日待更新」默认**不**计入（此时 otMinutes 本来就是 0）。
    // 打开后会把「今天还没下班」也算作一个统计日 —— 目的是避免月初只统计
    // 已完整的日子、让日均看起来偏高。关掉即回到「不计入」。
    const counted =
      !excluded &&
      (status === 'ok' ||
        (status === 'forgot' && settings.forgotCounts !== false) ||
        (status === 'pending' && settings.pendingCounts === true));

    return {
      date,
      month: date.slice(0, 7),
      weekday: weekdayOf(date),
      weekend: isWeekend(date),
      punches,
      first,
      last,
      // 补出来的「今天」没有打卡记录，first/last 都是 undefined —— 这里必须兜住，
      // 否则 timeOf(undefined) 会直接把整站算崩。
      inTime: punches.length ? timeOf(first) : '',
      outTime: punches.length ? timeOf(last) : '',
      lunchTime: punches.length >= 3 ? timeOf(punches[punches.length - 2]) : '',
      rawStatus: status,
      status: excluded ? 'excluded' : status,
      excluded,
      note: (marker && marker.note) || '',
      otMinutes,
      counted,
    };
  });
}

export function summarize(days) {
  const counted = days.filter((d) => d.counted);
  const totalMinutes = counted.reduce((s, d) => s + d.otMinutes, 0);
  const maxDay = counted.reduce((acc, d) => (acc === null || d.otMinutes > acc.otMinutes ? d : acc), null);
  // 只考虑真有打卡记录的日子：打开 pendingCounts 后，「今天一条卡都没有」也会被计入，
  // 那种 day 的 last 是 undefined，直接读 .minute 会崩。
  const latest = counted
    .filter((d) => d.last)
    .reduce((acc, d) => (acc === null || d.last.minute > acc.last.minute ? d : acc), null);
  return {
    totalMinutes,
    days: counted.length,
    avgMinutes: counted.length ? totalMinutes / counted.length : 0,
    maxDay,
    latest,
    // 按「确实有打卡记录的天数」算，而不是 days.length：
    // pendingCounts 打开时会补出一个一条卡都没有的「今天」，
    // 用它去撑「共 N 天有打卡」的文案就不对了。
    recordedDays: days.filter((d) => d.punches.length > 0).length,
    forgotDays: days.filter((d) => d.rawStatus === 'forgot').length,
    incompleteDays: days.filter((d) => d.rawStatus === 'incomplete').length,
    pendingDays: days.filter((d) => d.rawStatus === 'pending').length,
    excludedDays: days.filter((d) => d.excluded).length,
  };
}

/** 把某天标记/取消标记为「不纳入统计」 */
export function toggleExclusion(exclusions, date, note) {
  const next = { ...exclusions };
  const cur = next[date];
  if (cur && cur.excluded !== false) {
    delete next[date];
  } else {
    next[date] = { excluded: true, note: note || (cur && cur.note) || '' };
  }
  return next;
}

export function setNote(exclusions, date, note) {
  const next = { ...exclusions };
  next[date] = { excluded: true, note };
  return next;
}
