// ブラウザで .xlsx を作ってダウンロードする最小限の実装。
// 文字列・数値のセル、決まった書式（見出し・罫線・割合など）、行の固定、
// フィルター、列幅、印刷設定だけに対応する。

import { strToU8, zipSync } from 'fflate';

/** styles.xml の cellXfs の並びと対応させること */
const STYLE_IDS = {
  /** 書式なし */
  plain: 0,
  /** 太字 */
  bold: 1,
  /** 表の見出し（濃い青地・白の太字・中央寄せ・罫線） */
  header: 2,
  /** 表のセル（罫線） */
  body: 3,
  /** 表のセル（灰色の文字。キャンセル行など） */
  muted: 4,
  /** 小見出し・合計行（薄い青地・太字・罫線・数値は桁区切り） */
  section: 5,
  /** 割合（0.0%・罫線）。値は 0〜1 の数値で渡す */
  percent: 6,
  /** シートの題名（大きい太字） */
  title: 7,
  /** 表のセル（折り返し・罫線）。長い文章用 */
  wrap: 8,
  /** 整数（桁区切り・罫線） */
  integer: 9,
  /** 横棒グラフ代わりの文字（青・罫線） */
  bar: 10,
  /** 補足（灰色の文字・罫線なし） */
  note: 11,
} as const;

export type XlsxStyle = keyof typeof STYLE_IDS;
export type XlsxValue = string | number | null | undefined;
export type XlsxCell = XlsxValue | { value: XlsxValue; style: XlsxStyle };
export type XlsxSheet = {
  name: string;
  rows: XlsxCell[][];
  /** 列幅（文字数の目安）。足りない列は自動 */
  columnWidths?: number[];
  /** 上から何行を固定するか（印刷時は各ページの先頭にも繰り返す） */
  freezeRows?: number;
  /** この行（0始まり）を見出しにして、以降の全行にフィルターを付ける */
  autoFilterRow?: number;
  /** 印刷を横向きにする（どちらの向きでも横幅は1ページに収める） */
  landscape?: boolean;
};

/** 1行ぶんのセルに同じ書式を付ける。空のセルにも罫線が入る */
export function styledRow(values: XlsxValue[], style: XlsxStyle): XlsxCell[] {
  return values.map((value) => ({ value, style }));
}

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

const isStyled = (cell: XlsxCell): cell is { value: XlsxValue; style: XlsxStyle } =>
  typeof cell === 'object' && cell !== null;
const cellValue = (cell: XlsxCell): XlsxValue => (isStyled(cell) ? cell.value : cell);
const cellStyle = (cell: XlsxCell): XlsxStyle => (isStyled(cell) ? cell.style : 'plain');

/** 列幅を自動で決めるときに数えない書式（題名や補足は隣の列にはみ出して表示される） */
const OVERFLOW_STYLES: XlsxStyle[] = ['title', 'note'];

function textWidth(cell: XlsxCell): number {
  if (OVERFLOW_STYLES.includes(cellStyle(cell))) return 0;
  const value = cellValue(cell);
  const text = value === null || value === undefined ? '' : String(value);
  // 全角は2文字分として数える
  let width = 0;
  for (const ch of text.split('\n')[0] ?? '') width += /[\u0000-ÿ]/.test(ch) ? 1 : 2;
  return width;
}

const columnCountOf = (sheet: XlsxSheet) => Math.max(0, ...sheet.rows.map((row) => row.length));

/** フィルターを付ける範囲（例: A1:N120）。付けないときは null */
function autoFilterRef(sheet: XlsxSheet): string | null {
  const columnCount = columnCountOf(sheet);
  if (sheet.autoFilterRow === undefined || columnCount === 0) return null;
  const first = sheet.autoFilterRow + 1;
  const last = Math.max(first, sheet.rows.length);
  return `A${first}:${columnName(columnCount - 1)}${last}`;
}

function sheetXml(sheet: XlsxSheet): string {
  const columnCount = columnCountOf(sheet);
  const widths = Array.from({ length: columnCount }, (_, c) => {
    if (sheet.columnWidths?.[c]) return sheet.columnWidths[c];
    const longest = Math.max(4, ...sheet.rows.slice(0, 500).map((row) => textWidth(row[c])));
    // フィルターの▼ボタンのぶんも少し広げる
    return Math.min(60, longest + 3);
  });

  const cols = columnCount > 0
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const freeze = sheet.freezeRows ?? 0;
  const pane = freeze > 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '';

  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      const value = cellValue(cell);
      const styleId = STYLE_IDS[cellStyle(cell)];
      const style = styleId ? ` s="${styleId}"` : '';
      const ref = `${columnName(c)}${r + 1}`;
      if (value === null || value === undefined || value === '') return styleId ? `<c r="${ref}"${style}/>` : '';
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  const filterRef = autoFilterRef(sheet);
  const filter = filterRef ? `<autoFilter ref="${filterRef}"/>` : '';
  const page = `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${pane}${cols}<sheetData>${rows}</sheetData>${filter}${page}</worksheet>`;
}

const FONT = '<sz val="11"/><name val="Yu Gothic"/>';
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><fonts count="6"><font>${FONT}</font><font><b/>${FONT}</font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Yu Gothic"/></font><font><sz val="11"/><color rgb="FF808080"/><name val="Yu Gothic"/></font><font><b/><sz val="14"/><name val="Yu Gothic"/></font><font><sz val="11"/><color rgb="FF2E75B6"/><name val="Yu Gothic"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const names = safeSheetNames(sheets.map((s) => s.name));
  const quoted = (name: string) => `'${escapeXml(name.replace(/'/g, "''"))}'`;
  // フィルターの範囲と、印刷時に各ページへ繰り返す見出し行
  const definedNames = sheets.flatMap((sheet, i) => {
    const out: string[] = [];
    const filterRef = autoFilterRef(sheet);
    if (filterRef) {
      const [from, to] = filterRef.split(':').map((ref) => ref.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2'));
      out.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${quoted(names[i])}!${from}:${to}</definedName>`);
    }
    if (sheet.freezeRows) out.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${quoted(names[i])}!$1:$${sheet.freezeRows}</definedName>`);
    return out;
  });
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${definedNames.length > 0 ? `<definedNames>${definedNames.join('')}</definedNames>` : ''}</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES_XML),
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
