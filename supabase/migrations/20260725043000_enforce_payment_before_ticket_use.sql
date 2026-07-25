create or replace function public.enforce_payment_before_ticket_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'used' and old.status is distinct from 'used' then
    if coalesce(new.payment_status, 'not_required') in ('pending','expired') then
      raise exception '支払いが確認できていないため、このチケットは使用できません。';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_payment_before_ticket_use() from public, anon, authenticated;

drop trigger if exists reservations_enforce_payment_before_use on public.reservations;
create trigger reservations_enforce_payment_before_use
before update of status on public.reservations
for each row
execute function public.enforce_payment_before_ticket_use();

notify pgrst, 'reload schema';