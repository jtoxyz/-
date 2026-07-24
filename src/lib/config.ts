/**
 * Global application settings loaded from environment variables.
 */

// [重要度: 高]
// 予約を許可する大学メールドメインを環境変数から読み込み、比較しやすい小文字の配列へ変換する。
// 値を変更すると申込可能な利用者範囲に影響するため、本番環境の設定と合わせて確認すること。
// Comma-separated list of domains allowed to book tickets, e.g. "ge.osaka-sandai.ac.jp,osaka-sandai.ac.jp"
export const ALLOWED_EMAIL_DOMAINS = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || 'ge.osaka-sandai.ac.jp'
)
  .split(',')
  .map((d) => d.trim().toLowerCase());

// [重要度: 高]
// 学籍番号から大学メールアドレスを自動生成するときに使用する既定ドメイン。
// 許可ドメイン一覧と不一致にすると、自動生成されたメールが入力チェックで拒否される可能性がある。
// Default domain used to auto-generate the email from the student ID
export const STUDENT_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_STUDENT_EMAIL_DOMAIN || 'ge.osaka-sandai.ac.jp';