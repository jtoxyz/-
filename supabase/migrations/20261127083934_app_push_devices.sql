-- スマホアプリ(がっけんぽアプリ。osu-gakkenpo/shic-portal の mobile/)の通知(Firebase Cloud Messaging)の準備。
--
-- app_push_devices … 通知を送る端末。アプリが がっけんぽ.jp を開いたときに register_app_device で登録する(ログイン不要)。
--                     予約サイトに大学アカウントでログインしていれば、その人(user_id)と結びつける(予約が近づいた通知のため)。
-- app_push_sent    … 送った通知の記録(同じ通知を2回送らないため)。送るのは Edge Function の app-push。
--
-- どちらのテーブルも画面から直接は読めない・書けない(RLS を有効にして、ポリシーを作らない)。
-- 端末の登録は下の関数だけを通す。

create table if not exists public.app_push_devices (
  token text primary key check (char_length(token) between 20 and 4096),
  platform text not null check (platform in ('ios', 'android')),
  user_id uuid references auth.users(id) on delete set null,
  notify_new_events boolean not null default true,
  notify_reminders boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- 送れなかった(アプリを消した等)ときに入れる。入っている端末には送らない
  disabled_at timestamptz
);
create index if not exists app_push_devices_user_idx on public.app_push_devices (user_id) where user_id is not null;
alter table public.app_push_devices enable row level security;

create table if not exists public.app_push_sent (
  kind text not null check (kind in ('new_event', 'reminder_24h', 'reminder_1h')),
  ref_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key (kind, ref_id)
);
alter table public.app_push_sent enable row level security;

-- 端末を登録する(何度呼んでもよい)。ログインしていれば本人と結びつける。
-- 通知の種類のオン・オフは、null を渡すと今の設定のまま。
create or replace function public.register_app_device(
  p_token text,
  p_platform text,
  p_notify_new_events boolean default null,
  p_notify_reminders boolean default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_token is null or char_length(p_token) not between 20 and 4096 or p_token !~ '^[A-Za-z0-9:_\-]+$' then
    raise exception '端末の番号が正しくありません';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception '端末の種類が正しくありません';
  end if;

  insert into public.app_push_devices as d (token, platform, user_id, notify_new_events, notify_reminders)
  values (p_token, p_platform, v_uid, coalesce(p_notify_new_events, true), coalesce(p_notify_reminders, true))
  on conflict (token) do update set
    platform = excluded.platform,
    -- ログインしていない登録で、結びつけた人を消さない
    user_id = coalesce(v_uid, d.user_id),
    notify_new_events = coalesce(p_notify_new_events, d.notify_new_events),
    notify_reminders = coalesce(p_notify_reminders, d.notify_reminders),
    last_seen_at = now(),
    disabled_at = null;

  return jsonb_build_object('ok', true, 'linked', v_uid is not null);
end;
$$;

revoke all on function public.register_app_device(text, text, boolean, boolean) from public;
grant execute on function public.register_app_device(text, text, boolean, boolean) to anon, authenticated;

-- 今公開中の企画は「新しい企画」として通知しない(通知を始めた日に、前からある企画がまとめて届かないように)
insert into public.app_push_sent (kind, ref_id)
select 'new_event', e.id from public.events e where e.is_public
on conflict do nothing;

-- 通知を送る対象を選ぶ関数(Edge Function の app-push だけが使う。service_role 専用)
-- 新しく公開された企画(まだ通知していないもの)
create or replace function public.app_push_due_new_events()
returns table (event_id uuid, title text, starts_at timestamptz)
language sql
security definer
set search_path to 'public'
as $$
  select e.id, e.title, e.starts_at
  from public.events e
  where e.is_public
    and (e.auto_hide_at is null or e.auto_hide_at > now())
    and (e.ends_at is null or e.ends_at > now())
    and not exists (select 1 from public.app_push_sent s where s.kind = 'new_event' and s.ref_id = e.id)
  order by e.created_at
  limit 20;
$$;

-- 開始が近づいた予約(前日=24時間前から、と 1時間前から)。キャンセル・使用済みは除く
create or replace function public.app_push_due_reminders()
returns table (kind text, reservation_id uuid, user_id uuid, event_title text, slot_label text, starts_at timestamptz)
language sql
security definer
set search_path to 'public'
as $$
  with r as (
    select r.id, r.user_id, e.title, es.label, coalesce(es.starts_at, e.starts_at) as starts_at
    from public.reservations r
    join public.events e on e.id = r.event_id
    left join public.event_slots es on es.id = r.event_slot_id
    where r.status in ('reserved', 'pending') and r.user_id is not null
  )
  select k.kind, r.id, r.user_id, r.title, r.label, r.starts_at
  from r
  cross join lateral (values
    ('reminder_1h', interval '0 minutes', interval '60 minutes'),
    ('reminder_24h', interval '60 minutes', interval '24 hours')
  ) as k(kind, from_offset, to_offset)
  where r.starts_at > now() + k.from_offset
    and r.starts_at <= now() + k.to_offset
    and not exists (select 1 from public.app_push_sent s where s.kind = k.kind and s.ref_id = r.id)
  order by r.starts_at
  limit 500;
$$;

revoke all on function public.app_push_due_new_events() from public, anon, authenticated;
revoke all on function public.app_push_due_reminders() from public, anon, authenticated;
grant execute on function public.app_push_due_new_events() to service_role;
grant execute on function public.app_push_due_reminders() to service_role;
