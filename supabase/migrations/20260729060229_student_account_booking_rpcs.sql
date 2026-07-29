begin;

create or replace function public.create_my_reservation(p_event_id uuid,p_event_slot_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid(); v_profile public.user_profiles%rowtype; v_result jsonb;
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  select * into v_profile from public.user_profiles where user_id=v_uid;
  if not found then raise exception '初回アカウント登録を完了してください。'; end if;
  v_result:=public.create_reservation(p_event_id,p_event_slot_id,v_profile.student_name,v_profile.student_number,v_profile.university_email,null);
  update public.reservations set user_id=v_uid where id=(v_result->>'id')::uuid;
  return v_result;
end $$;

create or replace function public.create_my_reservations_bulk(p_event_id uuid,p_event_slot_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid(); v_profile public.user_profiles%rowtype; v_result json;
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  select * into v_profile from public.user_profiles where user_id=v_uid;
  if not found then raise exception '初回アカウント登録を完了してください。'; end if;
  v_result:=public.create_reservations_bulk(p_event_id,p_event_slot_ids,v_profile.student_name,v_profile.student_number,v_profile.university_email);
  update public.reservations r set user_id=v_uid
  where r.id in(select (item->>'id')::uuid from json_array_elements(v_result) item);
  return v_result::jsonb;
end $$;

create or replace function public.create_my_walkin_reservation(p_event_id uuid,p_event_slot_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid(); v_profile public.user_profiles%rowtype; v_result jsonb;
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  select * into v_profile from public.user_profiles where user_id=v_uid;
  if not found then raise exception '初回アカウント登録を完了してください。'; end if;
  v_result:=public.create_walkin_reservation(p_event_id,p_event_slot_id,v_profile.student_name,v_profile.student_number,v_profile.university_email,null);
  update public.reservations set user_id=v_uid where id=(v_result->>'id')::uuid;
  return v_result;
end $$;

create or replace function public.get_my_tickets()
returns table(
  reservation_id uuid,event_id uuid,event_title text,event_slot_id uuid,slot_label text,
  student_name text,student_number text,status text,ticket_type text,ticket_code text,public_token text,
  created_at timestamptz,used_at timestamptz,payment_status text,payment_due_at timestamptz,paid_at timestamptz,
  slot_starts_at timestamptz,slot_ends_at timestamptz,
  slot_ticket_use_starts_at timestamptz,slot_ticket_use_ends_at timestamptz,
  slot_reservation_use_starts_at timestamptz,slot_reservation_use_ends_at timestamptz,
  slot_walkin_use_starts_at timestamptz,slot_walkin_use_ends_at timestamptz
)
language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  return query
  select r.id,r.event_id,e.title,r.event_slot_id,es.label,r.student_name,r.student_number,r.status,r.ticket_type,
         r.ticket_code,r.public_token,r.created_at,r.used_at,r.payment_status,r.payment_due_at,r.paid_at,
         es.starts_at,es.ends_at,es.ticket_use_starts_at,es.ticket_use_ends_at,
         es.reservation_use_starts_at,es.reservation_use_ends_at,es.walkin_use_starts_at,es.walkin_use_ends_at
  from public.reservations r
  join public.events e on e.id=r.event_id
  left join public.event_slots es on es.id=r.event_slot_id
  where r.user_id=v_uid and r.status<>'cancelled'
  order by r.created_at desc;
end $$;

create or replace function public.get_my_ticket(p_reservation_id uuid)
returns table(
  reservation_id uuid,student_name text,student_number text,status text,ticket_type text,ticket_code text,
  public_token text,used_at timestamptz,cancelled_at timestamptz,created_at timestamptz,
  payment_status text,payment_due_at timestamptz,paid_at timestamptz,
  event_id uuid,event_title text,event_description text,ticket_enabled boolean,use_button_enabled boolean,
  post_reservation_notes text,is_ticket_use_suspended boolean,auto_suspend_at timestamptz,
  slot_id uuid,slot_label text,slot_starts_at timestamptz,slot_ends_at timestamptz,
  use_starts_at timestamptz,use_ends_at timestamptz
)
language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  return query
  select r.id,r.student_name,r.student_number,r.status,r.ticket_type,r.ticket_code,r.public_token,r.used_at,
         r.cancelled_at,r.created_at,r.payment_status,r.payment_due_at,r.paid_at,e.id,e.title,e.description,
         e.ticket_enabled,e.use_button_enabled,e.post_reservation_notes,e.is_ticket_use_suspended,e.auto_suspend_at,
         es.id,es.label,es.starts_at,es.ends_at,
         case when r.ticket_type='walkin'
           then coalesce(es.walkin_use_starts_at,es.walkin_starts_at,es.ticket_use_starts_at,es.starts_at)
           else coalesce(es.reservation_use_starts_at,es.ticket_use_starts_at,es.starts_at)
         end,
         case when r.ticket_type='walkin'
           then coalesce(es.walkin_use_ends_at,es.walkin_ends_at,es.ticket_use_ends_at,es.ends_at)
           else coalesce(es.reservation_use_ends_at,es.ticket_use_ends_at,es.ends_at)
         end
  from public.reservations r
  join public.events e on e.id=r.event_id
  left join public.event_slots es on es.id=r.event_slot_id
  where r.id=p_reservation_id and r.user_id=v_uid;
end $$;

create or replace function public.use_my_ticket(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid(); v_token text; v_result json;
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  select r.public_token into v_token from public.reservations r
  where r.id=p_reservation_id and r.user_id=v_uid;
  if v_token is null then raise exception 'チケットが見つかりません。'; end if;
  v_result:=public.use_ticket(v_token);
  return v_result::jsonb;
end $$;

revoke all on function public.create_my_reservation(uuid,uuid) from public,anon;
revoke all on function public.create_my_reservations_bulk(uuid,uuid[]) from public,anon;
revoke all on function public.create_my_walkin_reservation(uuid,uuid) from public,anon;
revoke all on function public.get_my_tickets() from public,anon;
revoke all on function public.get_my_ticket(uuid) from public,anon;
revoke all on function public.use_my_ticket(uuid) from public,anon;
grant execute on function public.create_my_reservation(uuid,uuid) to authenticated;
grant execute on function public.create_my_reservations_bulk(uuid,uuid[]) to authenticated;
grant execute on function public.create_my_walkin_reservation(uuid,uuid) to authenticated;
grant execute on function public.get_my_tickets() to authenticated;
grant execute on function public.get_my_ticket(uuid) to authenticated;
grant execute on function public.use_my_ticket(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
