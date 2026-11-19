// 学籍番号（例: 24B123 = 2024年度入学・学科コード B）から、学部と学年を読み取る。

/**
 * 学科コード → 学部名。ここに書いたコードは学部名でまとめて数える。
 * 書いていないコードは「学科コード ◯」として出す。
 */
export const DEPARTMENT_FACULTY: Record<string, string> = {};

const STUDENT_NUMBER = /^([0-9]{2})([A-Z])[0-9]{3}$/;

export function departmentCode(studentNumber: string): string | null {
  return String(studentNumber || '').trim().toUpperCase().match(STUDENT_NUMBER)?.[2] ?? null;
}

/** 学部名（対応表にないコードは「学科コード ◯」、読み取れなければ「不明」） */
export function facultyLabel(studentNumber: string): string {
  const code = departmentCode(studentNumber);
  if (!code) return '不明';
  return DEPARTMENT_FACULTY[code] ?? `学科コード ${code}`;
}

/** 日本時間で4月始まりの年度（西暦） */
export function academicYear(date: Date): number {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCMonth() >= 3 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1;
}

/** at の時点の学年（1〜）。読み取れなければ null */
export function gradeAt(studentNumber: string, at: Date): number | null {
  const match = String(studentNumber || '').trim().toUpperCase().match(STUDENT_NUMBER);
  if (!match) return null;
  const grade = academicYear(at) - (2000 + Number(match[1])) + 1;
  return grade >= 1 ? grade : null;
}

export const GRADE_LABELS = ['1年', '2年', '3年', '4年', '5年以上', '不明'] as const;
export type GradeLabel = (typeof GRADE_LABELS)[number];

export function gradeLabel(grade: number | null): GradeLabel {
  if (grade === null) return '不明';
  return grade >= 5 ? '5年以上' : (`${grade}年` as GradeLabel);
}
