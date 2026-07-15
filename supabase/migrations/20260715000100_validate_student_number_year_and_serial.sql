create or replace function public.validate_reservation_student_number()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized text;
  admission_year integer;
  serial_number integer;
  academic_year integer;
  academic_year_2digits integer;
begin
  -- Do not block status changes or cancellations of existing records.
  if tg_op = 'UPDATE' and new.student_number is not distinct from old.student_number then
    return new;
  end if;

  normalized := upper(btrim(new.student_number));

  if normalized !~ '^[0-9]{2}[PTBCEHMSVFGKL][0-9]{3}$' then
    raise exception '学籍番号は「数字2桁＋正式な学科コード1文字＋数字3桁」で入力してください。';
  end if;

  admission_year := substring(normalized from 1 for 2)::integer;
  serial_number := substring(normalized from 4 for 3)::integer;

  -- Osaka Sangyo University academic year starts in April.
  academic_year := extract(year from timezone('Asia/Tokyo', now()))::integer;
  if extract(month from timezone('Asia/Tokyo', now()))::integer < 4 then
    academic_year := academic_year - 1;
  end if;
  academic_year_2digits := academic_year % 100;

  if admission_year > academic_year_2digits then
    raise exception '入学年度が未来になっています。学籍番号を確認してください。';
  end if;

  if serial_number = 0 then
    raise exception '学籍番号の末尾3桁に「000」は使用できません。';
  end if;

  new.student_number := normalized;
  return new;
end;
$$;

drop trigger if exists validate_reservation_student_number_trigger on public.reservations;
create trigger validate_reservation_student_number_trigger
before insert or update of student_number on public.reservations
for each row
execute function public.validate_reservation_student_number();
