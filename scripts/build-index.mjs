/**
 * 生成 otData/index.json —— 站点首屏只读它来知道「有哪些月份」，
 * 具体某个月的记录再按需拉 otData/YYYY-MM.json。
 *
 * 用法：
 *   node scripts/build-index.mjs            # 写入 otData/index.json
 *   node scripts/build-index.mjs --check    # 只检查是否为最新（CI 用，不写文件）
 *
 * 设计要点：
 *   - 月份清单以**实际存在的 otData/YYYY-MM.json** 为准，而不是靠 all.csv 推断；
 *   - 记录数以各月 JSON 内的数组长度为准（读不动/坏文件时记 0，不影响其它月份）；
 *   - 输出稳定排序 + 末尾换行，保证同样的输入产出逐字节相同的文件（避免无意义 diff）。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'otData');
const outFile = join(dataDir, 'index.json');

const MONTH_RE = /^(\d{4})-(\d{2})\.json$/;

/** 读一个月份文件，返回 { month, count, updatedAt }；坏文件按 0 条处理 */
function readMonthFile(name) {
  const month = name.slice(0, 7);
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, name), 'utf8'));
    const records = Array.isArray(parsed) ? parsed : parsed && parsed.records;
    return {
      month,
      count: Array.isArray(records) ? records.length : 0,
      updatedAt: (parsed && parsed.updated_at) || '',
    };
  } catch (error) {
    console.warn(`⚠️  跳过无法解析的 ${name}：${error.message}`);
    return { month, count: 0, updatedAt: '' };
  }
}

const months = readdirSync(dataDir)
  .filter((name) => MONTH_RE.test(name))
  .sort()
  .map(readMonthFile);

if (!months.length) {
  console.error('✗ otData/ 下没有找到任何 YYYY-MM.json，未生成 index.json');
  process.exit(1);
}

const total = months.reduce((sum, m) => sum + m.count, 0);
// updated_at 取各月里最新的一个，便于区分「数据本身何时更新」
const updatedAt =
  months
    .map((m) => m.updatedAt)
    .filter(Boolean)
    .sort()
    .pop() || '';

const index = {
  updated_at: updatedAt,
  months: months.map((m) => m.month),
  counts: Object.fromEntries(months.map((m) => [m.month, m.count])),
  total,
};

const text = `${JSON.stringify(index, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outFile, 'utf8');
  } catch {
    /* 不存在视为不一致 */
  }
  if (current !== text) {
    console.error('✗ otData/index.json 不是最新的，请在本地运行：node scripts/build-index.mjs');
    process.exit(1);
  }
  console.log(`✓ otData/index.json 已是最新（${months.length} 个月 / ${total} 条记录）`);
  process.exit(0);
}

writeFileSync(outFile, text);
console.log(`✓ 已生成 otData/index.json：${months.length} 个月 / ${total} 条记录`);
for (const m of months) console.log(`   ${m.month}  ${String(m.count).padStart(4)} 条`);
if (updatedAt) console.log(`   数据最新时间：${updatedAt}`);
