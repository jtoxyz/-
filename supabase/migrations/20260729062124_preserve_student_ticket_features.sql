begin;

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
end $$;

revoke all on function public.get_my_ticket(uuid) from public,anon,authenticated;
drop function public.get_my_ticket(uuid);

create function public.get_my_ticket(p_reservation_id uuid)
returns table(
  reservation_id uuid,student_name text,student_number text,status text,ticket_type text,ticket_code text,
  public_token text,used_at timestamptz,cancelled_at timestamptz,created_at timestamptz,
  payment_status text,payment_due_at timestamptz,paid_at timestamptz,
  event_id uuid,event_title text,event_description text,ticket_enabled boolean,use_button_enabled boolean,
  post_reservation_notes text,is_ticket_use_suspended boolean,auto_suspend_at timestamptz,
  survey_after_reservation_enabled boolean,survey_after_reservation_url text,survey_after_reservation_message text,
  survey_after_use_enabled boolean,survey_after_use_url text,survey_after_use_message text,
  slot_id uuid,slot_label text,slot_starts_at timestamptz,slot_ends_at timestamptz,
  use_starts_at timestamptz,use_ends_at timestamptz
)
language plpgsql security definer set search_path=public,auth as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  return query
  select r.id,r.student_name,r.student_number,r.status,r.ticket_type,r.ticket_code,r.public_token,r.used_at,
         r.cancelled_at,r.created_at,r.payment_status,r.payment_due_at,r.paid_at,
         e.id,e.title,e.description,e.ticket_enabled,e.use_button_enabled,e.post_reservation_notes,
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
         end
  from public.reservations r
  join public.events e on e.id=r.event_id
  left join public.event_slots es on es.id=r.event_slot_id
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
end $$;

grant execute on function public.get_my_ticket(uuid) to authenticated;
revoke all on function public.get_my_tickets() from public,anon;
grant execute on function public.get_my_tickets() to authenticated;
notify pgrst,'reload schema';
commit;
