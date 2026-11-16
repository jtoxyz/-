-- 20261116000200 の修正。
-- 作ったのと同じ時刻に作り直すと valid_until = valid_from になり、
-- 制約 payment_qr_valid_window（valid_until > valid_from）に違反していた。
-- 期限は「今」と「開始時刻の直後」の遅いほうにする（どちらにしても次の取得からは期限切れ扱い）。

create or replace function public.staff_reissue_lane_payment_qr(p_event_id uuid, p_lane text)
returns table(qr_id uuid, qr_token text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_qr public.payment_qr_codes%rowtype;
begin
  if not public.can_operate_event(p_event_id) then
    raise exception 'この企画を操作する権限がありません。';
  end if;
  if p_lane is null or char_length(p_lane) not between 8 and 64 then
    raise exception '端末IDが不正です。';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and coalesce(e.payment_required, false)) then
    raise exception '支払い必須の企画が見つかりません。';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment_qr_lane:' || p_event_id::text || ':' || p_lane, 0));

  update public.payment_qr_codes q
     set valid_until = greatest(now(), q.valid_from + interval '1 microsecond')
   where q.event_id = p_event_id
     and q.mode = 'dynamic'
     and q.lane = p_lane
     and q.claimed_at is null
     and q.consumed_at is null
     and q.valid_until > now();

  insert into public.payment_qr_codes(
    event_id, mode, token, valid_date, valid_from, valid_until, is_active, created_by, lane
  ) values (
    p_event_id, 'dynamic', encode(gen_random_bytes(24), 'hex'), null, now(), 'infinity'::timestamptz, false, auth.uid(), p_lane
  ) returning * into v_qr;

  return query select v_qr.id, v_qr.token, v_qr.created_at;
end $$;

revoke all on function public.staff_reissue_lane_payment_qr(uuid, text) from public, anon;
grant execute on function public.staff_reissue_lane_payment_qr(uuid, text) to authenticated;

notify pgrst, 'reload schema';
