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
