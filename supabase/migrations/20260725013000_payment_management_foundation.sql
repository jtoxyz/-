create extension if not exists pg_cron with schema extensions;

alter table public.events
  add column if not exists payment_required boolean not null default false,
  add column if not exists payment_deadline_minutes integer not null default 30;

alter table public.events
  drop constraint if exists events_payment_deadline_minutes_check;
alter table public.events
  add constraint events_payment_deadline_minutes_check
  check (payment_deadline_minutes between 1 and 10080);

alter table public.reservations
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists payment_due_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_confirmed_by uuid references auth.users(id) on delete set null;

alter table public.reservations
  drop constraint if exists reservations_payment_status_check;
alter table public.reservations
  add constraint reservations_payment_status_check
  check (payment_status in ('not_required','pending','paid','expired'));

update public.reservations
set payment_status = 'not_required', payment_due_at = null
where payment_status is null;

create or replace function public.set_reservation_payment_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_required boolean;
  v_deadline_minutes integer;
begin
  select coalesce(payment_required, false), coalesce(payment_deadline_minutes, 30)
    into v_payment_required, v_deadline_minutes
  from public.events
  where id = new.event_id;

  if v_payment_required then
    new.payment_status := 'pending';
    new.payment_due_at := coalesce(new.payment_due_at, now() + make_interval(mins => v_deadline_minutes));
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

revoke all on function public.set_reservation_payment_defaults() from public, anon, authenticated;

drop trigger if exists reservations_set_payment_defaults on public.reservations;
create trigger reservations_set_payment_defaults
before insert on public.reservations
for each row execute function public.set_reservation_payment_defaults();

create or replace function public.expire_unpaid_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.reservations
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      payment_status = 'expired'
  where status = 'reserved'
    and payment_status = 'pending'
    and payment_due_at is not null
    and payment_due_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_unpaid_reservations() from public, anon, authenticated;

create or replace function public.admin_set_reservation_payment_status(
  p_reservation_id uuid,
  p_paid boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception '管理者権限が必要です。';
  end if;

  if p_paid then
    update public.reservations
    set payment_status = 'paid',
        paid_at = now(),
        payment_confirmed_by = auth.uid()
    where id = p_reservation_id
      and status <> 'cancelled';
  else
    update public.reservations
    set payment_status = case
          when payment_due_at is not null and payment_due_at <= now() then 'expired'
          else 'pending'
        end,
        paid_at = null,
        payment_confirmed_by = null
    where id = p_reservation_id
      and payment_status <> 'not_required';
  end if;

  if not found then
    raise exception '対象の予約を更新できませんでした。';
  end if;
end;
$$;

grant execute on function public.admin_set_reservation_payment_status(uuid, boolean) to authenticated;
revoke execute on function public.admin_set_reservation_payment_status(uuid, boolean) from anon;

create or replace function public.admin_expire_unpaid_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception '管理者権限が必要です。';
  end if;
  return public.expire_unpaid_reservations();
end;
$$;

grant execute on function public.admin_expire_unpaid_reservations() to authenticated;
revoke execute on function public.admin_expire_unpaid_reservations() from anon;

select cron.unschedule(jobid)
from cron.job
where jobname = 'expire-unpaid-reservations';

select cron.schedule(
  'expire-unpaid-reservations',
  '* * * * *',
  'select public.expire_unpaid_reservations();'
);

notify pgrst, 'reload schema';
