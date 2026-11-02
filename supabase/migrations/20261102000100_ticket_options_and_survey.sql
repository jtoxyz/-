-- 券種（アンケートに答えたら100円 / 答えなければ500円 など）と、予約サイト内アンケート。
--
-- 考え方
--   * 1日の枠（event_slots）の総定員は今までどおり。券種はその定員を共有する。
--     例: 1日250食の枠に「アンケート回答 100円」「通常 500円」を用意しても、合計は250食まで。
--   * 券種は企画ごとに定義し、その企画のすべての枠で選べる。
--     per_slot_limit を入れると「1枠あたりこの券種は最大N食」に絞れる（空欄なら総定員の範囲内で自由）。
--   * アンケートの設問は events.survey_config に持つ。回答は予約（reservations.survey_answers）に保存する。
--   * 券種がある企画では、予約時に券種を必須にする。DB側（トリガー）でも強制する。
begin;

-- 1. 企画のアンケート設定
alter table public.events
  add column if not exists survey_config jsonb;

-- 2. 券種
create table if not exists public.event_ticket_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 60),
  description text,
  price_yen integer not null default 0 check (price_yen >= 0),
  requires_survey boolean not null default false,
  per_slot_limit integer check (per_slot_limit is null or per_slot_limit >= 0),
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_event_ticket_options_event_id on public.event_ticket_options(event_id);

alter table public.event_ticket_options enable row level security;

drop policy if exists event_ticket_options_admin_all on public.event_ticket_options;
create policy event_ticket_options_admin_all on public.event_ticket_options
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists event_ticket_options_public_read on public.event_ticket_options;
create policy event_ticket_options_public_read on public.event_ticket_options
  for select to authenticated
  using (is_enabled and exists (select 1 from public.events e where e.id = event_ticket_options.event_id and e.is_public));

-- 3. 予約に券種とアンケート回答を持たせる
alter table public.reservations
  add column if not exists ticket_option_id uuid references public.event_ticket_options(id) on delete restrict,
  add column if not exists survey_answers jsonb;
create index if not exists idx_reservations_ticket_option_id on public.reservations(ticket_option_id);

-- 4. アンケート回答の検証。正規化した回答（設問idをキーにしたjsonb）を返す。
--    設問: [{"id":"q1","text":"...","type":"text|single|multiple|rating","options":["A","B"],"required":true}]
create or replace function public.validate_survey_answers(p_config jsonb, p_answers jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_q jsonb; v_id text; v_type text; v_val jsonb; v_out jsonb := '{}'::jsonb; v_item jsonb; v_num numeric;
  v_required boolean; v_text text;
begin
  if p_config is null or jsonb_typeof(p_config->'questions') <> 'array' then
    return v_out;
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    p_answers := '{}'::jsonb;
  end if;

  for v_q in select * from jsonb_array_elements(p_config->'questions') loop
    v_id := v_q->>'id';
    v_type := coalesce(v_q->>'type', 'text');
    v_required := coalesce((v_q->>'required')::boolean, false);
    v_val := p_answers->v_id;
    v_text := coalesce(v_q->>'text', '設問');

    if v_val is null or v_val = 'null'::jsonb
       or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '')
       or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0) then
      if v_required then
        raise exception 'アンケートの「%」に回答してください。', v_text;
      end if;
      continue;
    end if;

    if v_type = 'text' then
      if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 1000 then
        raise exception 'アンケートの「%」は1000文字以内の文章で回答してください。', v_text;
      end if;
      v_out := v_out || jsonb_build_object(v_id, btrim(v_val #>> '{}'));
    elsif v_type = 'single' then
      if jsonb_typeof(v_val) <> 'string' or not (v_q->'options') @> to_jsonb(v_val #>> '{}') then
        raise exception 'アンケートの「%」は選択肢から選んでください。', v_text;
      end if;
      v_out := v_out || jsonb_build_object(v_id, v_val);
    elsif v_type = 'multiple' then
      if jsonb_typeof(v_val) <> 'array' then
        raise exception 'アンケートの「%」は選択肢から選んでください。', v_text;
      end if;
      for v_item in select * from jsonb_array_elements(v_val) loop
        if jsonb_typeof(v_item) <> 'string' or not (v_q->'options') @> to_jsonb(v_item #>> '{}') then
          raise exception 'アンケートの「%」は選択肢から選んでください。', v_text;
        end if;
      end loop;
      v_out := v_out || jsonb_build_object(v_id, v_val);
    elsif v_type = 'rating' then
      begin
        v_num := (v_val #>> '{}')::numeric;
      exception when others then
        raise exception 'アンケートの「%」は1〜5で回答してください。', v_text;
      end;
      if v_num < 1 or v_num > 5 or v_num <> trunc(v_num) then
        raise exception 'アンケートの「%」は1〜5で回答してください。', v_text;
      end if;
      v_out := v_out || jsonb_build_object(v_id, v_num::int);
    end if;
  end loop;

  return v_out;
end $$;

revoke all on function public.validate_survey_answers(jsonb, jsonb) from public, anon;
grant execute on function public.validate_survey_answers(jsonb, jsonb) to authenticated;

-- 5. 券種ごとの使用数を返す（券種 × 枠）。
create or replace function public.get_event_ticket_options(p_event_id uuid)
returns table (
  id uuid, label text, description text, price_yen integer, requires_survey boolean,
  sort_order integer, event_slot_id uuid, per_slot_limit integer, used_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.label, o.description, o.price_yen, o.requires_survey, o.sort_order,
         s.id, o.per_slot_limit,
         (select count(*) from public.reservations r
           where r.event_slot_id = s.id and r.ticket_option_id = o.id and r.status in ('reserved','used'))
  from public.event_ticket_options o
  join public.events e on e.id = o.event_id and e.is_public
  join public.event_slots s on s.event_id = o.event_id
  where o.event_id = p_event_id and o.is_enabled
  order by o.sort_order, o.created_at, s.sort_order;
$$;

revoke all on function public.get_event_ticket_options(uuid) from public, anon;
grant execute on function public.get_event_ticket_options(uuid) to authenticated;

-- 6. 予約INSERT時に券種・回答を反映し、券種のある企画では券種なしの予約を拒否する。
--    学生向けRPCは set_config で券種と回答を渡す。管理者の直接追加は券種なしでも通す。
create or replace function public.apply_reservation_ticket_option()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option_id uuid := nullif(current_setting('app.ticket_option_id', true), '')::uuid;
  v_answers text := nullif(current_setting('app.survey_answers', true), '');
begin
  if v_option_id is not null then
    new.ticket_option_id := v_option_id;
    if v_answers is not null then new.survey_answers := v_answers::jsonb; end if;
    return new;
  end if;

  if new.ticket_type = 'reservation' and new.ticket_option_id is null
     and exists (select 1 from public.event_ticket_options o where o.event_id = new.event_id and o.is_enabled)
     and not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception 'この企画は券種を選んで予約してください。';
  end if;
  return new;
end $$;

drop trigger if exists trg_apply_reservation_ticket_option on public.reservations;
create trigger trg_apply_reservation_ticket_option
  before insert on public.reservations
  for each row execute function public.apply_reservation_ticket_option();

-- 7. 学生向け予約RPC（オーバーロードは1個だけにする）
drop function if exists public.create_my_reservation(uuid, uuid, uuid);
create function public.create_my_reservation(
  p_event_id uuid,
  p_event_slot_id uuid,
  p_payment_visit_slot_id uuid default null,
  p_ticket_option_id uuid default null,
  p_survey_answers jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.user_profiles%rowtype;
  v_visit public.payment_visit_slots%rowtype;
  v_event public.events%rowtype;
  v_option public.event_ticket_options%rowtype;
  v_has_options boolean;
  v_answers jsonb := '{}'::jsonb;
  v_used bigint;
  v_result jsonb;
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  select * into v_profile from public.user_profiles where user_id = v_uid;
  if not found then raise exception '初回アカウント登録を完了してください。'; end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception '企画が見つかりません。'; end if;
  select exists (select 1 from public.event_ticket_options o where o.event_id = p_event_id and o.is_enabled) into v_has_options;

  if v_has_options then
    if p_ticket_option_id is null then raise exception '券種を選んでください。'; end if;
    -- 同じ券種への同時予約を直列化して、券種ごとの上限を超えないようにする
    select * into v_option from public.event_ticket_options
     where id = p_ticket_option_id and event_id = p_event_id and is_enabled for update;
    if not found then raise exception '選んだ券種は利用できません。'; end if;

    if v_option.per_slot_limit is not null then
      select count(*) into v_used from public.reservations r
       where r.event_slot_id = p_event_slot_id and r.ticket_option_id = v_option.id and r.status in ('reserved','used');
      if v_used >= v_option.per_slot_limit then
        raise exception '「%」はこの枠では満席です。', v_option.label;
      end if;
    end if;

    if v_option.requires_survey then
      if v_event.survey_config is null or jsonb_typeof(v_event.survey_config->'questions') <> 'array'
         or jsonb_array_length(v_event.survey_config->'questions') = 0 then
        raise exception 'アンケートが設定されていないため、この券種は利用できません。';
      end if;
      v_answers := public.validate_survey_answers(v_event.survey_config, p_survey_answers);
      if v_answers = '{}'::jsonb then
        raise exception 'この券種はアンケートへの回答が必要です。';
      end if;
    end if;
  elsif p_ticket_option_id is not null then
    raise exception 'この企画に券種はありません。';
  end if;

  v_visit := public.resolve_payment_visit_slot(p_event_id, p_payment_visit_slot_id);

  if v_has_options then
    perform set_config('app.ticket_option_id', v_option.id::text, true);
    perform set_config('app.survey_answers', case when v_option.requires_survey then v_answers::text else '' end, true);
  end if;

  v_result := public.create_reservation(p_event_id, p_event_slot_id, v_profile.student_name, v_profile.student_number, v_profile.university_email, null);

  perform set_config('app.ticket_option_id', '', true);
  perform set_config('app.survey_answers', '', true);

  update public.reservations set user_id = v_uid where id = (v_result->>'id')::uuid;
  if v_visit.id is not null then
    update public.reservations
       set payment_visit_slot_id = v_visit.id, payment_due_at = v_visit.ends_at
     where id = (v_result->>'id')::uuid and payment_status = 'pending';
  end if;
  return v_result;
end $$;

revoke all on function public.create_my_reservation(uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_my_reservation(uuid, uuid, uuid, uuid, jsonb) to authenticated;

-- 8. 複数枠の一括予約は、券種のある企画では使えない（券種とアンケートを1枠ずつ選ぶため）
create or replace function public.create_my_reservations_bulk(
  p_event_id uuid,
  p_event_slot_ids uuid[],
  p_payment_visit_slot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_uid uuid:=auth.uid(); v_profile public.user_profiles%rowtype; v_visit public.payment_visit_slots%rowtype; v_result json;
begin
 if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
 if exists (select 1 from public.event_ticket_options o where o.event_id = p_event_id and o.is_enabled) then
   raise exception 'この企画は券種を選ぶため、1枠ずつ予約してください。';
 end if;
 select * into v_profile from public.user_profiles where user_id=v_uid;
 if not found then raise exception '初回アカウント登録を完了してください。'; end if;
 v_visit:=public.resolve_payment_visit_slot(p_event_id,p_payment_visit_slot_id);
 v_result:=public.create_reservations_bulk(p_event_id,p_event_slot_ids,v_profile.student_name,v_profile.student_number,v_profile.university_email);
 update public.reservations r set user_id=v_uid where r.id in(select (item->>'id')::uuid from json_array_elements(v_result) item);
 if v_visit.id is not null then
   update public.reservations r
   set payment_visit_slot_id=v_visit.id, payment_due_at=v_visit.ends_at
   where r.id in(select (item->>'id')::uuid from json_array_elements(v_result) item) and r.payment_status='pending';
 end if;
 return v_result::jsonb;
end $$;

revoke all on function public.create_my_reservations_bulk(uuid, uuid[], uuid) from public, anon;
grant execute on function public.create_my_reservations_bulk(uuid, uuid[], uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
