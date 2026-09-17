/**
 * 极简 CSV 解析（RFC4180 子集）
 * 支持双引号包裹字段、字段内逗号/换行、"" 转义。
 */
export function parseCSV(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  // 丢弃完全空白的行
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
