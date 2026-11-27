// スマホアプリ(がっけんぽアプリ)への通知を送る Edge Function。pg_cron から10分おきに呼ぶ。
//
//   1. 新しく公開された企画 → 通知をオンにしている全端末へ
//   2. 開始が近づいた予約(24時間前・1時間前) → その予約をした本人の端末へ
//
// 送るのは Firebase Cloud Messaging(FCM。無料・通数の上限なし)。iPhone も Android も FCM を通す。
// 必要なシークレット(Supabase の Edge Functions → Secrets):
//   FCM_SERVICE_ACCOUNT … Firebase のサービスアカウントの鍵(JSON をそのまま)。無ければ何もしないで終わる
//   APP_PUSH_CRON_SECRET … pg_cron から呼ぶときの合言葉(16文字以上)。ヘッダー x-cron-secret で受け取る
// 送る相手の選び方はデータベースの関数(app_push_due_new_events / app_push_due_reminders)。
// 個人情報(氏名・学籍番号)は通知に入れない。企画名と時刻だけ。
import { createClient } from 'npm:@supabase/supabase-js@2.108.2';

const RESERVATION_ORIGIN = 'https://xn--0kq264i.xn--v8jk7cufve.jp'; // 予約.がっけんぽ.jp

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
type Device = { token: string; platform: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 日本時間の「11月27日(金) 13:00」
function jstLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}

// ---- Google の認証(サービスアカウントの鍵で、FCM を呼ぶための一時的な鍵をもらう) ----
const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(signature)}` }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google の認証に失敗しました: ${res.status}`);
  return data.access_token;
}

// 1台に送る。端末がもう無い(アプリを消した等)ときは 'gone' を返す
async function sendOne(sa: ServiceAccount, accessToken: string, token: string, title: string, body: string, url: string): Promise<'ok' | 'gone' | 'error'> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: { url },
        android: { priority: 'high', notification: { sound: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text)) return 'gone';
  console.error('[app-push] 送信に失敗', res.status, text.slice(0, 300));
  return 'error';
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('APP_PUSH_CRON_SECRET') ?? '';
  if (secret.length < 16 || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);

  const saRaw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!saRaw) return json({ skipped: 'FCM_SERVICE_ACCOUNT が未設定です' });
  const sa = JSON.parse(saRaw) as ServiceAccount;

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const accessToken = await googleAccessToken(sa);
  const gone = new Set<string>();
  const stats = { newEvents: 0, reminders: 0, sent: 0, gone: 0, errors: 0 };

  // 送った記録を先に入れる(入れられたときだけ送る。2つ同時に動いても2回送らない)
  async function claim(kind: string, refId: string): Promise<boolean> {
    const { error } = await db.from('app_push_sent').insert({ kind, ref_id: refId });
    if (!error) return true;
    if (error.code !== '23505') console.error('[app-push] 記録に失敗', error.message);
    return false;
  }

  async function sendTo(devices: Device[], title: string, body: string, url: string) {
    for (const d of devices) {
      if (gone.has(d.token)) continue;
      const r = await sendOne(sa, accessToken, d.token, title, body, url);
      if (r === 'ok') stats.sent++;
      else if (r === 'gone') { gone.add(d.token); stats.gone++; }
      else stats.errors++;
    }
  }

  // 1. 新しい企画
  const { data: events, error: evErr } = await db.rpc('app_push_due_new_events');
  if (evErr) throw evErr;
  if (events?.length) {
    const { data: devices, error } = await db.from('app_push_devices').select('token, platform')
      .eq('notify_new_events', true).is('disabled_at', null);
    if (error) throw error;
    for (const e of events) {
      if (!(await claim('new_event', e.event_id))) continue;
      stats.newEvents++;
      const when = jstLabel(e.starts_at);
      await sendTo(devices ?? [], '新しい企画が公開されました', when ? `${e.title}(${when}〜)` : e.title,
        `${RESERVATION_ORIGIN}/reserve?id=${encodeURIComponent(e.event_id)}`);
    }
  }

  // 2. 予約が近づいた
  const { data: reminders, error: remErr } = await db.rpc('app_push_due_reminders');
  if (remErr) throw remErr;
  for (const r of reminders ?? []) {
    if (!(await claim(r.kind, r.reservation_id))) continue;
    const { data: devices, error } = await db.from('app_push_devices').select('token, platform')
      .eq('user_id', r.user_id).eq('notify_reminders', true).is('disabled_at', null);
    if (error) throw error;
    if (!devices?.length) continue;
    stats.reminders++;
    const name = r.slot_label ? `${r.event_title}(${r.slot_label})` : r.event_title;
    const title = r.kind === 'reminder_1h' ? 'まもなく予約の時間です' : '予約した企画が近づいています';
    await sendTo(devices, title, `${name} は ${jstLabel(r.starts_at)} からです`, `${RESERVATION_ORIGIN}/my-tickets`);
  }

  if (gone.size) {
    await db.from('app_push_devices').update({ disabled_at: new Date().toISOString() }).in('token', [...gone]);
  }
  return json({ ok: true, ...stats });
});
