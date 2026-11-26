-- 受付の係が支払い済みにする方式のテスト用フィクスチャ（Task 1〜3 共通）。
-- build-test-sql.sh が begin; の直後に連結し、最後に rollback される。固定UUIDを各テストへ直接書く。
--
-- 固定UUID一覧（末尾2桁だけ違う）:
--   ユーザー  a1=管理者 / a2=係A(staff) / a3=係B(staff) / a4=担当外の学生 / a5=予約者の学生
--             00000000-0000-4000-8000-0000000000a1 .. a5
--   スタッフ  係A=...00c1, 係B=...00c2 （staff_members.id）
--   企画      E1(staff方式)=...00e1, E2(student_scan)=...00e2, E3(staff方式・係A担当外)=...00e3
--   開催枠    S1..S3 = ...00d1..d3 （E1..E3）, S4=...00d4（E1の2つ目の枠。R2用。同じ学生は同じ枠に2件取れないため）
--   券種      O1(E1,1500円)=...0001, O2(E1,1000円)=...0002 （末尾が 000000000001 / 000000000002）
--   予約      R1..R6 = ...00b1..b6
--     R1: a5, E1, O1 / R2: a5, E1, O2 / R3: a4, E1, O1 / R4: a5, E2 / R5: E3(a4) / R6: E1 cancelled/expired(a5)
--   public_token R1..R6 = f000000N-0000-4000-8000-000000000000 （N=1..6）
--   企画方式  E1・E3 は payment_confirm_mode='staff'、E2 は student_scan
--   QR token  E1の1日QR='test-daily-e1', E2の1日QR='test-daily-e2'
-- user_profiles: a4 の行あり（admin_create_reservation_for_user 用）
-- 学生メール: a4=s99z004@ge.osaka-sandai.ac.jp, a5=s99z005@ge.osaka-sandai.ac.jp
-- 呼び出し者の切り替え:
--   select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true); set local role authenticated;
--   戻すとき: reset role;

set local session_replication_role = replica;

insert into auth.users(id, email, email_confirmed_at, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1','t-admin@example.com', now(),'authenticated','authenticated'),
  ('00000000-0000-4000-8000-0000000000a2','t-staff-a@example.com', now(),'authenticated','authenticated'),
  ('00000000-0000-4000-8000-0000000000a3','t-staff-b@example.com', now(),'authenticated','authenticated'),
  ('00000000-0000-4000-8000-0000000000a4','s99z004@ge.osaka-sandai.ac.jp', now(),'authenticated','authenticated'),
  ('00000000-0000-4000-8000-0000000000a5','s99z005@ge.osaka-sandai.ac.jp', now(),'authenticated','authenticated');

insert into public.admin_users(user_id) values ('00000000-0000-4000-8000-0000000000a1');

insert into public.staff_members(id, email, display_name) values
  ('00000000-0000-4000-8000-0000000000c1','t-staff-a@example.com','係A'),
  ('00000000-0000-4000-8000-0000000000c2','t-staff-b@example.com','係B');

insert into public.events(id, title, capacity, is_public, payment_required) values
  ('00000000-0000-4000-8000-0000000000e1','テスト企画E1',100,true,true),
  ('00000000-0000-4000-8000-0000000000e2','テスト企画E2',100,true,true),
  ('00000000-0000-4000-8000-0000000000e3','テスト企画E3',100,true,true);

insert into public.event_slots(id, event_id, label, reservation_capacity, total_capacity) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000e1','枠1',100,100),
  ('00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000e2','枠2',100,100),
  ('00000000-0000-4000-8000-0000000000d3','00000000-0000-4000-8000-0000000000e3','枠3',100,100),
  ('00000000-0000-4000-8000-0000000000d4','00000000-0000-4000-8000-0000000000e1','枠1b',100,100);

insert into public.staff_event_access(staff_id, event_id) values
  ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000e2');

insert into public.event_ticket_options(id, event_id, label, price_yen) values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000e1','O1',1500),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-0000000000e1','O2',1000);

insert into public.reservations(id, event_id, event_slot_id, student_name, student_number, university_email,
    ticket_code, public_token, status, payment_status, payment_due_at, user_id, ticket_option_id) values
  ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000d1','学生5','s99z005','s99z005@ge.osaka-sandai.ac.jp','TCODE-R1','f0000001-0000-4000-8000-000000000000','reserved','pending',now()+interval '1 hour','00000000-0000-4000-8000-0000000000a5','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000d4','学生5','s99z005','s99z005@ge.osaka-sandai.ac.jp','TCODE-R2','f0000002-0000-4000-8000-000000000000','reserved','pending',now()+interval '1 hour','00000000-0000-4000-8000-0000000000a5','00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-0000000000b3','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000d1','学生4','s99z004','s99z004@ge.osaka-sandai.ac.jp','TCODE-R3','f0000003-0000-4000-8000-000000000000','reserved','pending',now()+interval '1 hour','00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000b4','00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-0000000000d2','学生5','s99z005','s99z005@ge.osaka-sandai.ac.jp','TCODE-R4','f0000004-0000-4000-8000-000000000000','reserved','pending',now()+interval '1 hour','00000000-0000-4000-8000-0000000000a5',null),
  ('00000000-0000-4000-8000-0000000000b5','00000000-0000-4000-8000-0000000000e3','00000000-0000-4000-8000-0000000000d3','学生4','s99z004','s99z004@ge.osaka-sandai.ac.jp','TCODE-R5','f0000005-0000-4000-8000-000000000000','reserved','pending',now()+interval '1 hour','00000000-0000-4000-8000-0000000000a4',null),
  ('00000000-0000-4000-8000-0000000000b6','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000d1','学生5','s99z005','s99z005@ge.osaka-sandai.ac.jp','TCODE-R6','f0000006-0000-4000-8000-000000000000','cancelled','expired',now()+interval '1 hour','00000000-0000-4000-8000-0000000000a5','00000000-0000-4000-8000-000000000001');

insert into public.payment_qr_codes(event_id, mode, token, valid_date, valid_from, valid_until, is_active) values
  ('00000000-0000-4000-8000-0000000000e1','daily','test-daily-e1',(now() at time zone 'Asia/Tokyo')::date, now()-interval '1 hour', now()+interval '1 hour', true),
  ('00000000-0000-4000-8000-0000000000e2','daily','test-daily-e2',(now() at time zone 'Asia/Tokyo')::date, now()-interval '1 hour', now()+interval '1 hour', true);

insert into public.user_profiles(user_id, university_email, student_number, student_name) values
  ('00000000-0000-4000-8000-0000000000a4','s99z004@ge.osaka-sandai.ac.jp','25Z004','学生4');

set local session_replication_role = origin;

-- 係の受付方式の企画（E1, E3）。E2 は student_scan のまま。
update public.events set payment_confirm_mode = 'staff'
 where id in ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e3');
