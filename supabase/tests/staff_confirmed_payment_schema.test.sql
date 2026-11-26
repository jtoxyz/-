-- Task 1: スキーマ・記録用関数・学生QR方式の拒否
-- 企画E2の既定値
do $$ begin
  assert (select payment_confirm_mode from public.events where id = '00000000-0000-4000-8000-0000000000e2') = 'student_scan', 'E2は既定でstudent_scan';
end $$;

-- E1をstaff方式にする（フィクスチャ後に切り替え）
update public.events set payment_confirm_mode = 'staff' where id in ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e3');

-- check制約
do $$ declare ok boolean := false; begin
  begin update public.events set payment_confirm_mode = 'other' where id = '00000000-0000-4000-8000-0000000000e2';
  exception when check_violation then ok := true; end;
  assert ok, 'payment_confirm_modeの不正値はcheck違反';
end $$;

-- 係Aとして方式を取得
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v_n int; begin
  select count(*) into v_n from public.get_event_payment_confirm_modes(array['00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2']::uuid[]) m
   where (m.event_id = '00000000-0000-4000-8000-0000000000e1' and m.payment_confirm_mode = 'staff')
      or (m.event_id = '00000000-0000-4000-8000-0000000000e2' and m.payment_confirm_mode = 'student_scan');
  assert v_n = 2, '方式の取得';
end $$;

-- 101件以上は例外
do $$ declare ok boolean := false; begin
  begin perform public.get_event_payment_confirm_modes(array(select gen_random_uuid() from generate_series(1,101)));
  exception when others then ok := true; end;
  assert ok, '101件以上は拒否';
end $$;

-- payment_receipts は読めない
do $$ declare ok boolean := false; begin
  begin perform * from public.payment_receipts;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'payment_receiptsは権限エラー';
end $$;
reset role;

-- 学生a5: E1の1日QRは拒否
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform * from public.redeem_payment_qr('test-daily-e1', null);
  exception when others then ok := sqlerrm like '%受付の係が支払いを確認します%'; end;
  assert ok, 'redeemはstaff企画で拒否';
end $$;
do $$ declare ok boolean := false; begin
  begin perform * from public.claim_payment_qr('test-daily-e1', null);
  exception when others then ok := sqlerrm like '%受付の係が支払いを確認します%'; end;
  assert ok, 'claimはstaff企画で拒否';
end $$;
reset role;
do $$ begin
  assert (select payment_status from public.reservations where id = '00000000-0000-4000-8000-0000000000b1') = 'pending', 'R1はpendingのまま';
end $$;

-- E2の1日QRは従来どおり成功
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}',true);
set local role authenticated;
do $$ begin perform * from public.redeem_payment_qr('test-daily-e2', null); end $$;
reset role;
do $$ begin
  assert (select payment_status from public.reservations where id = '00000000-0000-4000-8000-0000000000b4') = 'paid', 'R4はpaid';
end $$;

-- 権限
do $$ begin
  assert not has_function_privilege('anon','public.get_event_payment_confirm_modes(uuid[])','execute'), 'anonはmodes不可';
  assert has_function_privilege('authenticated','public.get_event_payment_confirm_modes(uuid[])','execute'), 'authenticatedはmodes可';
  assert not has_function_privilege('authenticated','public.log_payment_receipt(uuid,text,uuid)','execute'), 'log不可';
  assert not has_function_privilege('anon','public.log_payment_receipt(uuid,text,uuid)','execute'), 'anon log不可';
  assert not has_function_privilege('authenticated','public.current_operator_name()','execute'), 'operator_name不可';
  assert not has_function_privilege('anon','public.current_operator_name()','execute'), 'anon operator_name不可';
end $$;

-- 記録用関数（postgresから直接。操作者は auth.uid() = 係A）
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
do $$ declare v_id uuid; v_u uuid; v_row public.payment_receipts%rowtype; begin
  v_id := public.log_payment_receipt('00000000-0000-4000-8000-0000000000b1','received');
  select * into v_row from public.payment_receipts where id = v_id;
  assert v_row.amount_yen = 1500 and v_row.event_id = '00000000-0000-4000-8000-0000000000e1' and v_row.operator_name = '係A'
     and v_row.operator_user_id = '00000000-0000-4000-8000-0000000000a2', '受領の記録';
  v_u := public.log_payment_receipt('00000000-0000-4000-8000-0000000000b1','undone', v_id);
  assert (select amount_yen from public.payment_receipts where id = v_u) = 1500, '取り消し金額';
  assert (select reverses_receipt_id from public.payment_receipts where id = v_u) = v_id, '取り消し先';
  v_u := public.log_payment_receipt('00000000-0000-4000-8000-0000000000b5','received');
  assert (select amount_yen from public.payment_receipts where id = v_u) = 0, '券種なしは0円';
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
do $$ begin
  assert public.current_operator_name() = 't-admin@example.com', 'スタッフでなければメール';
end $$;
select set_config('request.jwt.claims','', true);
