-- 支払い期限の猶予（標準機能）
-- 来室枠の終了間際に来る人がいるため、表示している支払い期限（payment_due_at）より
-- 5分遅れて自動キャンセルする。表示上の期限は変えない。
-- 今後追加する受付枠・企画もすべてこの猶予が自動で適用される。

create or replace function public.payment_due_grace()
returns interval
language sql
immutable
set search_path to 'public'
as $$ select interval '5 minutes' $$;

revoke all on function public.payment_due_grace() from public, anon;
grant execute on function public.payment_due_grace() to authenticated, service_role;

create or replace function public.expire_unpaid_reservations()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    and payment_due_at + public.payment_due_grace() <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
