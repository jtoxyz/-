// Readability-focused wrapper around SheetJS Community Edition.
// It keeps the existing export API while applying sensible widths, filters,
// row heights and print settings to every generated worksheet.
// @ts-expect-error The package ships the ESM runtime without a matching declaration for this subpath.
import * as BaseXLSX from 'xlsx/xlsx.mjs';

const baseUtils = BaseXLSX.utils;

type CellAddress = { r: number; c: number };
type CellRange = { s: CellAddress; e: CellAddress };

type Worksheet = Record<string, unknown> & {
  ['!ref']?: string;
  ['!cols']?: Array<{ wch: number }>;
  ['!rows']?: Array<{ hpt: number }>;
  ['!autofilter']?: { ref: string };
  ['!freeze']?: { xSplit: number; ySplit: number; topLeftCell: string; activePane: string; state: string };
  ['!margins']?: Record<string, number>;
  ['!pageSetup']?: Record<string, unknown>;
  ['!merges']?: CellRange[];
};

const japaneseCollator = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'base',
  ignorePunctuation: true,
});

function formatPrintDate(): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).format(new Date());
}

function isReservationExport(data: unknown[][]): boolean {
  if (data.length === 0 || !Array.isArray(data[0])) return false;
  const headers = data[0].map((value) => String(value ?? '').trim());
  return headers.includes('企画名') && headers.includes('氏名') && headers.includes('学籍番号') && headers.includes('開催枠');
}

function buildReservationSheetData(data: unknown[][]): {
  rows: unknown[][];
  headerRow: number;
  merges: CellRange[];
} {
  const sourceHeaders = data[0].map((value) => String(value ?? '').trim());
  const eventIndex = sourceHeaders.indexOf('企画名');
  const nameIndex = sourceHeaders.indexOf('氏名');
  const studentNumberIndex = sourceHeaders.indexOf('学籍番号');
  const slotIndex = sourceHeaders.indexOf('開催枠');

  const sourceRows = data.slice(1).filter((row) => Array.isArray(row));
  const eventTitle = String(sourceRows[0]?.[eventIndex] ?? '予約者').trim() || '予約者';

  const sortedRows = [...sourceRows].sort((left, right) => {
    const leftSlot = String(left?.[slotIndex] ?? '');
    const rightSlot = String(right?.[slotIndex] ?? '');
    const slotComparison = japaneseCollator.compare(leftSlot, rightSlot);
    if (slotComparison !== 0) return slotComparison;

    const leftName = String(left?.[nameIndex] ?? '').replace(/[\s　]+/g, ' ').trim();
    const rightName = String(right?.[nameIndex] ?? '').replace(/[\s　]+/g, ' ').trim();
    const nameComparison = japaneseCollator.compare(leftName, rightName);
    if (nameComparison !== 0) return nameComparison;

    return japaneseCollator.compare(
      String(left?.[studentNumberIndex] ?? ''),
      String(right?.[studentNumberIndex] ?? ''),
    );
  });

  const title = `${eventTitle} 受付用予約者リスト（印刷日時: ${formatPrintDate()}）`;
  const outputHeaders = ['No.', '氏名', '学籍番号', '開催枠', '受付チェック欄（当日はここに記入してください）'];
  const outputRows = sortedRows.map((row, index) => [
    index + 1,
    row?.[nameIndex] ?? '',
    row?.[studentNumberIndex] ?? '',
    row?.[slotIndex] ?? '-',
    '',
  ]);

  return {
    rows: [[title, '', '', '', ''], outputHeaders, ...outputRows],
    headerRow: 1,
    merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }],
  };
}

function improveWorksheet(
  worksheet: Worksheet,
  options?: { headerRow?: number; merges?: CellRange[]; reservationLayout?: boolean },
): Worksheet {
  const range = worksheet['!ref'];
  if (!range) return worksheet;

  const decoded = baseUtils.decode_range(range);
  const columnCount = decoded.e.c - decoded.s.c + 1;
  const rowCount = decoded.e.r - decoded.s.r + 1;
  const headerRow = options?.headerRow ?? decoded.s.r;

  const preferredWidths = options?.reservationLayout
    ? [7, 22, 16, 18, 44]
    : [24, 18, 14, 16, 14, 14, 22, 22, 18, 18];

  worksheet['!cols'] = Array.from({ length: columnCount }, (_, index) => ({
    wch: preferredWidths[index] ?? 18,
  }));

  worksheet['!rows'] = Array.from({ length: rowCount }, (_, index) => ({
    hpt: options?.reservationLayout
      ? index === 0
        ? 30
        : index === headerRow
          ? 28
          : 22
      : index === headerRow
        ? 28
        : 22,
  }));

  worksheet['!autofilter'] = {
    ref: baseUtils.encode_range({
      s: { r: headerRow, c: decoded.s.c },
      e: { r: headerRow, c: decoded.e.c },
    }),
  };

  worksheet['!freeze'] = {
    xSplit: 0,
    ySplit: headerRow + 1,
    topLeftCell: `A${headerRow + 2}`,
    activePane: 'bottomLeft',
    state: 'frozen',
  };

  worksheet['!margins'] = {
    left: 0.3,
    right: 0.3,
    top: 0.5,
    bottom: 0.5,
    header: 0.2,
    footer: 0.2,
  };

  worksheet['!pageSetup'] = {
    orientation: options?.reservationLayout || columnCount >= 6 ? 'landscape' : 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };

  if (options?.merges?.length) {
    worksheet['!merges'] = options.merges;
  }

  return worksheet;
}

export const utils = {
  ...baseUtils,
  aoa_to_sheet(data: unknown[][], options?: Record<string, unknown>) {
    if (isReservationExport(data)) {
      const reservationSheet = buildReservationSheetData(data);
      return improveWorksheet(
        baseUtils.aoa_to_sheet(reservationSheet.rows, options) as Worksheet,
        {
          headerRow: reservationSheet.headerRow,
          merges: reservationSheet.merges,
          reservationLayout: true,
        },
      );
    }

    return improveWorksheet(baseUtils.aoa_to_sheet(data, options) as Worksheet);
  },
  json_to_sheet(data: unknown[], options?: Record<string, unknown>) {
    return improveWorksheet(baseUtils.json_to_sheet(data, options) as Worksheet);
  },
};

export const writeFile = BaseXLSX.writeFile;
export const writeFileXLSX = BaseXLSX.writeFileXLSX;
export const write = BaseXLSX.write;
export const read = BaseXLSX.read;
export const readFile = BaseXLSX.readFile;
