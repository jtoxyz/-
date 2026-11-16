-- 自分の予約一覧・チケット画面・キャンセル一覧で、選んだ券種（名前と金額）を表示できるようにする。
-- 既存の列はそのままで、末尾に ticket_option_label / ticket_option_price_yen を追加する。
-- 戻り値の列が変わるため、drop してから作り直し、権限を元どおり authenticated のみに付け直す。

begin;

drop function if exists public.get_my_ticket(uuid);
create function public.get_my_ticket(p_reservation_id uuid)
 returns table(reservation_id uuid, student_name text, student_number text, status text, ticket_type text, ticket_code text, public_token text, used_at timestamp with time zone, cancelled_at timestamp with time zone, created_at timestamp with time zone, payment_status text, payment_due_at timestamp with time zone, paid_at timestamp with time zone, event_id uuid, event_title text, event_description text, ticket_enabled boolean, use_button_enabled boolean, ticket_reveal_minutes integer, post_reservation_notes text, is_ticket_use_suspended boolean, auto_suspend_at timestamp with time zone, survey_after_reservation_enabled boolean, survey_after_reservation_url text, survey_after_reservation_message text, survey_after_use_enabled boolean, survey_after_use_url text, survey_after_use_message text, slot_id uuid, slot_label text, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone, use_starts_at timestamp with time zone, use_ends_at timestamp with time zone, ticket_option_label text, ticket_option_price_yen integer)
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  return query
  select r.id,r.student_name,r.student_number,r.status,r.ticket_type,r.ticket_code,r.public_token,r.used_at,
         r.cancelled_at,r.created_at,r.payment_status,r.payment_due_at,r.paid_at,
         e.id,e.title,e.description,e.ticket_enabled,e.use_button_enabled,e.ticket_reveal_minutes,
         e.post_reservation_notes,
         e.is_ticket_use_suspended,e.auto_suspend_at,
         e.survey_after_reservation_enabled,e.survey_after_reservation_url,e.survey_after_reservation_message,
         e.survey_after_use_enabled,e.survey_after_use_url,e.survey_after_use_message,
         es.id,es.label,es.starts_at,es.ends_at,
         case when r.ticket_type='walkin'
           then coalesce(es.walkin_use_starts_at,es.walkin_starts_at,es.ticket_use_starts_at,es.starts_at)
           else coalesce(es.reservation_use_starts_at,es.ticket_use_starts_at,es.starts_at)
         end,
         case when r.ticket_type='walkin'
           then coalesce(es.walkin_use_ends_at,es.walkin_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
           else coalesce(es.reservation_use_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
         end,
         o.label,o.price_yen
  from public.reservations r
  join public.events e on e.id=r.event_id
  left join public.event_slots es on es.id=r.event_slot_id
  left join public.event_ticket_options o on o.id=r.ticket_option_id
  where r.id=p_reservation_id
    and r.user_id=v_uid
    and not public.is_user_blacklisted(r.student_number,r.university_email)
    and (
      case when r.ticket_type='walkin'
        then coalesce(es.walkin_use_ends_at,es.walkin_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
        else coalesce(es.reservation_use_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
      end is null
      or now() <= case when r.ticket_type='walkin'
        then coalesce(es.walkin_use_ends_at,es.walkin_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
        else coalesce(es.reservation_use_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
      end
    );
end $function$;
revoke all on function public.get_my_ticket(uuid) from public, anon;
grant execute on function public.get_my_ticket(uuid) to authenticated, service_role;

drop function if exists public.get_my_tickets();
create function public.get_my_tickets()
 returns table(reservation_id uuid, event_id uuid, event_title text, event_slot_id uuid, slot_label text, student_name text, student_number text, status text, ticket_type text, ticket_code text, public_token text, created_at timestamp with time zone, used_at timestamp with time zone, payment_status text, payment_due_at timestamp with time zone, paid_at timestamp with time zone, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone, slot_ticket_use_starts_at timestamp with time zone, slot_ticket_use_ends_at timestamp with time zone, slot_reservation_use_starts_at timestamp with time zone, slot_reservation_use_ends_at timestamp with time zone, slot_walkin_use_starts_at timestamp with time zone, slot_walkin_use_ends_at timestamp with time zone, ticket_option_label text, ticket_option_price_yen integer)
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  return query
  select r.id,r.event_id,e.title,r.event_slot_id,es.label,r.student_name,r.student_number,r.status,r.ticket_type,
         r.ticket_code,r.public_token,r.created_at,r.used_at,r.payment_status,r.payment_due_at,r.paid_at,
         es.starts_at,es.ends_at,es.ticket_use_starts_at,es.ticket_use_ends_at,
         es.reservation_use_starts_at,es.reservation_use_ends_at,es.walkin_use_starts_at,es.walkin_use_ends_at,
         o.label,o.price_yen
  from public.reservations r
  join public.events e on e.id=r.event_id
  left join public.event_slots es on es.id=r.event_slot_id
  left join public.event_ticket_options o on o.id=r.ticket_option_id
  where r.user_id=v_uid
    and r.status<>'cancelled'
    and not public.is_user_blacklisted(r.student_number,r.university_email)
    and (
      case when r.ticket_type='walkin'
        then coalesce(es.walkin_use_ends_at,es.walkin_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
        else coalesce(es.reservation_use_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
      end is null
      or now() <= case when r.ticket_type='walkin'
        then coalesce(es.walkin_use_ends_at,es.walkin_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
        else coalesce(es.reservation_use_ends_at,es.ticket_use_ends_at,e.use_ends_at,es.ends_at)
      end
    )
  order by r.created_at desc;
end $function$;
revoke all on function public.get_my_tickets() from public, anon;
grant execute on function public.get_my_tickets() to authenticated, service_role;

drop function if exists public.get_my_cancelled_tickets();
create function public.get_my_cancelled_tickets()
 returns table(reservation_id uuid, event_title text, slot_label text, slot_starts_at timestamp with time zone, ticket_type text, payment_status text, cancelled_at timestamp with time zone, ticket_option_label text, ticket_option_price_yen integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select r.id, e.title, es.label, es.starts_at, r.ticket_type, r.payment_status, r.cancelled_at, o.label, o.price_yen
    from public.reservations r
    join public.events e on e.id = r.event_id
    left join public.event_slots es on es.id = r.event_slot_id
    left join public.event_ticket_options o on o.id = r.ticket_option_id
   where r.user_id = auth.uid()
     and r.status = 'cancelled'
     and coalesce(r.cancelled_at, r.created_at) > now() - interval '30 days'
   order by r.cancelled_at desc nulls last
   limit 20;
$function$;
revoke all on function public.get_my_cancelled_tickets() from public, anon;
grant execute on function public.get_my_cancelled_tickets() to authenticated, service_role;

commit;
