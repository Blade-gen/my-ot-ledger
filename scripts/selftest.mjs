/**
 * 本地自检：node scripts/selftest.mjs
 * 只验证纯计算逻辑，不依赖浏览器。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseRecords, recordsFromJSON, computeDays, summarize, formatDuration, formatHours, lastSyncedAt } =
  await import(pathToFileURL(join(root, 'src/lib/model.js')).href);

const csv = readFileSync(join(root, 'otData/all.csv'), 'utf8');
const records = parseRecords(csv);
console.log(`解析记录数：${records.length}`);
console.log(`最近同步：${lastSyncedAt(records)}`);

/* ------------------------------------------------------------------ *
 * 按月 JSON：主数据源。逐月读入，并与 all.csv 的结果做一致性比对，
 * 确保两条路径算出来的东西完全一样（换数据源不能改变任何数字）。
 * ------------------------------------------------------------------ */
const monthFiles = readdirSync(join(root, 'otData'))
  .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
  .sort();

const fromJson = [];
console.log('\n--- 按月 JSON ---');
for (const file of monthFiles) {
  const arr = recordsFromJSON(readFileSync(join(root, 'otData', file), 'utf8'));
  console.log(`${file}：${arr.length} 条`);
  fromJson.push(...arr);
}
fromJson.sort((a, b) => (a.date === b.date ? a.minute - b.minute : a.date < b.date ? -1 : 1));

// 坏输入必须被容错掉，而不是抛异常
const tolerant = [
  ['空字符串', recordsFromJSON('')],
  ['非法 JSON', recordsFromJSON('{oops')],
  ['null', recordsFromJSON(null)],
  ['无 records 的对象', recordsFromJSON({ foo: 1 })],
  ['坏行不炸', recordsFromJSON([{ ATTDATE: 'not-a-date' }, { ATTDATE: '2026-01-02 09:00:00' }])],
];

const settings = { workdayEnd: '17:30', minPunches: 2, forgotCounts: true, exclusions: {} };

// 固定「今天」，让结果可复现（数据里 9/17 只有一次卡）
const days = computeDays(records, settings, { today: '2026-09-17', nowMinutes: 0 });

console.log('\n日期        星期  上班    下班    加班      状态');
for (const d of days) {
  console.log(
    [
      d.date,
      d.weekday,
      d.inTime,
      d.outTime,
      formatDuration(d.otMinutes).padEnd(8),
      d.status,
      d.counted ? '计入' : '不计入',
    ].join('  '),
  );
}

const s = summarize(days);
console.log('\n--- 汇总 ---');
console.log(`有效统计日：${s.days} 天`);
console.log(`总加班：${formatDuration(s.totalMinutes)}（${formatHours(s.totalMinutes)} 小时）`);
console.log(`日均加班：${formatHours(s.avgMinutes)} 小时/天`);
console.log(`最长单日：${s.maxDay ? `${s.maxDay.date} ${formatDuration(s.maxDay.otMinutes)}` : '—'}`);
console.log(`忘打卡/数据不足/待更新：${s.forgotDays}/${s.incompleteDays}/${s.pendingDays}`);

// JSON 路径应产出与 CSV 完全一致的结果
const jsonDays = computeDays(fromJson, settings, { today: '2026-09-17', nowMinutes: 0 });
const sJson = summarize(jsonDays);

/* ------------------------------------------------------------------ *
 * 规则语义用**合成数据**验证，不依赖 otData 里的真实内容
 * （真实数据每天都在变，写死总分钟数只会让测试隔几天就红一次）
 * ------------------------------------------------------------------ */
const END = 17 * 60 + 30; // 17:30
const synthetic = [
  // 过去日期、两次卡、末次早于下班时间 -> 忘打卡，加班 0
  { ATTDATE: '2026-03-02 08:00:00' },
  { ATTDATE: '2026-03-02 17:00:00' },
  // 过去日期、两次卡、末次晚于下班时间 -> 正常，加班 90 分钟
  { ATTDATE: '2026-03-03 08:00:00' },
  { ATTDATE: '2026-03-03 19:00:00' },
  // 只有一次卡 -> 数据不足
  { ATTDATE: '2026-03-04 08:00:00' },
  // 「今天」且末次打卡未超过下班时间 -> 今日待更新
  { ATTDATE: '2026-03-05 08:00:00' },
  { ATTDATE: '2026-03-05 17:00:00' },
  // 凌晨 5 点前的卡归到前一天（跨天加班）
  { ATTDATE: '2026-03-06 08:00:00' },
  { ATTDATE: '2026-03-06 19:00:00' },
  { ATTDATE: '2026-03-07 01:30:00' },
];
const synthDays = computeDays(recordsFromJSON(synthetic), settings, {
  today: '2026-03-05',
  nowMinutes: 0,
});
const byDate = (d) => synthDays.find((x) => x.date === d);
const synthSummary = summarize(synthDays);

console.log('\n--- 合成数据（规则语义） ---');
for (const d of synthDays) {
  console.log(`${d.date}  ${d.inTime} → ${d.outTime}  ${formatDuration(d.otMinutes).padEnd(8)} ${d.status}`);
}

console.log('\n--- 断言 ---');
const checks = [
  // 真实数据：换数据源不能改变任何数字，这是本次改造的核心回归保护
  ['JSON 与 CSV 记录数一致', fromJson.length === records.length],
  ['JSON 与 CSV 总加班一致', sJson.totalMinutes === s.totalMinutes],
  ['JSON 与 CSV 有效天数一致', sJson.days === s.days],
  ['JSON 与 CSV 日均一致', sJson.avgMinutes === s.avgMinutes],
  ['JSON 与 CSV 逐日加班一致', jsonDays.every((d, i) => d.date === days[i].date && d.otMinutes === days[i].otMinutes)],
  ['09-07 加班 2小时1分', days.find((d) => d.date === '2026-09-07').otMinutes === 121],
  ['末日打卡晚于下班时间才计加班', days.every((d) => d.otMinutes === 0 || d.last.minute > END)],

  // 解析容错：坏输入必须被吃掉，而不是让整站崩掉
  ['空字符串不炸', Array.isArray(tolerant[0][1]) && tolerant[0][1].length === 0],
  ['非法 JSON 不炸', Array.isArray(tolerant[1][1]) && tolerant[1][1].length === 0],
  ['null 不炸', Array.isArray(tolerant[2][1]) && tolerant[2][1].length === 0],
  ['缺 records 不炸', Array.isArray(tolerant[3][1]) && tolerant[3][1].length === 0],
  ['坏行被跳过、好行保留', tolerant[4][1].length === 1],

  // 规则语义
  ['末次早于下班时间 -> 忘打卡记 0', byDate('2026-03-02').status === 'forgot' && byDate('2026-03-02').otMinutes === 0],
  ['末次晚于下班时间 -> 加班 90 分', byDate('2026-03-03').status === 'ok' && byDate('2026-03-03').otMinutes === 90],
  ['仅一次卡 -> 数据不足且不计入', byDate('2026-03-04').status === 'incomplete' && !byDate('2026-03-04').counted],
  // pendingCounts 默认关：当天没下班卡不计入，日均只按已完整的日子算
  ['当天未打下班卡 -> 状态为今日待更新', byDate('2026-03-05').status === 'pending'],
  ['默认不把今日待更新计入平均', byDate('2026-03-05').counted === false],
  ['默认下有效天数 = 3（不含 03-05）', synthSummary.days === 3],
  ['默认下日均 = 180/3 = 60 分', synthSummary.avgMinutes === 60],
  [
    '打开 pendingCounts 后 03-05 按 0 计入',
    (() => {
      const on = computeDays(recordsFromJSON(synthetic), { ...settings, pendingCounts: true }, {
        today: '2026-03-05',
        nowMinutes: 0,
      });
      const s = summarize(on);
      return (
        on.find((d) => d.date === '2026-03-05').counted === true &&
        on.find((d) => d.date === '2026-03-05').otMinutes === 0 &&
        s.days === 4 &&
        s.avgMinutes === 45
      );
    })(),
  ],
  [
    '开关只影响 pending，不影响 forgot',
    (() => {
      const on = computeDays(recordsFromJSON(synthetic), { ...settings, pendingCounts: true }, {
        today: '2026-03-05',
        nowMinutes: 0,
      });
      // 忘打卡（03-02）仍按 forgotCounts 计入
      return on.find((d) => d.date === '2026-03-02').counted === true;
    })(),
  ],
  // 「今天一条卡都没有」：groupByDate 产不出这一天，必须由 computeDays 补出来，
  // 否则 pendingCounts 对它完全失效（开关切来切去日均都不变）。
  [
    '今天无任何打卡时，打开开关会补出该日并按 0 计入',
    (() => {
      // 专用数据：两天各 90 / 120 分（合计 210），今天 03-10 一条卡都没有
      const bare = recordsFromJSON([
        { ATTDATE: '2026-03-02 08:00:00' },
        { ATTDATE: '2026-03-02 19:00:00' },
        { ATTDATE: '2026-03-03 08:00:00' },
        { ATTDATE: '2026-03-03 19:30:00' },
      ]);
      const ctx = { today: '2026-03-10', nowMinutes: 0 };
      const on = computeDays(bare, { ...settings, pendingCounts: true }, ctx);
      const off = computeDays(bare, { ...settings, pendingCounts: false }, ctx);
      const dOn = on.find((d) => d.date === '2026-03-10');
      const sOn = summarize(on);
      const sOff = summarize(off);
      return (
        // 打开：补出该日、标为待更新、按 0 计入 —— 有效天数 +1、日均被摊薄
        !!dOn &&
        dOn.status === 'pending' &&
        dOn.counted === true &&
        dOn.otMinutes === 0 &&
        dOn.punches.length === 0 &&
        dOn.inTime === '' &&
        sOn.days === 3 &&
        sOn.totalMinutes === 210 &&
        sOn.avgMinutes === 70 &&
        // 关闭：那天完全不出现在结果里，统计与原来一致
        off.every((d) => d.date !== '2026-03-10') &&
        sOff.days === 2 &&
        sOff.totalMinutes === 210 &&
        sOff.avgMinutes === 105 &&
        // 空打卡日不能让 summarize 崩：latest 必须只从真有下班卡的日子取
        sOn.latest.date === '2026-03-03' &&
        // 「有打卡的天数」不该把补出来的空日算进去
        sOn.recordedDays === 2
      );
    })(),
  ],
  [
    '跨天打卡合并到前一日（3 条卡）',
    byDate('2026-03-06').punches.length === 3 && !synthDays.some((d) => d.date === '2026-03-07'),
  ],
  // 合并后按「分钟」重排，凌晨 01:30(90) 排在 19:00(1140) 之前，
  // 因此末次打卡仍是当天 19:00，加班按 17:30→19:00 计 90 分钟。
  ['跨天合并后末次打卡仍取 19:00', byDate('2026-03-06').status === 'ok' && byDate('2026-03-06').otMinutes === 90],
  ['忘打卡按 0 分钟计入平均，合计 180 分钟', synthSummary.totalMinutes === 180],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed += 1;
}

// 排除某天的效果：应从有效天数里去掉一天
const excludeDate = days.find((d) => d.counted).date;
const excluded = computeDays(
  records,
  { ...settings, exclusions: { [excludeDate]: { excluded: true } } },
  { today: '2026-09-17', nowMinutes: 0 },
);
const s2 = summarize(excluded);
console.log(`\n排除 ${excludeDate} 后：${s2.days} 天（原 ${s.days} 天），日均 ${formatHours(s2.avgMinutes)} 小时/天`);
if (s2.days !== s.days - 1) failed += 1;
if (excluded.find((d) => d.date === excludeDate).status !== 'excluded') failed += 1;

process.exit(failed ? 1 : 0);
