// Readability-focused wrapper around SheetJS Community Edition.
// It keeps the existing export API while applying sensible widths, filters,
// row heights and print settings to every generated worksheet.
// @ts-expect-error The package ships the ESM runtime without a matching declaration for this subpath.
import * as BaseXLSX from 'xlsx/xlsx.mjs';

const baseUtils = BaseXLSX.utils;

type Worksheet = Record<string, unknown> & {
  ['!ref']?: string;
  ['!cols']?: Array<{ wch: number }>;
  ['!rows']?: Array<{ hpt: number }>;
  ['!autofilter']?: { ref: string };
  ['!freeze']?: { xSplit: number; ySplit: number; topLeftCell: string; activePane: string; state: string };
  ['!margins']?: Record<string, number>;
  ['!pageSetup']?: Record<string, unknown>;
};

function improveWorksheet(worksheet: Worksheet): Worksheet {
  const range = worksheet['!ref'];
  if (!range) return worksheet;

  const decoded = baseUtils.decode_range(range);
  const columnCount = decoded.e.c - decoded.s.c + 1;
  const rowCount = decoded.e.r - decoded.s.r + 1;

  const preferredWidths = [24, 18, 14, 16, 14, 14, 22, 22, 18, 18];
  worksheet['!cols'] = Array.from({ length: columnCount }, (_, index) => ({
    wch: preferredWidths[index] ?? 18,
  }));

  worksheet['!rows'] = Array.from({ length: rowCount }, (_, index) => ({
    hpt: index === 0 ? 28 : 22,
  }));

  worksheet['!autofilter'] = {
    ref: baseUtils.encode_range({
      s: { r: decoded.s.r, c: decoded.s.c },
      e: { r: decoded.s.r, c: decoded.e.c },
    }),
  };

  // Supported by Excel-compatible readers; ignored safely by readers that do not use it.
  worksheet['!freeze'] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: 'A2',
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
    orientation: columnCount >= 6 ? 'landscape' : 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
  };

  return worksheet;
}

export const utils = {
  ...baseUtils,
  aoa_to_sheet(data: unknown[][], options?: Record<string, unknown>) {
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
