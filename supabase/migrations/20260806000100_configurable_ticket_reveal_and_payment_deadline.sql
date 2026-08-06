begin;

-- 1. Per-event configurable "how long the ticket code stays visible after use" window.
alter table public.events
  add column if not exists ticket_reveal_minutes integer not null default 5;

alter table public.events
  drop constraint if exists events_ticket_reveal_minutes_check;
alter table public.events
  add constraint events_ticket_reveal_minutes_check check (ticket_reveal_minutes between 1 and 60);

-- 2. Per-event payment deadline mode: relative (X minutes after reservation, existing
--    behavior) or absolute (a fixed date/time shared by every reservation for that event).
alter table public.events
  add column if not exists payment_deadline_mode text not null default 'relative',
  add column if not exists payment_due_fixed_at timestamptz;

alter table public.events
  drop constraint if exists events_payment_deadline_mode_check;
alter table public.events
  add constraint events_payment_deadline_mode_check check (payment_deadline_mode in ('relative', 'absolute'));

create or replace function public.set_reservation_payment_defaults()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_payment_required boolean;
  v_deadline_minutes integer;
  v_deadline_mode text;
  v_fixed_due_at timestamptz;
begin
  select coalesce(payment_required, false), coalesce(payment_deadline_minutes, 30),
         coalesce(payment_deadline_mode, 'relative'), payment_due_fixed_at
    into v_payment_required, v_deadline_minutes, v_deadline_mode, v_fixed_due_at
  from public.events
  where id = new.event_id;

  if v_payment_required then
    new.payment_status := 'pending';
    if v_deadline_mode = 'absolute' and v_fixed_due_at is not null then
      new.payment_due_at := coalesce(new.payment_due_at, v_fixed_due_at);
    else
      new.payment_due_at := coalesce(new.payment_due_at, now() + make_interval(mins => v_deadline_minutes));
    end if;
    new.paid_at := null;
    new.payment_confirmed_by := null;
  else
    new.payment_status := 'not_required';
    new.payment_due_at := null;
    new.paid_at := null;
    new.payment_confirmed_by := null;
  end if;

  return new;
end;
$$;

-- 3. Surface ticket_reveal_minutes through the ticket-reading RPCs. Both changed their
--    RETURNS TABLE shape, which Postgres does not allow via CREATE OR REPLACE, so drop first.

revoke all on function public.get_ticket(text) from public, anon, authenticated;
drop function public.get_ticket(text);

create function public.get_ticket(p_public_token text)
returns table(
  reservation_id uuid, student_name text, student_number text, status text, ticket_type text,
  ticket_code text, public_token text, used_at timestamptz, cancelled_at timestamptz, created_at timestamptz,
  event_id uuid, event_title text, event_description text, event_starts_at timestamptz, event_ends_at timestamptz,
  use_starts_at timestamptz, use_ends_at timestamptz, ticket_enabled boolean, use_button_enabled boolean,
  ticket_reveal_minutes integer,
  survey_after_reservation_enabled boolean, survey_after_reservation_url text, survey_after_reservation_message text,
  survey_after_use_enabled boolean, survey_after_use_url text, survey_after_use_message text,
  post_reservation_notes text, is_ticket_use_suspended boolean, auto_suspend_at timestamptz,
  slot_id uuid, slot_label text, slot_starts_at timestamptz, slot_ends_at timestamptz,
  slot_reservation_starts_at timestamptz, slot_reservation_ends_at timestamptz,
  slot_ticket_use_starts_at timestamptz, slot_ticket_use_ends_at timestamptz,
  slot_walkin_starts_at timestamptz, slot_walkin_ends_at timestamptz,
  slot_is_reservation_enabled boolean, slot_is_ticket_use_enabled boolean, slot_is_walkin_enabled boolean,
  slot_reservation_use_starts_at timestamptz, slot_reservation_use_ends_at timestamptz,
  slot_walkin_use_starts_at timestamptz, slot_walkin_use_ends_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event_id uuid;
begin
  select r.event_id
  into v_event_id
  from public.reservations r
  where r.public_token = p_public_token;

  if v_event_id is not null then
    perform public.admin_auto_activate_pre_registrations(v_event_id);
  end if;

  return query
  select
    r.id, r.student_name, r.student_number, r.status, r.ticket_type, r.ticket_code, r.public_token,
    r.used_at, r.cancelled_at, r.created_at,
    e.id, e.title, e.description, e.starts_at, e.ends_at, e.use_starts_at, e.use_ends_at,
    e.ticket_enabled, e.use_button_enabled, e.ticket_reveal_minutes,
    e.survey_after_reservation_enabled, e.survey_after_reservation_url, e.survey_after_reservation_message,
    e.survey_after_use_enabled, e.survey_after_use_url, e.survey_after_use_message,
    e.post_reservation_notes, e.is_ticket_use_suspended, e.auto_suspend_at,
    es.id, es.label, es.starts_at, es.ends_at,
    es.reservation_starts_at, es.reservation_ends_at, es.ticket_use_starts_at, es.ticket_use_ends_at,
    es.walkin_starts_at, es.walkin_ends_at,
    es.is_reservation_enabled, es.is_ticket_use_enabled, es.is_walkin_enabled,
    es.reservation_use_starts_at, es.reservation_use_ends_at, es.walkin_use_starts_at, es.walkin_use_ends_at
  from public.reservations r
  join public.events e on e.id = r.event_id
  left join public.event_slots es on es.id = r.event_slot_id
  where r.public_token = p_public_token
    and not public.is_user_blacklisted(r.student_number, r.university_email)
    and (
      case when r.ticket_type = 'walkin'
        then coalesce(es.walkin_use_ends_at, es.walkin_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
        else coalesce(es.reservation_use_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
      end is null
      or now() <= case when r.ticket_type = 'walkin'
        then coalesce(es.walkin_use_ends_at, es.walkin_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
        else coalesce(es.reservation_use_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
      end
    );
end;
$$;

grant execute on function public.get_ticket(text) to anon, authenticated;

revoke all on function public.get_my_ticket(uuid) from public, anon, authenticated;
drop function public.get_my_ticket(uuid);

create function public.get_my_ticket(p_reservation_id uuid)
returns table(
  reservation_id uuid, student_name text, student_number text, status text, ticket_type text, ticket_code text,
  public_token text, used_at timestamptz, cancelled_at timestamptz, created_at timestamptz,
  payment_status text, payment_due_at timestamptz, paid_at timestamptz,
  event_id uuid, event_title text, event_description text, ticket_enabled boolean, use_button_enabled boolean,
  ticket_reveal_minutes integer,
  post_reservation_notes text, is_ticket_use_suspended boolean, auto_suspend_at timestamptz,
  survey_after_reservation_enabled boolean, survey_after_reservation_url text, survey_after_reservation_message text,
  survey_after_use_enabled boolean, survey_after_use_url text, survey_after_use_message text,
  slot_id uuid, slot_label text, slot_starts_at timestamptz, slot_ends_at timestamptz,
  use_starts_at timestamptz, use_ends_at timestamptz
)
language plpgsql security definer set search_path=public,auth as $$
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

grant execute on function public.get_my_ticket(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
