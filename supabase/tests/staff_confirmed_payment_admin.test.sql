-- Task 3: 管理画面の支払い変更も受領記録に残る
-- payment_receipts は authenticated から直接読めないので、記録の確認は postgres（reset role）で行う。
-- 管理者 a1 として呼ぶときは「select set_config(...); set local role authenticated;」、終わったら「reset role;」。

-- true: received 1行
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
select public.admin_set_reservation_payment_status('00000000-0000-4000-8000-0000000000b3', true);
reset role;
do $$ declare n int; op text; begin
  select count(*), max(operator_name) into n, op from public.payment_receipts
   where reservation_id='00000000-0000-4000-8000-0000000000b3' and action='received';
  assert n = 1 and op = 't-admin@example.com', format('received 1行 (n=%s op=%s)', n, op);
end $$;

-- もう一度 true: 行も paid_at も変わらない（now() は同一トランザクションで固定なので、目印の値を入れて確かめる）
update public.reservations set paid_at = '2000-01-01 00:00:00+00' where id='00000000-0000-4000-8000-0000000000b3';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
select public.admin_set_reservation_payment_status('00000000-0000-4000-8000-0000000000b3', true);
reset role;
do $$ declare n int; begin
  select count(*) into n from public.payment_receipts where reservation_id='00000000-0000-4000-8000-0000000000b3';
  assert n = 1, '2回目のtrueで記録は増えない';
  assert (select paid_at from public.reservations where id='00000000-0000-4000-8000-0000000000b3') = '2000-01-01 00:00:00+00', 'paid_at不変';
end $$;

-- false: undone 1行、reverses が受領
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
select public.admin_set_reservation_payment_status('00000000-0000-4000-8000-0000000000b3', false);
reset role;
do $$ declare n int; ok boolean; begin
  select count(*) into n from public.payment_receipts where reservation_id='00000000-0000-4000-8000-0000000000b3' and action='undone';
  assert n = 1, 'undone 1行';
  select u.reverses_receipt_id = r.id into ok
    from public.payment_receipts u join public.payment_receipts r on r.reservation_id=u.reservation_id and r.action='received'
   where u.reservation_id='00000000-0000-4000-8000-0000000000b3' and u.action='undone';
  assert ok, 'undoneは受領を打ち消す';
  assert (select payment_status from public.reservations where id='00000000-0000-4000-8000-0000000000b3') = 'pending', 'pendingに戻る';
end $$;

-- 支払い済みでない予約に false: 記録は増えない
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
select public.admin_set_reservation_payment_status('00000000-0000-4000-8000-0000000000b3', false);
-- 対象外（キャンセル済み）はエラー
do $$ declare ok boolean := false; begin
  begin perform public.admin_set_reservation_payment_status('00000000-0000-4000-8000-0000000000b6', true);
  exception when others then ok := sqlerrm = '対象の予約を更新できませんでした。'; end;
  assert ok, 'キャンセル済みをpaidにはできない';
end $$;
reset role;
do $$ declare n int; begin
  select count(*) into n from public.payment_receipts where reservation_id='00000000-0000-4000-8000-0000000000b3';
  assert n = 2, 'paid以外へのfalseは記録しない';
end $$;

-- 一覧（R3: 打ち消し済みなので last_received なし、undone_count=1）
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
do $$ declare r record; begin
  select * into r from public.admin_list_payment_receipts('00000000-0000-4000-8000-0000000000e1') x
   where x.reservation_id='00000000-0000-4000-8000-0000000000b3';
  assert found and r.undone_count = 1, 'R3 undone_count=1';
  assert r.last_received_at is null and r.last_received_by is null, '打ち消し済みなのでlast_receivedなし';
end $$;
-- 再受領すると last_received に出る
select public.admin_set_reservation_payment_status('00000000-0000-4000-8000-0000000000b3', true);
do $$ declare r record; begin
  select * into r from public.admin_list_payment_receipts('00000000-0000-4000-8000-0000000000e1') x
   where x.reservation_id='00000000-0000-4000-8000-0000000000b3';
  assert r.undone_count = 1 and r.last_received_by = 't-admin@example.com' and r.last_received_at is not null, '再受領がlast_received';
end $$;
reset role;

-- 係Aは一覧を呼べない
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform * from public.admin_list_payment_receipts('00000000-0000-4000-8000-0000000000e1');
  exception when others then ok := sqlerrm = '管理者権限が必要です。'; end;
  assert ok, '係Aは一覧不可';
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon','public.admin_list_payment_receipts(uuid)','execute'), 'anon不可';
  assert has_function_privilege('authenticated','public.admin_list_payment_receipts(uuid)','execute'), 'authenticated可';
  assert not has_function_privilege('authenticated','public.payment_receipt_to_undo(uuid)','execute'), '内部関数は不可';
  assert not has_function_privilege('anon','public.payment_receipt_to_undo(uuid)','execute'), '内部関数はanon不可';
end $$;

-- 学生QRで支払い済みにした R4（記録なし）を管理者が戻す
update public.reservations set payment_status='paid', paid_at=now() where id='00000000-0000-4000-8000-0000000000b4';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
select public.admin_set_reservation_payment_status('00000000-0000-4000-8000-0000000000b4', false);
do $$ declare v jsonb; begin
  v := public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e2');
  assert exists (select 1 from jsonb_array_elements(v->'operators') o
                  where o->>'operator_user_id' is null and (o->>'undone_count')::int = 1), '記録外の取消行に出る';
  assert (v->'total'->>'net_yen')::int = 0 and (v->'total'->>'net_count')::int = 0, 'totalに入らない';
end $$;
reset role;
do $$ declare n int; rv uuid; begin
  select count(*), max(reverses_receipt_id::text)::uuid into n, rv from public.payment_receipts
   where reservation_id='00000000-0000-4000-8000-0000000000b4' and action='undone';
  assert n = 1 and rv is null, 'R4のundoneはreverses null';
end $$;

-- admin_create_reservation_for_user (p_paid=true)
-- 学籍番号のトリガー検証を通すため、このトランザクションだけ学科コード Z を許可する
update public.student_number_settings set allowed_department_codes = array_append(coalesce(allowed_department_codes, '{}'), 'Z') where id = true;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
create temp table t_created(res jsonb);
grant all on t_created to authenticated;
insert into t_created select public.admin_create_reservation_for_user('00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000d4', true, null, false, null);
reset role;
do $$ declare n int; v jsonb; begin
  select res into v from t_created;
  select count(*) into n from public.payment_receipts where reservation_id = (v->>'id')::uuid and action='received' and operator_name='t-admin@example.com';
  assert n = 1, '管理者作成の支払い済みはreceived 1行';
end $$;
