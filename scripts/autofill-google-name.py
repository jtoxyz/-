from pathlib import Path

path = Path('src/app/events/[id]/page.tsx')
text = path.read_text(encoding='utf-8')
old = """      if (match) {
        setUniversityEmail(email);
        setStudentNumber(match[1].toUpperCase());
        setError(null);
"""
new = """      if (match) {
        setUniversityEmail(email);
        const normalizedStudentNumber = match[1].toUpperCase();
        setStudentNumber(normalizedStudentNumber);
        const googleName = String(
          session?.user?.user_metadata?.full_name ??
          session?.user?.user_metadata?.name ??
          ''
        ).trim();
        const nameWithoutStudentNumber = googleName
          .replace(normalizedStudentNumber, '')
          .trim();
        setStudentName((current) => current || nameWithoutStudentNumber || googleName);
        setError(null);
"""
if old not in text:
    raise SystemExit('target snippet not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')