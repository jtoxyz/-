begin;

create or replace function public.create_my_profile(p_student_name text)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_uid uuid:=auth.uid();
  v_email text;
  v_student_number text;
  v_name text;
  v_profile public.user_profiles%rowtype;
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id=v_uid and u.email_confirmed_at is not null;

  if v_email is null or v_email !~ '^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$' then
    raise exception '大阪産業大学のGoogleアカウントを確認できません。';
  end if;

  if not exists(
    select 1 from auth.identities i
    where i.user_id=v_uid
      and i.provider='google'
      and lower(coalesce(i.identity_data->'custom_claims'->>'hd',''))='ge.osaka-sandai.ac.jp'
      and coalesce((i.identity_data->>'email_verified')::boolean,false)=true
  ) then
    raise exception '大阪産業大学Google Workspaceの認証情報を確認できません。';
  end if;

  v_student_number:=upper(substr(split_part(v_email,'@',1),2));
  v_name:=regexp_replace(btrim(coalesce(p_student_name,'')),'[[:space:]]+',' ','g');
  if char_length(v_name)<1 or char_length(v_name)>100 then
    raise exception '氏名は1文字以上100文字以内で入力してください。';
  end if;

  select * into v_profile from public.user_profiles where user_id=v_uid;
  if not found then
    insert into public.user_profiles(user_id,university_email,student_number,student_name)
    values(v_uid,v_email,v_student_number,v_name)
    returning * into v_profile;
  end if;

  update public.reservations
  set user_id=v_uid,student_name=v_profile.student_name,
      student_number=v_profile.student_number,university_email=v_profile.university_email
  where lower(university_email)=v_profile.university_email
    and (user_id is null or user_id=v_uid);

  update public.admin_pre_registrations
  set user_id=v_uid,student_name=v_profile.student_name,
      student_number=v_profile.student_number,university_email=v_profile.university_email
  where lower(university_email)=v_profile.university_email
    and (user_id is null or user_id=v_uid);

  return jsonb_build_object(
    'user_id',v_profile.user_id,
    'university_email',v_profile.university_email,
    'student_number',v_profile.student_number,
    'student_name',v_profile.student_name,
    'created_at',v_profile.created_at
  );
end $$;

revoke all on function public.create_my_profile(text) from public,anon;
grant execute on function public.create_my_profile(text) to authenticated;
notify pgrst,'reload schema';
commit;
