create or replace function public.get_ticket_payment_state(p_public_token text)
returns table (
  payment_required boolean,
  payment_status text,
  payment_due_at timestamptz,
  paid_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.payment_required,
    r.payment_status,
    r.payment_due_at,
    r.paid_at
  from public.reservations r
  join public.events e on e.id = r.event_id
  where r.public_token = p_public_token
  limit 1;
$$;

grant execute on function public.get_ticket_payment_state(text) to anon, authenticated;
