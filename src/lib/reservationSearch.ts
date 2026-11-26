/** 氏名・学籍番号・大学メールのどれかに検索語が含まれるか（空の検索は全件一致） */
export function matchesReservationSearch(
  row: { student_name: string; student_number: string; university_email: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [row.student_name, row.student_number, row.university_email].some((value) => (value ?? '').toLowerCase().includes(q))
}
