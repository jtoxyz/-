type Worksheet = {
  rows: unknown[][];
};

type Workbook = {
  sheets: Array<{ name: string; sheet: Worksheet }>;
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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildReservationRows(data: unknown[][]): unknown[][] {
  const headers = data[0].map((value) => String(value ?? '').trim());
  const eventIndex = headers.indexOf('企画名');
  const nameIndex = headers.indexOf('氏名');
  const studentNumberIndex = headers.indexOf('学籍番号');
  const slotIndex = headers.indexOf('開催枠');

  if (eventIndex < 0 || nameIndex < 0 || studentNumberIndex < 0 || slotIndex < 0) {
    return data;
  }

  const sourceRows = data.slice(1);
  const eventTitle = String(sourceRows[0]?.[eventIndex] ?? '予約者').trim() || '予約者';
  const sortedRows = [...sourceRows].sort((left, right) => {
    const slotResult = japaneseCollator.compare(
      String(left?.[slotIndex] ?? ''),
      String(right?.[slotIndex] ?? ''),
    );
    if (slotResult !== 0) return slotResult;

    const leftName = String(left?.[nameIndex] ?? '').replace(/[\s　]+/g, ' ').trim();
    const rightName = String(right?.[nameIndex] ?? '').replace(/[\s　]+/g, ' ').trim();
    const nameResult = japaneseCollator.compare(leftName, rightName);
    if (nameResult !== 0) return nameResult;

    return japaneseCollator.compare(
      String(left?.[studentNumberIndex] ?? ''),
      String(right?.[studentNumberIndex] ?? ''),
    );
  });

  return [
    [`${eventTitle} 受付用予約者リスト（印刷日時: ${formatPrintDate()}）`],
    ['No.', '氏名', '学籍番号', '開催枠', '受付チェック欄（当日はここに記入してください）'],
    ...sortedRows.map((row, index) => [
      index + 1,
      row?.[nameIndex] ?? '',
      row?.[studentNumberIndex] ?? '',
      row?.[slotIndex] ?? '-',
      '',
    ]),
  ];
}

export const utils = {
  aoa_to_sheet(data: unknown[][]): Worksheet {
    return { rows: buildReservationRows(data) };
  },
  book_new(): Workbook {
    return { sheets: [] };
  },
  book_append_sheet(workbook: Workbook, sheet: Worksheet, name: string): void {
    workbook.sheets.push({ name, sheet });
  },
};

export function writeFile(workbook: Workbook, requestedFileName: string): void {
  const sheet = workbook.sheets[0]?.sheet;
  if (!sheet || typeof document === 'undefined') return;

  const bodyRows = sheet.rows.map((row, rowIndex) => {
    if (rowIndex === 0) {
      return `<tr><th colspan="5" class="title">${escapeHtml(row[0])}</th></tr>`;
    }

    const tag = rowIndex === 1 ? 'th' : 'td';
    return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')}</tr>`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: "Yu Gothic", "Meiryo", sans-serif; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #000; padding: 7px 8px; vertical-align: middle; }
    th { background: #d9e2f3; font-weight: 700; text-align: center; }
    .title { background: #ffffff; font-size: 16pt; text-align: left; padding: 10px 4px; }
    tr td:nth-child(1) { width: 7%; text-align: center; }
    tr td:nth-child(2) { width: 22%; }
    tr td:nth-child(3) { width: 16%; text-align: center; mso-number-format:"\\@"; }
    tr td:nth-child(4) { width: 18%; text-align: center; }
    tr td:nth-child(5) { width: 37%; height: 26px; }
  </style></head><body><table>${bodyRows}</table></body></html>`;

  const blob = new Blob(['\ufeff', html], {
    type: 'application/vnd.ms-excel;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = requestedFileName.replace(/\.xlsx$/i, '.xls');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
