from pathlib import Path

page_path = Path('src/app/events/[id]/page.tsx')
text = page_path.read_text(encoding='utf-8')

text = text.replace("import { use, useEffect, useState } from 'react';", "import { use, useEffect, useState } from 'react';\nimport type { Session } from '@supabase/supabase-js';")
text = text.replace("import { ALLOWED_EMAIL_DOMAINS, STUDENT_EMAIL_DOMAIN } from '@/lib/config';", "import { STUDENT_EMAIL_DOMAIN } from '@/lib/config';")

old_states = """  const [studentName, setStudentName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [isEmailEdited, setIsEmailEdited] = useState(false);
"""
new_states = """  const [studentName, setStudentName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
"""
if old_states not in text:
    raise SystemExit('form state block not found')
text = text.replace(old_states, new_states, 1)

marker = """  useEffect(() => {
    async function fetchEventDetails() {
"""
auth_effect = """  useEffect(() => {
    let mounted = true;

    const applySession = (session: Session | null) => {
      if (!mounted) return;
      setAuthSession(session);
      const email = session?.user?.email?.trim().toLowerCase() ?? '';
      const match = email.match(/^s([0-9]{2}[a-z][0-9]{3})@ge\\.osaka-sandai\\.ac\\.jp$/i);
      if (match) {
        setUniversityEmail(email);
        setStudentNumber(match[1].toUpperCase());
        setError(null);
      } else {
        setUniversityEmail('');
        setStudentNumber('');
        if (session) {
          setError('大阪産業大学のGoogleアカウントでログインしてください。');
        }
      }
      setAuthLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleGoogleLogin = async () => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href,
        queryParams: {
          hd: STUDENT_EMAIL_DOMAIN,
          prompt: 'select_account',
        },
      },
    });
    if (signInError) setError('Googleログインを開始できませんでした。');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setStudentName('');
    setStudentNumber('');
    setUniversityEmail('');
  };

""" + marker
if marker not in text:
    raise SystemExit('event effect marker not found')
text = text.replace(marker, auth_effect, 1)

start = text.index("  // Handle student number change")
end = text.index("  const handleSlotToggle", start)
text = text[:start] + text[end:]

text = text.replace("""    if (!cleanName || !normalizedNumber || !cleanEmail) {
      setError('すべての項目を入力してください。');
""", """    if (!authSession) {
      setError('大学Googleアカウントでログインしてください。');
      setBooking(false);
      return;
    }

    if (!cleanName || !normalizedNumber || !cleanEmail) {
      setError('氏名を入力してください。');
""", 1)

# Replace the second identical validation (walk-in)
pos = text.find("""    if (!cleanName || !normalizedNumber || !cleanEmail) {
      setError('すべての項目を入力してください。');
""", text.find('const handleWalkinSubmit'))
if pos == -1:
    raise SystemExit('walkin validation not found')
replacement = """    if (!authSession) {
      setError('大学Googleアカウントでログインしてください。');
      setBooking(false);
      return;
    }

    if (!cleanName || !normalizedNumber || !cleanEmail) {
      setError('氏名を入力してください。');
"""
old = """    if (!cleanName || !normalizedNumber || !cleanEmail) {
      setError('すべての項目を入力してください。');
"""
text = text[:pos] + text[pos:].replace(old, replacement, 1)

# Remove redundant frontend email/domain checks in both handlers.
for _ in range(2):
    begin = text.find("    // Student number regex validation")
    if begin == -1:
        break
    finish = text.find("    try {", begin)
    if finish == -1:
        raise SystemExit('validation end not found')
    text = text[:begin] + text[finish:]

form_start = text.index("          <form onSubmit={handleBookingSubmit}>")
name_start = text.index("            <div className=\"form-group\">", form_start)
notice_start = text.index("            <div style={{", name_start)
old_identity = text[name_start:notice_start]
new_identity = """            {authLoading ? (
              <div style={{ padding: '18px 0', color: 'var(--text-secondary)' }}>ログイン状態を確認しています...</div>
            ) : !authSession || !universityEmail ? (
              <div style={{ marginBottom: '20px' }}>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.6 }}>
                  予約・当日券の取得には、大阪産業大学のGoogleアカウントでログインしてください。
                </p>
                <button type="button" className="btn btn-primary" onClick={handleGoogleLogin}>
                  Googleでログイン
                </button>
              </div>
            ) : (
              <>
                <div style={{
                  marginBottom: '18px', padding: '14px 16px', borderRadius: 'var(--radius-md)',
                  background: 'var(--card-bg)', border: '1px solid var(--card-border)'
                }}>
                  <div style={{ fontWeight: 700, marginBottom: '8px' }}>大学アカウントで認証済み</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    学籍番号：<strong style={{ color: 'var(--text-primary)' }}>{studentNumber}</strong><br />
                    大学メール：<strong style={{ color: 'var(--text-primary)' }}>{universityEmail}</strong>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout} style={{ marginTop: '10px' }}>
                    別のアカウントでログイン
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="studentName">氏名</label>
                  <input
                    id="studentName"
                    type="text"
                    className="form-input"
                    placeholder="例：山田 太郎"
                    required
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    disabled={booking}
                    autoComplete="name"
                  />
                </div>
              </>
            )}

"""
text = text[:name_start] + new_identity + text[notice_start:]

text = text.replace("disabled={booking || !isReservationButtonEnabled}", "disabled={booking || authLoading || !authSession || !universityEmail || !studentName.trim() || !isReservationButtonEnabled}", 1)
text = text.replace("style={{ opacity: isReservationButtonEnabled ? 1 : 0.5 }}", "style={{ opacity: authSession && universityEmail && studentName.trim() && isReservationButtonEnabled ? 1 : 0.5 }}", 1)
text = text.replace("disabled={booking || !isWalkinButtonEnabled}", "disabled={booking || authLoading || !authSession || !universityEmail || !studentName.trim() || !isWalkinButtonEnabled}", 1)

page_path.write_text(text, encoding='utf-8')

migration = r'''BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_verified_university_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_student_number text;
  v_role text;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

  -- Service-role and administrators may create/manage records without student OAuth.
  IF v_role = 'service_role' OR EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '大学Googleアカウントでログインしてください。';
  END IF;

  SELECT lower(u.email)
    INTO v_email
    FROM auth.users u
   WHERE u.id = auth.uid()
     AND u.email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RAISE EXCEPTION '確認済みの大学Googleアカウントが必要です。';
  END IF;

  IF v_email !~ '^s[0-9]{2}[a-z][0-9]{3}@ge\\.osaka-sandai\\.ac\\.jp$' THEN
    RAISE EXCEPTION '大阪産業大学のGoogleアカウントでログインしてください。';
  END IF;

  v_student_number := upper(substring(v_email from '^s([0-9]{2}[a-z][0-9]{3})@'));
  NEW.university_email := v_email;
  NEW.student_number := v_student_number;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_verified_university_identity ON public.reservations;
CREATE TRIGGER reservations_verified_university_identity
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_university_identity();

REVOKE ALL ON FUNCTION public.enforce_verified_university_identity() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_walkin_reservation(uuid, uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_reservations_bulk(uuid, uuid[], text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_walkin_reservation(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservations_bulk(uuid, uuid[], text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
'''
Path('supabase/migrations/20260724000300_require_google_university_auth.sql').write_text(migration, encoding='utf-8')
