/**
 * Global application settings loaded from environment variables.
 */

// Comma-separated list of domains allowed to book tickets, e.g. "ge.osaka-sandai.ac.jp,osaka-sandai.ac.jp"
export const ALLOWED_EMAIL_DOMAINS = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || 'ge.osaka-sandai.ac.jp'
)
  .split(',')
  .map((d) => d.trim().toLowerCase());

// Default domain used to auto-generate the email from the student ID
export const STUDENT_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_STUDENT_EMAIL_DOMAIN || 'ge.osaka-sandai.ac.jp';

/** 大学Googleアカウント（学生）のメールアドレス。DB の enforce_verified_university_identity と同じ形 */
export const STUDENT_EMAIL_PATTERN = /^s([0-9]{2}[a-z][0-9]{3})@ge\.osaka-sandai\.ac\.jp$/i;

export function isStudentEmail(email: string | null | undefined): boolean {
  return STUDENT_EMAIL_PATTERN.test(String(email || '').trim());
}

/** メールアドレスから学籍番号（例: 24B123）を取り出す。学生のアドレスでなければ空文字 */
export function studentNumberFromEmail(email: string | null | undefined): string {
  const match = String(email || '').trim().match(STUDENT_EMAIL_PATTERN);
  return match ? match[1].toUpperCase() : '';
}

// 学生向け画面に出す支払い場所の既定値。「委員会室」だけでは場所が伝わらないため建物と階まで書く。
// 受付枠ごとに場所を変えるときは payment_visit_slots.location に書く（2026/10/13までの枠は学生会館6階学生健康保険委員会）
export const PAYMENT_ROOM_LABEL = '学生会館3階';
