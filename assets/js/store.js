/**
 * 配置持久化
 *
 * 两级来源，合并后生效：
 *   1. 仓库级默认值 ot-ledger.config.json（随仓库提交，可跨设备共享）
 *   2. 本机覆盖 localStorage（在页面上勾选/修改的内容）
 *
 * 同一天在两处都有记录时，以本机为准。
 */

const LS_KEY = 'ot-ledger:v1';
const REMOTE_URL = 'ot-ledger.config.json';

export const DEFAULT_CONFIG = {
  /** 标准下班时间，用于计算加班起点 */
  workdayEnd: '17:30',
  /** 低于该打卡次数认定为数据不足，不纳入统计 */
  minPunches: 2,
  /** 忘打卡日是否计入平均（加班按 0 计） */
  forgotCounts: true,
  /** { 'YYYY-MM-DD': { excluded: true, note: '' } } */
  exclusions: {},
};

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitizeExclusions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [date, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (value === true) {
      out[date] = { excluded: true, note: '' };
    } else if (value && typeof value === 'object' && value.excluded !== false) {
      out[date] = { excluded: true, note: String(value.note || '') };
    }
  }
  return out;
}

function sanitize(raw) {
  const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
  return {
    workdayEnd: /^\d{1,2}:\d{2}$/.test(cfg.workdayEnd || '') ? cfg.workdayEnd : DEFAULT_CONFIG.workdayEnd,
    minPunches: Math.min(6, Math.max(1, Number(cfg.minPunches) || DEFAULT_CONFIG.minPunches)),
    forgotCounts: cfg.forgotCounts !== false,
    exclusions: sanitizeExclusions(cfg.exclusions),
  };
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = safeParse(raw);
    return parsed ? sanitize(parsed) : null;
  } catch {
    return null;
  }
}

export const store = {
  local: null,
  remote: sanitize(null),
  remoteFound: false,

  init() {
    this.local = readLocal();
    return this;
  },

  /** 拉取仓库级默认配置（不存在时静默忽略） */
  async loadRemote() {
    try {
      const res = await fetch(`${REMOTE_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = safeParse(await res.text());
      if (!json) return;
      this.remote = sanitize(json);
      this.remoteFound = true;
    } catch {
      /* 忽略：远程配置可选 */
    }
  },

  /** 合并后的生效配置 */
  get() {
    const local = this.local;
    if (!local) return this.remote;
    return {
      workdayEnd: local.workdayEnd,
      minPunches: local.minPunches,
      forgotCounts: local.forgotCounts,
      exclusions: { ...this.remote.exclusions, ...local.exclusions },
    };
  },

  /** 是否存在本机覆盖 */
  hasLocal() {
    return Boolean(this.local);
  },

  save(patch) {
    const base = this.local || sanitize(this.remote);
    this.local = sanitize({ ...base, ...patch });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.local));
    } catch {
      /* 隐私模式下写入失败：本次会话仍然生效 */
    }
    return this.get();
  },

  reset() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    this.local = null;
    return this.get();
  },

  /** 导出为可提交到仓库的 ot-ledger.config.json 内容 */
  exportConfig() {
    const cfg = this.get();
    return JSON.stringify(
      {
        workdayEnd: cfg.workdayEnd,
        minPunches: cfg.minPunches,
        forgotCounts: cfg.forgotCounts,
        exclusions: Object.fromEntries(
          Object.entries(cfg.exclusions).map(([date, v]) => [date, { excluded: true, note: v.note || '' }]),
        ),
      },
      null,
      2,
    );
  },
};
