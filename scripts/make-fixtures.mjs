/**
 * 为测试构造三套站点（多月份 / 兜底 / 空数据），用于验证懒加载与失败路径。
 * 用法：node scripts/make-fixtures.mjs
 *
 * ⚠️ 每次都会**重新拷贝当前 dist/**。改完源码必须重新 build 再跑本脚本，
 *    否则测的是旧的 bundle —— 会得到「修复没生效」或「故意回退也没被发现」的假结果。
 *    这里在结尾显式打印所用的产物文件名，便于核对。
 */
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');

if (!readdirSync(distDir, { withFileTypes: true }).some((d) => d.isFile() && d.name === 'index.html')) {
  console.error('✗ dist/ 里没有 index.html，请先运行 pnpm build');
  process.exit(1);
}

/** 造一个月的打卡：每个工作日 08:10 / 19:31（加班 121 分） */
function monthRecords(month, days) {
  const records = [];
  for (let d = 1; d <= days; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const [seq, time] of [[1, '08:10:00'], [2, '19:31:00']]) {
      records.push({
        ATTDATE: `${date} ${time}`,
        ATTADDRESS: '',
        LOCATIONTYPE: '手动补录',
        STATUSCOLOR: null,
        SOURCE: 'manual',
        SEQ: seq,
        _first_seen: `${date}T19:40:00+08:00`,
        _last_seen: `${date}T19:40:00+08:00`,
      });
    }
  }
  return records;
}

function stage(name) {
  const dir = join(root, `.tmp-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // 以构建产物为基础，替换 otData
  cpSync(distDir, dir, { recursive: true });
  rmSync(join(dir, 'otData'), { recursive: true, force: true });
  mkdirSync(join(dir, 'otData'), { recursive: true });
  return dir;
}

/* ---------- 多月份：3 个月，无 all.csv ---------- */
const multi = stage('multi');
const months = ['2026-07', '2026-08', '2026-09'];
const counts = {};

// 在「今天」（按北京时间算）补一条只有上班、没有下班的卡，
// 用来验证 pendingCounts 开关：
//   - 该日状态为 pending，且是当月唯一未完成的日子
//   - 开关关闭（默认）时不计入平均，打开时按 0 加班计入
// 注意必须用真实「今天」：computeDays 只在 date === today 时判 pending。
//
// 另一种形态 ——「今天连一条卡都没有」—— 一个站点只能有一个「今天」，
// 所以放在 scripts/selftest.mjs 里用合成数据覆盖（那里断言了补日、按 0 计入、
// 以及关闭时该日完全不出现）。
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

for (const m of months) {
  const records = monthRecords(m, m === '2026-09' ? 30 : 31);
  // 同一天若已有下班卡，先去掉，保证它是干净的 pending
  const filtered = records.filter((r) => !r.ATTDATE.startsWith(today));
  if (today.startsWith(m)) {
    filtered.push({
      ATTDATE: `${today} 08:00:00`,
      ATTADDRESS: '',
      LOCATIONTYPE: '手动补录',
      STATUSCOLOR: null,
      SOURCE: 'manual',
      SEQ: 1,
      _first_seen: `${today}T08:01:00+08:00`,
      _last_seen: `${today}T08:01:00+08:00`,
    });
  }
  filtered.sort((a, b) => (a.ATTDATE < b.ATTDATE ? -1 : 1));
  counts[m] = filtered.length;
  writeFileSync(
    join(multi, 'otData', `${m}.json`),
    `${JSON.stringify({ month: m, timezone: 'Asia/Shanghai', count: filtered.length, records: filtered }, null, 2)}\n`,
  );
}
writeFileSync(
  join(multi, 'otData', 'index.json'),
  `${JSON.stringify(
    {
      updated_at: '2026-09-30T19:40:00+08:00',
      months,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    null,
    2,
  )}\n`,
);

/* ---------- 兜底：只有 all.csv（无 index.json、无单月 JSON） ---------- */
const fallback = stage('fallback');
const head = 'ATTDATE,ATTADDRESS,LOCATIONTYPE,STATUSCOLOR,SOURCE,SEQ,ID,_first_seen,_last_seen';
const lines = [head];
for (const m of ['2026-08', '2026-09']) {
  for (const r of monthRecords(m, 31)) {
    lines.push(`${r.ATTDATE},,"手动补录",,manual,${r.SEQ},,${r._first_seen},${r._last_seen}`);
  }
}
writeFileSync(join(fallback, 'otData', 'all.csv'), `${lines.join('\n')}\n`);

/* ---------- 空数据：otData 里什么都没有 ---------- */
stage('empty');

const bundle = readdirSync(join(distDir, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.replace(/^index-|\.js$/g, ''))[0];

console.log('多月份站点 :', multi, JSON.stringify(counts));
console.log('兜底站点   :', fallback);
console.log('空数据站点 :', join(root, '.tmp-empty'));
console.log(`所用产物   : dist/assets/index-${bundle}.js（与 dist/ 一致）`);
