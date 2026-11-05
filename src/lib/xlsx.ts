// ブラウザで .xlsx を作ってダウンロードする最小限の実装。
// 文字列・数値のセル、1行目の太字、1行目の固定、列幅だけに対応する。

import { strToU8, zipSync } from 'fflate';

export type XlsxCell = string | number | null | undefined;
export type XlsxSheet = {
  name: string;
  rows: XlsxCell[][];
  /** 列幅（文字数の目安）。足りない列は自動 */
  columnWidths?: number[];
  /** 太字にする行（0始まり） */
  boldRows?: number[];
  /** 1行目を固定する */
  freezeHeader?: boolean;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 で使えない制御文字を除く
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** シート名は31文字まで、[]:*?/\ は使えない、重複不可 */
function safeSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, '_').slice(0, 28) || `Sheet${i + 1}`);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base}(${n++})`;
    used.add(name.toLowerCase());
    return name;
  });
}

function textWidth(value: XlsxCell): number {
  const text = value === null || value === undefined ? '' : String(value);
  // 全角は2文字分として数える
  let width = 0;
  for (const ch of text.split('\n')[0] ?? '') width += /[\u0000-ÿ]/.test(ch) ? 1 : 2;
  return width;
}

function sheetXml(sheet: XlsxSheet): string {
  const bold = new Set(sheet.boldRows ?? []);
  const columnCount = Math.max(0, ...sheet.rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, c) => {
    if (sheet.columnWidths?.[c]) return sheet.columnWidths[c];
    const longest = Math.max(4, ...sheet.rows.slice(0, 500).map((row) => textWidth(row[c])));
    return Math.min(60, longest + 2);
  });

  const cols = columnCount > 0
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const pane = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';

  const rows = sheet.rows.map((row, r) => {
    const style = bold.has(r) ? ' s="1"' : '';
    const cells = row.map((cell, c) => {
      if (cell === null || cell === undefined || cell === '') return '';
      const ref = `${columnName(c)}${r + 1}`;
      if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${ref}"${style}><v>${cell}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const names = safeSheetNames(sheets.map((s) => s.name));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Yu Gothic"/></font><font><b/><sz val="11"/><name val="Yu Gothic"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  return zipSync(files);
}

export function downloadXlsx(sheets: XlsxSheet[], fileName: string): void {
  const data = buildXlsx(sheets);
  const blob = new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
