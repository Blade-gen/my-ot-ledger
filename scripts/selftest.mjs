/**
 * 本地自检：node scripts/selftest.mjs
 * 只验证纯计算逻辑，不依赖浏览器。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseRecords, computeDays, summarize, formatDuration, formatHours, lastSyncedAt } = await import(
  pathToFileURL(join(root, 'assets/js/model.js')).href
);

const csv = readFileSync(join(root, 'otData/all.csv'), 'utf8');
const records = parseRecords(csv);
console.log(`解析记录数：${records.length}`);
console.log(`最近同步：${lastSyncedAt(records)}`);

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

// 期望：09-07..09-16 共 8 天计入，合计 811 分钟
const expectTotal = 121 + 156 + 91 + 91 + 6 + 98 + 155 + 93;
console.log('\n--- 断言 ---');
const checks = [
  ['计入天数 = 8', s.days === 8],
  [`总加班 = ${expectTotal} 分钟`, s.totalMinutes === expectTotal],
  ['09-17 待更新且不计入', days.find((d) => d.date === '2026-09-17').status === 'pending'],
  ['09-17 不计入', days.find((d) => d.date === '2026-09-17').counted === false],
  ['09-07 加班 2小时1分', days.find((d) => d.date === '2026-09-07').otMinutes === 121],
  ['末日打卡晚于下班时间才计加班', days.every((d) => d.otMinutes === 0 || d.last.minute > 1050)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed += 1;
}

// 排除某天的效果
const excluded = computeDays(records, { ...settings, exclusions: { '2026-09-08': { excluded: true } } }, {
  today: '2026-09-17',
  nowMinutes: 0,
});
const s2 = summarize(excluded);
console.log(`\n排除 09-08 后：${s2.days} 天，日均 ${formatHours(s2.avgMinutes)} 小时/天`);
if (s2.days !== 7) failed += 1;

process.exit(failed ? 1 : 0);
