begin;

create or replace function public.admin_list_user_profiles(p_search text default null)
returns table(
  user_id uuid,university_email text,student_number text,student_name text,
  created_at timestamptz,updated_at timestamptz,name_updated_at timestamptz,
  reservation_count bigint,active_reservation_count bigint
)
language plpgsql security definer set search_path=public,auth as $$
begin
  if not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception '管理者権限がありません。';
  end if;
  return query
  select p.user_id,p.university_email,p.student_number,p.student_name,p.created_at,p.updated_at,p.name_updated_at,
         count(r.id),count(r.id) filter(where r.status in('reserved','used'))
  from public.user_profiles p
  left join public.reservations r on r.user_id=p.user_id
  where p_search is null or btrim(p_search)=''
     or p.student_name ilike '%'||btrim(p_search)||'%'
     or p.student_number ilike '%'||btrim(p_search)||'%'
     or p.university_email ilike '%'||btrim(p_search)||'%'
  group by p.user_id,p.university_email,p.student_number,p.student_name,p.created_at,p.updated_at,p.name_updated_at
  order by p.student_number;
end $$;

create or replace function public.admin_update_profile_name(p_user_id uuid,p_student_name text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_admin_uid uuid:=auth.uid();
  v_old_name text;
  v_new_name text;
  v_profile public.user_profiles%rowtype;
begin
  if not exists(select 1 from public.admin_users au where au.user_id=v_admin_uid) then
    raise exception '管理者権限がありません。';
  end if;
  v_new_name:=regexp_replace(btrim(coalesce(p_student_name,'')),'[[:space:]]+',' ','g');
  if char_length(v_new_name)<1 or char_length(v_new_name)>100 then
    raise exception '氏名は1文字以上100文字以内で入力してください。';
  end if;
  select student_name into v_old_name from public.user_profiles where user_id=p_user_id for update;
  if not found then raise exception '利用者プロフィールが見つかりません。'; end if;

  update public.user_profiles
  set student_name=v_new_name,updated_at=now(),name_updated_by=v_admin_uid,name_updated_at=now()
  where user_id=p_user_id returning * into v_profile;
  update public.reservations set student_name=v_new_name where user_id=p_user_id;
  update public.admin_pre_registrations set student_name=v_new_name where user_id=p_user_id;

  insert into public.admin_action_logs(action,target_table,target_id,details,actor_user_id)
  values(
    'update_profile_name','user_profiles',p_user_id::text,
    jsonb_build_object('old_name',v_old_name,'new_name',v_new_name,'student_number',v_profile.student_number),
    v_admin_uid
  );

  return jsonb_build_object(
    'user_id',v_profile.user_id,'student_name',v_profile.student_name,
    'student_number',v_profile.student_number,'university_email',v_profile.university_email,
    'updated_at',v_profile.updated_at
  );
end $$;

revoke all on function public.admin_list_user_profiles(text) from public,anon;
revoke all on function public.admin_update_profile_name(uuid,text) from public,anon;
grant execute on function public.admin_list_user_profiles(text) to authenticated;
grant execute on function public.admin_update_profile_name(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
