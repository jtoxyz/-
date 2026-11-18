-- 予約者本人の利用状態（来なかった回数・イエロー／ブラックリスト・ブラックリストの理由）を返す。
-- 予約サイトを開いた時点でブラックリストの人を止め、理由を本人に表示するために使う。
-- 既存の get_my_noshow_status は互換のため残す。

create or replace function public.get_my_access_status()
returns table(
  noshow_count integer,
  level text,
  blacklist_reason text,
  blacklist_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_profile public.user_profiles%rowtype;
  v_student text;
  v_email text;
  v_count integer;
  v_reason text;
  v_expires timestamptz;
  v_blacklisted boolean;
begin
  if auth.uid() is null then
    return;
  end if;

  select * into v_profile from public.user_profiles where user_id = auth.uid();
  if not found then
    return;
  end if;

  v_student := upper(regexp_replace(btrim(coalesce(v_profile.student_number, '')), '\s+', '', 'g'));
  if v_student like 'S%' then
    v_student := substr(v_student, 2);
  end if;
  v_email := lower(btrim(coalesce(v_profile.university_email, '')));

  v_count := public.count_payment_noshows(v_profile.student_number);

  -- is_user_blacklisted と同じ条件で、最新の有効な登録の理由を取る
  select b.reason, b.expires_at
    into v_reason, v_expires
    from public.user_blacklist b
   where b.active
     and (b.expires_at is null or b.expires_at > now())
     and (
       (v_student <> '' and b.student_number = v_student)
       or (v_email <> '' and b.university_email = v_email)
     )
   order by b.created_at desc
   limit 1;

  v_blacklisted := found;

  return query select
    v_count,
    case
      when v_blacklisted then 'blacklisted'
      when v_count >= 2 then 'yellow'
      else 'normal'
    end,
    case when v_blacklisted then v_reason else null end,
    case when v_blacklisted then v_expires else null end;
end
$function$;

revoke all on function public.get_my_access_status() from public;
revoke all on function public.get_my_access_status() from anon;
grant execute on function public.get_my_access_status() to authenticated;
