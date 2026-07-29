begin;

create or replace function public.get_my_reservation_id_by_token(p_public_token text)
returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_uid uuid:=auth.uid();
  v_reservation_id uuid;
begin
  if v_uid is null then
    raise exception '大学Googleアカウントでログインしてください。';
  end if;
  select r.id into v_reservation_id
  from public.reservations r
  where r.public_token=p_public_token
    and r.user_id=v_uid;
  return v_reservation_id;
end $$;

revoke all on function public.get_my_reservation_id_by_token(text) from public,anon;
grant execute on function public.get_my_reservation_id_by_token(text) to authenticated;
notify pgrst,'reload schema';
commit;
