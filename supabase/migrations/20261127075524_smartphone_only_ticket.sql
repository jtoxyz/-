-- 受付・受取（チケットの表示と「使用する」）をスマホだけに限る設定。企画ごとに切り替える。
-- 新しい企画は最初から有効。マグロ企画はすでにPCで受付に使った人がいるため除外する。
alter table public.events
  add column if not exists smartphone_only_ticket boolean not null default true;

comment on column public.events.smartphone_only_ticket is
  'true のとき、一般の学生はPCではチケットを表示・使用できない（スマホ・タブレットのみ）。判定は画面側で行う。';

update public.events set smartphone_only_ticket = false where title like '%マグロ%';

-- get_my_ticket の戻り値に smartphone_only_ticket を足す（戻り値の型が変わるため作り直す）
drop function if exists public.get_my_ticket(uuid);

create function public.get_my_ticket(p_reservation_id uuid)
 returns table(reservation_id uuid, student_name text, student_number text, status text, ticket_type text, ticket_code text, public_token text, used_at timestamp with time zone, cancelled_at timestamp with time zone, created_at timestamp with time zone, payment_status text, payment_due_at timestamp with time zone, paid_at timestamp with time zone, event_id uuid, event_title text, event_description text, ticket_enabled boolean, use_button_enabled boolean, ticket_reveal_minutes integer, post_reservation_notes text, is_ticket_use_suspended boolean, auto_suspend_at timestamp with time zone, survey_after_reservation_enabled boolean, survey_after_reservation_url text, survey_after_reservation_message text, survey_after_use_enabled boolean, survey_after_use_url text, survey_after_use_message text, slot_id uuid, slot_label text, slot_starts_at timestamp with time zone, slot_ends_at timestamp with time zone, use_starts_at timestamp with time zone, use_ends_at timestamp with time zone, ticket_option_label text, ticket_option_price_yen integer, smartphone_only_ticket boolean)
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
         o.label,o.price_yen,
         e.smartphone_only_ticket
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
