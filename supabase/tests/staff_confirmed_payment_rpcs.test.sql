-- Task 2: 係の受付RPC（検索・受領・取消・集計）
-- E1/E3 は staff 方式（フィクスチャで設定済み）。トークン: R1..R6 = f000000N-0000-4000-8000-000000000000
-- 呼び出し者: a1=管理者 / a2=係A / a3=係B / a4=担当外の学生

-- 担当外・権限・入力検証
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000001-0000-4000-8000-000000000000');
  exception when others then ok := sqlerrm like '%権限%'; end;
  assert ok, '担当外の学生は検索できない';
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean; begin
  ok := false;
  begin perform public.staff_receive_payment(array['00000000-0000-4000-8000-0000000000b5'::uuid]);
  exception when others then ok := sqlerrm like '%権限%'; end;
  assert ok, '担当外の企画（E3）の受領は拒否される';
  ok := false;
  begin perform public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e3', 'f0000005-0000-4000-8000-000000000000');
  exception when others then ok := sqlerrm like '%権限%'; end;
  assert ok, '担当外の企画を指定した検索は拒否される';
  ok := false;
  begin perform public.staff_receive_payment(array[]::uuid[]);
  exception when others then ok := true; end;
  assert ok, '空配列は拒否される';
  ok := false;
  begin perform public.staff_receive_payment(null);
  exception when others then ok := true; end;
  assert ok, 'nullは拒否される';
  ok := false;
  begin perform public.staff_receive_payment(array(select gen_random_uuid() from generate_series(1,21)));
  exception when others then ok := true; end;
  assert ok, '21件以上は拒否される';
end $$;

-- 入力の正規化
do $$ declare v jsonb; t text := 'f0000001-0000-4000-8000-000000000000'; begin
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', '  https://x/staff?r=' || upper(t) || '  ');
  assert v->>'status' = 'found', 'URL形式・大文字・前後の空白でも見つかる';
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', translate(t, '0123456789abcdef-', '０１２３４５６７８９ａｂｃｄｅｆ－'));
  assert v->>'status' = 'found', '全角のトークンでも見つかる';
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', '24B123');
  assert v->>'status' = 'not_found', '学籍番号のような入力は検索しない';
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', null);
  assert v->>'status' = 'not_found', 'nullはnot_found';
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f9999999-0000-4000-8000-000000000000');
  assert v->>'status' = 'not_found', '存在しないトークンはnot_found';
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000005-0000-4000-8000-000000000000');
  assert v->>'status' = 'not_found', '担当外の企画の予約はnot_foundで存在を明かさない';
end $$;

-- 複数予約
do $$ declare v jsonb; begin
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000001-0000-4000-8000-000000000000');
  assert v->>'event_title' = 'テスト企画E1' and v->>'student_name' = '学生5' and v->>'student_number' = 's99z005', '企画名・氏名・学籍番号が返る';
  assert jsonb_array_length(v->'reservations') = 2, '同じ人のその企画の予約が2件（キャンセル済みR6と別の人のR3は含まない）';
  assert exists (select 1 from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1'), 'R1を含む';
  assert exists (select 1 from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b2'), 'R2を含む';
  assert (v->>'pending_total_yen')::int = 2500, '未払い合計は2500円';
  assert (select x->>'ticket_option_label' from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1') = 'O1', '券種名が返る';
  assert (select (x->>'amount_yen')::int from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1') = 1500, '券種の金額が返る';
  assert (select x->>'received_at' from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1') is null, '未受領はreceived_atがnull';
end $$;

-- 別企画・方式違い
do $$ declare v jsonb; ok boolean; begin
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000004-0000-4000-8000-000000000000');
  assert v->>'status' = 'other_event' and v->>'event_id' = '00000000-0000-4000-8000-0000000000e2' and v->>'event_title' = 'テスト企画E2', '別企画の予約はother_eventで企画を示す';
  ok := false;
  begin perform public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e2', 'f0000004-0000-4000-8000-000000000000');
  exception when others then ok := sqlerrm like '%学生がQRを読む方式%'; end;
  assert ok, 'student_scan方式の企画は受付画面で拒否される';
  ok := false;
  begin perform public.staff_find_payment_target(null, 'f0000004-0000-4000-8000-000000000000');
  exception when others then ok := sqlerrm like '%学生がQRを読む方式%'; end;
  assert ok, '企画未指定でもstudent_scan方式は拒否される';
  v := public.staff_find_payment_target(null, 'f0000001-0000-4000-8000-000000000000');
  assert v->>'status' = 'found', '企画未指定でも予約の企画で検索できる';
end $$;
reset role;

-- 係Bは E3 担当外。企画未指定でも権限エラー
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.staff_find_payment_target(null, 'f0000005-0000-4000-8000-000000000000');
  exception when others then ok := sqlerrm like '%権限%'; end;
  assert ok, '企画未指定でも担当外の企画は権限エラー';
end $$;
reset role;

-- 受領（係A: R1, R2）
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_receive_payment(array['00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2']::uuid[]);
  assert (v->>'received_count')::int = 2 and (v->>'received_total_yen')::int = 2500, '2件・2500円を受領';
  assert jsonb_array_length(v->'received') = 2 and jsonb_array_length(v->'already_paid') = 0 and jsonb_array_length(v->'unavailable') = 0, '受領の内訳';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.reservations where id in ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2')
            and payment_status = 'paid' and paid_at is not null and payment_confirmed_by = '00000000-0000-4000-8000-0000000000a2') = 2, 'R1・R2がpaidで確認者は係A';
  assert (select count(*) from public.payment_receipts where action = 'received' and operator_name = '係A') = 2, '受領の記録が2行';
  assert (select amount_yen from public.payment_receipts where reservation_id = '00000000-0000-4000-8000-0000000000b1') = 1500, 'R1の記録は1500円';
  assert (select amount_yen from public.payment_receipts where reservation_id = '00000000-0000-4000-8000-0000000000b2') = 1000, 'R2の記録は1000円';
end $$;

-- 二重受領（係B）
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_receive_payment(array['00000000-0000-4000-8000-0000000000b1']::uuid[]);
  assert (v->>'received_count')::int = 0, '受領済みは二重に受け取らない';
  assert v->'already_paid'->0->>'received_by_name' = '係A' and v->'already_paid'->0->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1', '受け取った人の名前が返る';
  v := public.staff_receive_payment(array['00000000-0000-4000-8000-0000000000b6']::uuid[]);
  assert v->'unavailable'->>0 = '00000000-0000-4000-8000-0000000000b6' and (v->>'received_count')::int = 0, 'キャンセル済みはunavailable';
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000001-0000-4000-8000-000000000000');
  assert (select (x->>'received_by_me')::boolean from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1') = false, '係Bから見るとreceived_by_meはfalse';
  assert (select x->>'received_by_name' from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1') = '係A', '受け取った人は係A';
  assert (v->>'pending_total_yen')::int = 0, '全部支払い済みなら未払い合計は0';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.payment_receipts) = 2, '二重受領で記録は増えない';
end $$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000001-0000-4000-8000-000000000000');
  assert (select (x->>'received_by_me')::boolean from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1') = true, '係Aから見るとreceived_by_meはtrue';
  assert (select x->>'received_at' from jsonb_array_elements(v->'reservations') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1') is not null, 'received_atが入る';
end $$;
reset role;

-- 取消（係B は他人の受領を取り消せない。係A は自分の分を取り消せる）
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.staff_undo_payment('00000000-0000-4000-8000-0000000000b1');
  exception when others then ok := sqlerrm like '%自分が今日受け取った分だけ%'; end;
  assert ok, '他人が受け取った分は取り消せない';
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_undo_payment('00000000-0000-4000-8000-0000000000b1');
  assert (v->>'amount_yen')::int = 1500 and (v->>'will_expire')::boolean = false and v->>'reservation_id' = '00000000-0000-4000-8000-0000000000b1', '取消の返り値';
end $$;
reset role;
do $$ declare v_recv uuid; begin
  assert (select payment_status from public.reservations where id = '00000000-0000-4000-8000-0000000000b1') = 'pending'
     and (select paid_at from public.reservations where id = '00000000-0000-4000-8000-0000000000b1') is null
     and (select payment_confirmed_by from public.reservations where id = '00000000-0000-4000-8000-0000000000b1') is null, 'R1はpendingに戻る';
  select id into v_recv from public.payment_receipts where reservation_id = '00000000-0000-4000-8000-0000000000b1' and action = 'received';
  assert (select reverses_receipt_id from public.payment_receipts where reservation_id = '00000000-0000-4000-8000-0000000000b1' and action = 'undone') = v_recv, 'undone行が受領を指す';
end $$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.staff_undo_payment('00000000-0000-4000-8000-0000000000b1');
  exception when others then ok := sqlerrm like '%支払い済みの予約ではありません%'; end;
  assert ok, '二重の取消は拒否される';
end $$;
reset role;

-- 同じ受領を二重に打ち消す行は一意制約で拒否される
do $$ declare ok boolean := false; v_recv uuid; begin
  select id into v_recv from public.payment_receipts where reservation_id = '00000000-0000-4000-8000-0000000000b1' and action = 'received';
  begin
    insert into public.payment_receipts(event_id, reservation_id, action, amount_yen, reverses_receipt_id)
    values ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000b1','undone',1500,v_recv);
  exception when unique_violation then ok := true; end;
  assert ok, '同じ受領を2回打ち消せない';
end $$;

-- 使用済みは取り消せない（R4は student_scan 企画のため別に確認せず、R3で一時的に used にする）
-- 前日の受領: R2 の受領記録を前日にする（postgres で書き換え）
update public.payment_receipts set created_at = now() - interval '1 day'
 where reservation_id = '00000000-0000-4000-8000-0000000000b2' and action = 'received';

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.staff_undo_payment('00000000-0000-4000-8000-0000000000b2');
  exception when others then ok := sqlerrm like '%自分が今日受け取った分だけ%'; end;
  assert ok, '前日の受領は係Aでも取り消せない';
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_undo_payment('00000000-0000-4000-8000-0000000000b2');
  assert (v->>'amount_yen')::int = 1000, '管理者は前日の受領を取り消せる（金額は受領時の1000円）';
end $$;
reset role;
do $$ begin
  assert (select payment_status from public.reservations where id = '00000000-0000-4000-8000-0000000000b2') = 'pending', 'R2はpendingに戻る';
end $$;

-- 期限切れ間近: R3 を係Aが受領 → 期限を過去にして取消
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_receive_payment(array['00000000-0000-4000-8000-0000000000b3']::uuid[]);
  assert (v->>'received_count')::int = 1 and (v->>'received_total_yen')::int = 1500, 'R3を1500円で受領';
end $$;
reset role;
update public.reservations set payment_due_at = now() - interval '10 minutes' where id = '00000000-0000-4000-8000-0000000000b3';

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_undo_payment('00000000-0000-4000-8000-0000000000b3');
  assert (v->>'will_expire')::boolean = true, '期限を過ぎていればwill_expire=true';
end $$;
reset role;
do $$ begin
  assert (select status || '/' || payment_status from public.reservations where id = '00000000-0000-4000-8000-0000000000b3') = 'reserved/pending', 'R3はreserved/pendingのまま（キャンセルは毎分の処理に任せる）';
end $$;

-- 使用済みは取り消せない
update public.reservations set status = 'used', payment_status = 'paid' where id = '00000000-0000-4000-8000-0000000000b1';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform public.staff_undo_payment('00000000-0000-4000-8000-0000000000b1');
  exception when others then ok := sqlerrm like '%チケット使用済みのため取り消せません%'; end;
  assert ok, '使用済みは管理者でも取り消せない';
end $$;
reset role;
update public.reservations set status = 'reserved', payment_status = 'pending' where id = '00000000-0000-4000-8000-0000000000b1';

-- 集計: 係A
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; ok boolean; begin
  v := public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e1');
  assert v->>'date' = to_char((now() at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD'), '日付は今日（JST）';
  assert jsonb_array_length(v->'operators') = 1 and v->'operators'->0->>'operator_name' = '係A', '係Aには自分の行だけ';
  assert (v->'operators'->0->>'received_count')::int = 2 and (v->'operators'->0->>'received_yen')::int = 3000, '受領は2件3000円（R1, R3）';
  assert (v->'operators'->0->>'undone_count')::int = 3 and (v->'operators'->0->>'undone_yen')::int = 4000, '取消は3件4000円（R1, R3, 前日受領のR2）';
  assert (v->'operators'->0->>'net_count')::int = -1 and (v->'operators'->0->>'net_yen')::int = -1000, '差し引きは-1件・-1000円';
  assert (v->'total'->>'net_count')::int = -1 and (v->'total'->>'net_yen')::int = -1000, '合計も同じ';
  assert jsonb_array_length(v->'items') = 5, '明細は今日の5行（受領2・取消3）';
  assert (select count(*) from jsonb_array_elements(v->'items') x where x->>'action' = 'received' and (x->>'reversed')::boolean) = 2, '打ち消された受領2行はreversed=true';
  assert (v->'items'->0->>'created_at')::timestamptz >= (v->'items'->4->>'created_at')::timestamptz, '明細は新しい順';
  assert exists (select 1 from jsonb_array_elements(v->'items') x where x->>'student_name' = '学生5' and x->>'ticket_option_label' = 'O2' and (x->>'amount_yen')::int = 1000), '明細に氏名・券種・金額';
  ok := false;
  begin perform public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Asia/Tokyo')::date - 1);
  exception when others then ok := sqlerrm like '%今日の分だけ%'; end;
  assert ok, 'スタッフは今日以外を確認できない';
  ok := false;
  begin perform public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e3');
  exception when others then ok := sqlerrm like '%権限%'; end;
  assert ok, '担当外の企画の集計は権限エラー';
end $$;
reset role;

-- 集計: 係B は何も出ない（他人の行は見えない）
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e1');
  assert jsonb_array_length(v->'operators') = 0 and jsonb_array_length(v->'items') = 0 and (v->'total'->>'net_yen')::int = 0, '係Bには他人の帰属分は出ない';
end $$;
reset role;

-- 集計: 管理者
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e1');
  assert jsonb_array_length(v->'operators') = 1 and v->'operators'->0->>'operator_name' = '係A', '管理者の集計に係Aの行（R2の取消は係Aに帰属）';
  assert (v->'operators'->0->>'undone_count')::int = 3 and (v->'operators'->0->>'net_yen')::int = -1000, '管理者が見ても係Aの数字は同じ';
  assert (v->'total'->>'net_count')::int = -1 and (v->'total'->>'net_yen')::int = -1000, '管理者の合計';
  assert exists (select 1 from jsonb_array_elements(v->'items') x where x->>'reservation_id' = '00000000-0000-4000-8000-0000000000b2' and x->>'action' = 'undone' and x->>'attributed_user_id' = '00000000-0000-4000-8000-0000000000a2' and x->>'operator_name' = 't-admin@example.com'), 'R2の取消は操作者が管理者、帰属は係A';
  v := public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Asia/Tokyo')::date - 1);
  assert jsonb_array_length(v->'operators') = 1 and (v->'operators'->0->>'received_count')::int = 1 and (v->'operators'->0->>'received_yen')::int = 1000, '管理者は前日の集計を確認できる（R2の受領1000円）';
end $$;
reset role;

-- 記録外の取消は帰属なし（打ち消す受領のない取消）
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
do $$ begin perform public.log_payment_receipt('00000000-0000-4000-8000-0000000000b4','undone'); end $$;
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_get_payment_summary('00000000-0000-4000-8000-0000000000e2');
  assert v->'operators'->0->>'operator_user_id' is null and v->'operators'->0->>'operator_name' = '（記録外の取消）', '記録外の取消は帰属なしの行で出る';
  assert (v->'total'->>'net_yen')::int = 0 and (v->'total'->>'net_count')::int = 0, '記録外の取消は合計に含めない';
end $$;
reset role;

-- キャンセル・期限切れ（R1, R2 もキャンセルして同じ人の有効な予約をなくす）
update public.reservations set status = 'cancelled', payment_status = 'expired' where id in ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000006-0000-4000-8000-000000000000');
  assert v->>'status' = 'expired' and v->>'student_name' = '学生5' and v->>'student_number' = 's99z005', '期限切れで取り消された予約はexpired';
end $$;
reset role;
update public.reservations set payment_status = 'pending' where id = '00000000-0000-4000-8000-0000000000b6';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.staff_find_payment_target('00000000-0000-4000-8000-0000000000e1', 'f0000006-0000-4000-8000-000000000000');
  assert v->>'status' = 'cancelled', '自分でキャンセルした予約はcancelled';
end $$;
reset role;

-- 権限
do $$ begin
  assert not has_function_privilege('anon','public.staff_find_payment_target(uuid,text)','execute'), 'anonはfind不可';
  assert not has_function_privilege('anon','public.staff_receive_payment(uuid[])','execute'), 'anonはreceive不可';
  assert not has_function_privilege('anon','public.staff_undo_payment(uuid)','execute'), 'anonはundo不可';
  assert not has_function_privilege('anon','public.staff_get_payment_summary(uuid,date)','execute'), 'anonはsummary不可';
  assert has_function_privilege('authenticated','public.staff_find_payment_target(uuid,text)','execute'), 'authenticatedはfind可';
  assert has_function_privilege('authenticated','public.staff_receive_payment(uuid[])','execute'), 'authenticatedはreceive可';
  assert has_function_privilege('authenticated','public.staff_undo_payment(uuid)','execute'), 'authenticatedはundo可';
  assert has_function_privilege('authenticated','public.staff_get_payment_summary(uuid,date)','execute'), 'authenticatedはsummary可';
end $$;
