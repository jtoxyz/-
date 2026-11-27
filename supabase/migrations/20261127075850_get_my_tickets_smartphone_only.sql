-- 自分の予約一覧でも、企画がスマホ限定かどうかを返す（支払い受付用QRをPCで出さないため）
drop function if exists public.get_my_tickets();

create function public.get_my_tickets()
 returns table(reservation_id uuid, event_id uuid, event_title text, event_slot_id uuid, slot_label text, student_name text, student_number text, status text, ticket_type text, ticket_code text, public_token text, created_at timestamp with time zone, used_at timestamp with time zone, payment_status text, payment_due_at timestamp with time zone, paid_at timestamp with time zone, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone, slot_ticket_use_starts_at timestamp with time zone, slot_ticket_use_ends_at timestamp with time zone, slot_reservation_use_starts_at timestamp with time zone, slot_reservation_use_ends_at timestamp with time zone, slot_walkin_use_starts_at timestamp with time zone, slot_walkin_use_ends_at timestamp with time zone, ticket_option_label text, ticket_option_price_yen integer, smartphone_only_ticket boolean)
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
         o.label,o.price_yen,
         e.smartphone_only_ticket
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
