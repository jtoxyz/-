-- 初回アカウント登録で氏名入力を省く。
-- 大学Google Workspaceの表示名は「24B123山田 太郎」の形（先頭に学籍番号）なので、
-- p_student_name を省略（null/空）した場合は、DB側で大学Googleアカウントの名前から
-- 学籍番号部分を取り除いて氏名として登録する。クライアントから送られた名前は信用しない経路。
-- 名前を取得できない場合は従来どおり手入力の氏名で登録できる（引数を渡す）。
-- 既存の呼び出し create_my_profile(p_student_name => '...') はそのまま動く（引数にデフォルトを追加しただけ）。
begin;

create or replace function public.create_my_profile(p_student_name text default null)
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
  v_google_name text;
  v_profile public.user_profiles%rowtype;
begin
  if v_uid is null then
    raise exception '大学Googleアカウントでログインしてください。';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id=v_uid
    and u.email_confirmed_at is not null;

  if v_email is null
     or v_email !~ '^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$' then
    raise exception '大阪産業大学のGoogleアカウントを確認できません。';
  end if;

  select coalesce(nullif(btrim(i.identity_data->>'full_name'),''), nullif(btrim(i.identity_data->>'name'),''))
  into v_google_name
  from auth.identities i
  where i.user_id=v_uid
    and i.provider='google'
    and lower(coalesce(i.identity_data->'custom_claims'->>'hd',''))='ge.osaka-sandai.ac.jp'
    and coalesce((i.identity_data->>'email_verified')::boolean,false)=true
  order by i.updated_at desc nulls last
  limit 1;

  if not found then
    raise exception '大阪産業大学Google Workspaceの認証情報を確認できません。';
  end if;

  v_student_number:=upper(substr(split_part(v_email,'@',1),2));

  if nullif(btrim(coalesce(p_student_name,'')),'') is not null then
    v_name:=p_student_name;
  else
    -- 先頭の学籍番号（例: 24B123）を取り除く
    v_name:=regexp_replace(coalesce(v_google_name,''),'^[[:space:]　]*'||v_student_number,'','i');
  end if;

  v_name:=regexp_replace(btrim(v_name,E' \t\r\n　'),'[[:space:]　]+',' ','g');
  if char_length(v_name)<1 or char_length(v_name)>100 then
    if nullif(btrim(coalesce(p_student_name,'')),'') is null then
      raise exception '大学Googleアカウントから氏名を取得できませんでした。氏名を入力してください。';
    end if;
    raise exception '氏名は1文字以上100文字以内で入力してください。';
  end if;

  select * into v_profile
  from public.user_profiles
  where user_id=v_uid;

  if not found then
    insert into public.user_profiles(user_id,university_email,student_number,student_name)
    values(v_uid,v_email,v_student_number,v_name)
    returning * into v_profile;
  end if;

  update public.reservations
  set user_id=v_uid,
      student_name=v_profile.student_name,
      student_number=v_profile.student_number,
      university_email=v_profile.university_email
  where lower(university_email)=v_profile.university_email
    and (user_id is null or user_id=v_uid);

  update public.admin_pre_registrations
  set user_id=v_uid,
      student_name=v_profile.student_name,
      student_number=v_profile.student_number,
      university_email=v_profile.university_email
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
