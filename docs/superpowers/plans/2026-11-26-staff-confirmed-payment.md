# 受付の係が支払い済みにする方式（スタッフ確定方式）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 企画ごとに「受付の係が確認する」方式へ切り替えられるようにし、係が学生の「受付で見せるQR」をスキャナーで読んで、その場で支払い済みにし、受領・取り消しを記録して、受付を閉めるときに現金と照合できるようにする。

**Architecture:** DB に `events.payment_confirm_mode` と追記専用の `payment_receipts` を足し、受領・取消・検索・集計はすべて security definer の RPC（関数内で `can_operate_event` を確認）で行う。フロントは、純粋関数（QR文字列の解析と画面状態の判定）を `src/lib/staffPaymentScan.ts` に置いて node:test で確かめ、受付画面 `PaymentReceiveDesk` を `/staff` のタブと `/admin/payment-receive` の両方で使い回す（Supabase クライアントを props で渡す。管理画面は別セッションのため）。

**Tech Stack:** Next.js 16（App Router, `'use client'` ページ）、React 19、Supabase（Postgres 17, RPC, RLS）、qrcode.react、lucide-react、node:test（Node 22 の型除去で .ts を直接実行）。

**Spec:** `docs/superpowers/specs/2026-11-26-staff-confirmed-payment-design.md`

## Global Constraints

- 管理者・スタッフ用RPCは anon に公開しない（`revoke execute ... from public, anon` → `grant execute ... to authenticated`）。関数の中でも `can_operate_event(event_id)` または `admin_users.user_id = auth.uid()` を確認する。
- 日時の表示・日付の区切りは `Asia/Tokyo` を明示する（SQL は `(ts at time zone 'Asia/Tokyo')::date`、フロントは `src/lib/jst.ts`）。
- 本番DBに反映したら、同じ内容を `supabase/migrations/` に入れる。ファイル名は `list_migrations` が返す本番の version に合わせる。
- 新しい列 `payment_confirm_mode` はフロントでは任意項目として扱う（無ければ `'student_scan'`）。DB反映前でも既存画面が壊れないこと。
- `events.payment_confirm_mode text not null default 'student_scan' check (payment_confirm_mode in ('student_scan','staff'))`。既存企画の動きは変えない。
- 金額は `event_ticket_options.price_yen`（券種がなければ 0）。
- `create_reservation` / `create_walkin_reservation` は触らない（オーバーロード各1個のまま）。
- 既存RPCの引数名・戻り値の形は変えない（`admin_set_reservation_payment_status(uuid, boolean) -> void` など）。返す列を増やしたい既存RPCは変えず、新しいRPCを足す。
- 係の受付画面では学籍番号・氏名で探さない。QR（URL か `public_token` だけ）以外の入力は検索しない。
- 学生がQRを読む今の方式のコードは消さない。`'staff'` の企画でだけ拒否・非表示にする。
- DBのテストはトランザクション内で行い、最後に `rollback` する。
- GitHub Models など外部AIは使わない。

## Review Focus

1. **スキャナーの入力が化ける**：ノートPCの日本語入力がオンのまま（全角になる）、または USB スキャナーの配列設定違いで `:` や `?` が別の記号になる。→ 全角を NFKC で半角にし、文字列の中から UUID の形だけを取り出して検索する（Task 4 と Task 2 のテスト）。
2. **同じ学生が同じ企画に未払いの予約を複数持つ**（複数枠を選べる企画）。→ 1回の読み取りで全部出し、合計金額で一度に受領、記録は予約ごとに1行（Task 2 のテスト）。
3. **同じQRを続けて読む／Enter が2回来る／受領ボタンの連打**。→ 2回目は「支払い済み（今あなたが受領）」。記録は1行だけ（Task 2・Task 4 のテスト、Task 6 で処理中は入力を無視）。
4. **別の企画のQRを見せられる**（学生が予約を2つ持っていて違う方を出す）。→ 「この予約は『◯◯』の予約です」と出し、受領させない（Task 2・Task 4 のテスト）。
5. **ノートPC2台で同じ人を同時に受領**。→ 行ロックで片方だけが受領し、もう片方は `already_paid`（Task 2 のテストで、2人目の係が続けて受領して記録が増えないことを確かめる）。

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `supabase/migrations/20261126000100_staff_confirmed_payment_schema.sql` | 列・テーブル・内部関数・`get_event_payment_confirm_modes`・学生QR方式の拒否 |
| `supabase/migrations/20261126000200_staff_payment_rpcs.sql` | `staff_find_payment_target` / `staff_receive_payment` / `staff_undo_payment` / `staff_get_payment_summary` |
| `supabase/migrations/20261126000300_admin_payment_receipts.sql` | 管理者の既存RPCが記録を残すように変更、`admin_list_payment_receipts` |
| `supabase/tests/staff_confirmed_payment_*.test.sql` | 上の3つそれぞれのテスト（ロールバック前提） |
| `src/lib/staffPaymentScan.ts` | 純粋関数と型（QR解析、QRのURL、画面状態の判定）。import なし |
| `src/lib/staffPaymentScan.test.ts` | node:test |
| `src/lib/staffPaymentRpc.ts` | RPC 呼び出し（クライアントを引数に取る） |
| `src/hooks/useFullscreenOverlay.ts` | 全画面表示の副作用（DynamicPaymentQr から切り出し） |
| `src/components/payment/QrCameraScanner.tsx` | カメラ読み取り部品（PaymentQrScanButton から切り出し） |
| `src/components/payment/ReceptionQrCard.tsx` | 学生の「受付で見せるQR」 |
| `src/components/payment/PaymentReceiveDesk.tsx` | 係の受付画面 |
| `src/components/payment/PaymentReconciliation.tsx` | 照合（係ごとの件数・合計・明細） |
| `src/app/admin/payment-receive/page.tsx` | 管理画面の「支払い受付（係）」 |

---

## DBテストの進め方（Task 1〜3 共通）

本番DBを汚さないため、テストは「マイグレーション本文＋テスト本文」を1つのトランザクションで流し、最後に `rollback` する。Supabase MCP の `execute_sql`（project_id `nbhpsjhqaakaweeywhxa`）に次の内容をそのまま渡す。

```
begin;
<マイグレーション（そのタスクまでの全部）>
<テストファイル>
rollback;
```

組み立ては `{ echo 'begin;'; cat <migrations...>; cat <test>; echo 'rollback;'; } > <scratchpad>/q.sql` で作り、中身を渡す。**赤の確認**はマイグレーション抜き（テストだけ）で流す。

テストファイルは、`supabase/tests/staff_confirmed_payment_fixtures.sql`（Task 1 で作る）を先頭に連結して使う。フィクスチャは次の方針で書く（トリガーを止めて直接入れ、RPC を呼ぶ前に戻す）。

```sql
set local session_replication_role = replica;  -- 学籍番号検証などのトリガーを止める（このトランザクションだけ）
-- auth.users: a1=管理者, a2=係A(staff), a3=係B(staff), a4=担当外の学生, a5=予約者の学生
-- 学生（a4, a5）のメールは redeem_payment_qr の形 s99z001@ge.osaka-sandai.ac.jp などにし、a5 の予約の university_email・user_id もそれに合わせる
insert into auth.users(id, email, email_confirmed_at, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1','t-admin@example.com', now(),'authenticated','authenticated'), ...;
insert into public.admin_users(user_id) values ('00000000-0000-4000-8000-0000000000a1');
insert into public.staff_members(id, email, display_name) values (..., 't-staff-a@example.com', '係A'), (..., 't-staff-b@example.com', '係B');
-- 企画 E1（staff 方式, payment_required）, E2（student_scan 方式）, E3（staff 方式, 係Aの担当外）
-- staff_event_access：係A・係B は E1 と E2 を担当（E3 は担当外）。券種 O1（E1, 1500円）, O2（E1, 1000円）
-- 予約（public_token・ticket_code は固定値を明示。status='reserved', payment_status='pending', payment_due_at=now()+1h）:
--   R1: a5, E1, O1 / R2: a5, E1, O2（同じ人の2件目） / R3: 別の学生, E1, O1
--   R4: a5, E2 / R5: E3 / R6: E1, status='cancelled', payment_status='expired'
set local session_replication_role = origin;
-- 呼び出し者の切り替え：
--   select set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true); set local role authenticated;
--   戻すとき：reset role;
```

失敗するはずの呼び出しは次の形で確かめる。

```sql
do $$ declare ok boolean := false; begin
  begin perform public.staff_receive_payment(array['<R5>'::uuid]); exception when others then ok := sqlerrm like '%権限%'; end;
  assert ok, '担当外の企画は拒否される';
end $$;
```

各テストファイルの最後は `select '<ファイル名> passed' as result;`。これが返れば合格。

---

### Task 1: スキーマ、記録用の内部関数、学生QR方式の拒否

**Files:**
- Create: `supabase/migrations/20261126000100_staff_confirmed_payment_schema.sql`
- Create: `supabase/tests/staff_confirmed_payment_fixtures.sql`
- Create: `supabase/tests/staff_confirmed_payment_schema.test.sql`

**Interfaces:**
- Produces:
  - 列 `events.payment_confirm_mode`（Global Constraints のとおり）
  - テーブル `public.payment_receipts(id uuid pk default gen_random_uuid(), event_id uuid not null → events on delete cascade, reservation_id uuid not null → reservations on delete cascade, action text not null check in ('received','undone'), amount_yen integer not null check (>= 0), operator_user_id uuid → auth.users on delete set null, operator_name text, reverses_receipt_id uuid → payment_receipts on delete set null, created_at timestamptz not null default now(), check (action = 'undone' or reverses_receipt_id is null))`
    - `reverses_receipt_id` は設計書の表にない追加列。取り消しが「だれの受領」を打ち消すかを持たせ、照合で受け取った人の合計から引くため。
    - インデックス：`(event_id, created_at)`、`(reservation_id, created_at desc)`、`(operator_user_id) where not null`、`(reverses_receipt_id) where not null`
    - RLS 有効、ポリシーなし、`revoke all ... from anon, authenticated`。
  - `public.current_operator_name() returns text`（security definer, stable）：スタッフなら `staff_members.display_name`、なければ `auth.users.email`。public/anon/authenticated から実行権を外す。
  - `public.log_payment_receipt(p_reservation_id uuid, p_action text, p_reverses_receipt_id uuid default null) returns uuid`（security definer）：`event_id` と金額を予約から取り、`operator_user_id = auth.uid()`、`operator_name = current_operator_name()` で1行入れて id を返す。`undone` の金額は打ち消す受領の `amount_yen`、受領がなければ今の券種の金額。public/anon/authenticated から実行権を外す。
  - `public.get_event_payment_confirm_modes(p_event_ids uuid[]) returns table(event_id uuid, payment_confirm_mode text)`（security definer, stable）：配列が101件以上なら例外。authenticated のみ実行可。
  - `claim_payment_qr(text, text)` と `redeem_payment_qr(text, text)`：本文の先頭で、トークンの企画が `'staff'` なら `raise exception 'この企画では受付の係が支払いを確認します。受付の係にこの画面ではなく「自分の予約」のQRを見せてください。'`。本文は本番の `pg_get_functiondef` をそのまま写して先頭に判定を足すだけ（1引数版は2引数版を呼ぶので変更不要）。

- [ ] **Step 1: フィクスチャと失敗するテストを書く**

`staff_confirmed_payment_schema.test.sql` のテスト：
- `select payment_confirm_mode from events where id = <E2>` が `'student_scan'`（既定値）。
- `update events set payment_confirm_mode = 'other'` が check 違反になる。
- 係A として `get_event_payment_confirm_modes(array[E1,E2])` が `{E1:'staff', E2:'student_scan'}` を返す。
- 係A として `select * from payment_receipts` が権限エラーになる。
- 学生 a5 として、E1 の有効な1日QR（フィクスチャで `payment_qr_codes` に mode='daily', is_active, valid_from=now()-1h, valid_until=now()+1h を入れる）で `redeem_payment_qr(token, null)` が「受付の係が支払いを確認します」を含む例外。`claim_payment_qr(token, null)` も同じ。R1 は `pending` のまま。
- 同じ条件で E2 の1日QRなら `redeem_payment_qr` が成功し R4 が `paid`（既存の動きを壊していない）。
- `has_function_privilege('anon','public.get_event_payment_confirm_modes(uuid[])','execute') = false`、`has_function_privilege('authenticated','public.log_payment_receipt(uuid,text,uuid)','execute') = false`。

- [ ] **Step 2: テストだけを流して失敗を確かめる**

Expected: `column "payment_confirm_mode" ... does not exist` などで失敗。

- [ ] **Step 3: マイグレーションを書く**（上の Produces のとおり）

- [ ] **Step 4: マイグレーション＋テストを流して通す**

Expected: `staff_confirmed_payment_schema.test.sql passed`。

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261126000100_staff_confirmed_payment_schema.sql supabase/tests/
git commit -m "支払いの確認方法の切り替えと受領記録のテーブルを追加"
```

---

### Task 2: 係の受付RPC（検索・受領・取消・集計）

**Files:**
- Create: `supabase/migrations/20261126000200_staff_payment_rpcs.sql`
- Create: `supabase/tests/staff_confirmed_payment_rpcs.test.sql`

**Interfaces:**
- Consumes: Task 1 の `log_payment_receipt`, `payment_receipts`, `payment_confirm_mode`、既存の `can_operate_event(uuid)`, `payment_due_grace()`。
- Produces（すべて security definer、`set search_path to 'public'`、authenticated のみ実行可）：

`staff_find_payment_target(p_event_id uuid, p_query text) -> jsonb`
- `p_query` を `normalize(p_query, NFKC)` → `lower` → 最初の `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` を取り出し、`reservations.public_token` で引く。取れない・見つからない → `{"status":"not_found"}`。
- `p_event_id` があれば先に `can_operate_event(p_event_id)` を確認（だめなら `'この企画の支払いを受け付ける権限がありません。'`）。予約の企画が違えば、その企画も操作できるときだけ `{"status":"other_event","event_id","event_title"}`、できなければ `not_found`。
- `p_event_id` が null なら、予約の企画で `can_operate_event` を確認（同じ例外文）。カメラアプリで `/staff?r=` を開いたときに使う。
- 企画が `'staff'` 方式でなければ `'この企画は学生がQRを読む方式です。受付画面では受け付けられません。'`。
- 同じ人（`user_id` が同じ。null なら `student_number` が同じ）のその企画の `status <> 'cancelled'` の予約を集める。0件なら `{"status": "expired"|"cancelled", "student_name", "student_number"}`（読んだ予約の `payment_status='expired'` なら expired）。
- 見つかれば：
```json
{"status":"found","event_id":"…","event_title":"…","student_name":"…","student_number":"…",
 "pending_total_yen":2500,
 "reservations":[{"reservation_id":"…","ticket_option_label":"大トロ付き","amount_yen":1500,
   "slot_label":"…","slot_starts_at":"…","status":"reserved","payment_status":"pending",
   "payment_due_at":"…","paid_at":null,"received_at":null,"received_by_name":null,"received_by_me":false,
   "visit_starts_at":null,"visit_ends_at":null,"visit_location":null}]}
```
  `received_*` は、その予約の最新の記録が `received` のときだけ入る（学生QRで支払い済みなら null で `paid_at` だけ）。

`staff_receive_payment(p_reservation_ids uuid[]) -> jsonb`
- 空・null・21件以上は例外。`select … for update`（id 順）でロック。全件が同じ企画であること、`can_operate_event`、`'staff'` 方式を確認。
- `status='reserved' and payment_status='pending'` だけを `paid, paid_at=now(), payment_confirmed_by=auth.uid()` にし、1件ずつ `log_payment_receipt(id,'received')`。
- 返り値：`{"received":[{"reservation_id","amount_yen"}],"already_paid":[{"reservation_id","paid_at","received_by_name"}],"unavailable":["<id>"],"received_count":2,"received_total_yen":2500}`

`staff_undo_payment(p_reservation_id uuid) -> jsonb`
- ロック → `can_operate_event`。`status='used'` なら `'チケット使用済みのため取り消せません。'`、`payment_status<>'paid'` なら `'支払い済みの予約ではありません。'`。
- 打ち消す受領 = その予約の `received` のうち、まだ `undone` に指されていない最新の行。
- 管理者でなければ、その受領の `operator_user_id = auth.uid()` かつ `(created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date` でないと `'取り消せるのは、自分が今日受け取った分だけです。管理者に依頼してください。'`。
- `payment_status='pending', paid_at=null, payment_confirmed_by=null`（期限が過ぎていても `pending`。キャンセルは毎分の `expire_unpaid_reservations` に任せる）。`log_payment_receipt(id,'undone', <受領id or null>)`。
- 返り値：`{"reservation_id","amount_yen","will_expire": payment_due_at + payment_due_grace() <= now()}`

`staff_get_payment_summary(p_event_id uuid, p_date date default null) -> jsonb`
- `can_operate_event` を確認。日付は `coalesce(p_date, 今日JST)`。管理者でなく今日以外なら `'スタッフは今日の分だけ確認できます。'`。
- 帰属（その記録の金額をだれの現金に数えるか）：`received` は操作した人、`undone` は打ち消した受領の操作した人。打ち消す受領がない `undone` は帰属なし（「記録外の取消」）。
- スタッフには帰属が自分の行だけ、管理者には全部を返す。
```json
{"date":"2026-11-26",
 "operators":[{"operator_user_id","operator_name","received_count","received_yen","undone_count","undone_yen","net_count","net_yen"}],
 "total":{"net_count","net_yen"},
 "items":[{"receipt_id","created_at","action","reservation_id","student_name","student_number","ticket_option_label","amount_yen","operator_name","attributed_user_id","reversed":true}]}
```
  `items` は新しい順。`reversed` はその `received` が後で打ち消されたか。帰属なしの取消は `operators` に `operator_user_id: null, operator_name: '（記録外の取消）'` として出し、`total` からは除く。

- [ ] **Step 1: 失敗するテストを書く**（`staff_confirmed_payment_rpcs.test.sql`）
  - 担当外：学生 a4 が `staff_find_payment_target(E1, R1のtoken)` → 権限エラー。係A が E3 の R5 を `staff_receive_payment` → 権限エラー。
  - 入力の正規化：係A が `staff_find_payment_target(E1, '  https://x/staff?r=' || upper(R1のtoken) || '  ')` と、全角に変えたトークン（`translate` で `0-9a-f-` を `０-９ａ-ｆ－` に）で、どちらも `status='found'`。`'24B123'` では `not_found`。
  - 複数予約：R1 を引くと `reservations` に R1・R2 があり R3 はなく、`pending_total_yen = 2500`。
  - 別企画：`staff_find_payment_target(E1, R4のtoken)` → `status='other_event'`。`staff_find_payment_target(E2, R4のtoken)` → `'学生がQRを読む方式'` の例外。
  - キャンセル済み：R6 → `status='expired'`。
  - 受領：係A が `staff_receive_payment(array[R1,R2])` → `received_count=2, received_total_yen=2500`。R1・R2 が `paid` で `payment_confirmed_by = a2`。`payment_receipts` に `received` が2行、`operator_name='係A'`、金額 1500 / 1000。
  - 二重：続けて係B が `staff_receive_payment(array[R1])` → `received_count=0`、`already_paid[0].received_by_name='係A'`。記録は2行のまま。
  - `staff_find_payment_target(E1, R1)` を係A で → `received_by_me=true`、係B で → `false`。
  - 取消：係B が R1 を `staff_undo_payment` → 「自分が今日受け取った分だけ」の例外。係A が取り消す → R1 が `pending`、`undone` 行の `reverses_receipt_id` が R1 の受領 id、`will_expire=false`。もう一度取り消す → `'支払い済みの予約ではありません。'`。
  - 前日の受領：R2 の受領行の `created_at` を `now() - interval '1 day'` に書き換え（postgres で）→ 係A の取消は拒否、管理者 a1 の取消は成功。
  - 期限切れ間近：R3 を係A が受領 → `payment_due_at = now() - interval '10 minutes'` に書き換え → 係A が取り消すと `will_expire=true`、R3 は `reserved/pending` のまま。
  - 集計：係A の `staff_get_payment_summary(E1)` は `operators` が係Aだけ。係A の R1 受領1500・取消1500、R3 受領1000・取消1000 → `net_count=0, net_yen=0`。管理者の集計には R2 の取消（打ち消された受領は係A、前日）が今日の係A の帰属として出る。係A が `p_date = 昨日` → `'今日の分だけ'` の例外、管理者は成功。
  - `has_function_privilege('anon', …, 'execute')` が4つとも false。

- [ ] **Step 2: Task 1 のマイグレーション＋このテストを流して失敗を確かめる**

Expected: `function public.staff_find_payment_target(uuid, text) does not exist`。

- [ ] **Step 3: マイグレーションを書く**（上の Produces のとおり）

- [ ] **Step 4: Task 1・2 のマイグレーション＋Task 1・2 のテストを流して通す**

Expected: 最後の行が `staff_confirmed_payment_rpcs.test.sql passed`（途中の assert が1つでも失敗すればエラーで止まる）。

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261126000200_staff_payment_rpcs.sql supabase/tests/staff_confirmed_payment_rpcs.test.sql
git commit -m "係の支払い受付RPC（検索・受領・取消・集計）を追加"
```

---

### Task 3: 管理画面からの支払い変更も記録する

**Files:**
- Create: `supabase/migrations/20261126000300_admin_payment_receipts.sql`
- Create: `supabase/tests/staff_confirmed_payment_admin.test.sql`

**Interfaces:**
- Consumes: `log_payment_receipt`、Task 2 の「打ち消す受領」の決め方。
- Produces:
  - `admin_set_reservation_payment_status(p_reservation_id uuid, p_paid boolean) -> void`：引数・戻り値・今の動き（未払いに戻すとき期限切れなら `expired`）はそのまま。変更前の `payment_status` を行ロックして読み、`p_paid` で `paid` 以外→`paid` になったときだけ `received` を記録、`p_paid=false` で `paid`→それ以外になったときだけ `undone`（打ち消す受領は Task 2 と同じ決め方、なければ null）を記録。すでに支払い済みを支払い済みにしても `paid_at` を上書きせず記録も増やさない。
  - `admin_create_reservation_for_user(...)`：本番の定義を写し、`p_paid` で支払い済みにした直後に `perform public.log_payment_receipt(v_res.id, 'received');` を足すだけ。
  - `admin_list_payment_receipts(p_event_id uuid) returns table(reservation_id uuid, last_received_at timestamptz, last_received_by text, undone_count integer)`：管理者のみ（関数内で `admin_users` を確認）。`last_received_*` はまだ打ち消されていない最新の受領。

- [ ] **Step 1: 失敗するテストを書く**
  - 管理者が R3 を `admin_set_reservation_payment_status(R3, true)` → `received` 1行、`operator_name='t-admin@example.com'`。もう一度 true → 行は増えず `paid_at` も変わらない。
  - false → `undone` 1行、`reverses_receipt_id` が上の受領。
  - 学生QRで支払い済みにした R4（記録なし）を false → `undone` 1行で `reverses_receipt_id is null`。`staff_get_payment_summary(E2)`（管理者）でそれが `operator_user_id = null` の行に出て `total` に入らない。
  - `admin_list_payment_receipts(E1)` が R3 の `undone_count=1`。係A が呼ぶと `'管理者権限が必要です。'`。
  - `admin_create_reservation_for_user` で `p_paid=true` → `received` 1行（フィクスチャに `user_profiles` の行を足す）。

- [ ] **Step 2: Task 1〜2 のマイグレーション＋このテストで失敗を確かめる**（記録が0行で assert 失敗）

- [ ] **Step 3: マイグレーションを書く**

- [ ] **Step 4: Task 1〜3 のマイグレーション＋3つのテストで通す**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261126000300_admin_payment_receipts.sql supabase/tests/staff_confirmed_payment_admin.test.sql
git commit -m "管理画面からの支払い変更も受領記録に残す"
```

---

### Task 4: QR解析と画面状態の判定（純粋関数）、テストの仕組み

**Files:**
- Create: `src/lib/staffPaymentScan.ts`
- Create: `src/lib/staffPaymentScan.test.ts`
- Modify: `tsconfig.json`（`"allowImportingTsExtensions": true` を追加。`noEmit` なので可）
- Modify: `package.json`（`"test": "node --test 'src/**/*.test.ts'"`（Node 22 は .ts の型を外して直接実行できる））
- Modify: `.github/workflows/student-account-check.yml`（Lint の後に `- name: Unit tests` / `run: npm test`）

**Interfaces:**
- Produces（`src/lib/staffPaymentScan.ts`、import なし）：
  - `type PaymentConfirmMode = 'student_scan' | 'staff'`
  - `type FindReservation`, `type FindResult`（Task 2 の JSON の形そのまま。`status: 'found'|'not_found'|'other_event'|'expired'|'cancelled'`）
  - `type ReceiveResult`, `type UndoResult`, `type PaymentSummary`（Task 2 の形）
  - `reservationTokenFromScan(text: string): string | null` — `text.normalize('NFKC').toLowerCase()` から最初の UUID を返す。
  - `staffPaymentQrUrl(origin: string, publicToken: string): string` — `${origin}/staff?r=${encodeURIComponent(publicToken)}`
  - `type DeskView = { kind: 'not_a_qr' } | { kind: 'not_found' } | { kind: 'other_event'; eventTitle: string } | { kind: 'unavailable'; reason: 'expired' | 'cancelled'; studentName: string } | { kind: 'pending'; studentName: string; studentNumber: string; reservationIds: string[]; totalYen: number; reservations: FindReservation[]; paidCount: number } | { kind: 'already_paid'; studentName: string; studentNumber: string; byMe: boolean; receivedAt: string | null; receivedByName: string | null; paidAt: string | null }`
  - `deskViewFromFind(result: FindResult): DeskView` — `status='found'` で `payment_status='pending' && status='reserved'` が1件以上なら `pending`（`paidCount` は支払い済みの件数）、なければ `already_paid`（最新の `paid_at` の予約を使う）。

- [ ] **Step 1: テストを書く**（`import { … } from './staffPaymentScan.ts'`、`node:test` と `node:assert/strict`）
  - `reservationTokenFromScan('https://example.com/staff?r=4dee369c-003c-4568-9dcb-8802fc4923c3')` → `'4dee369c-003c-4568-9dcb-8802fc4923c3'`
  - 全角：`'ｈｔｔｐｓ：／／ｅｘ／ｓｔａｆｆ？ｒ＝４ＤＥＥ３６９Ｃ－００３Ｃ－４５６８－９ＤＣＢ－８８０２ＦＣ４９２３Ｃ３'` → 同じ UUID
  - 記号が化けた URL：`'https*//example.com/staff_r=4dee369c-003c-4568-9dcb-8802fc4923c3\n'` → 同じ UUID
  - `'24B123'`、`''`、`'4dee369c-003c'` → `null`
  - `staffPaymentQrUrl('https://a.b', 't')` → `'https://a.b/staff?r=t'`
  - `deskViewFromFind`：`not_found` → `not_found`、`other_event` → `eventTitle`、`expired` → `unavailable`、未払い2件（1500+1000）＋支払い済み1件 → `pending` で `totalYen=2500, paidCount=1, reservationIds` が未払いの2件、全部支払い済みで `received_by_me=true` → `already_paid` で `byMe=true`、学生QRで支払い済み（`received_at=null`）→ `already_paid` で `receivedByName=null, paidAt` あり。

- [ ] **Step 2: `npm test` で失敗を確かめる**（Expected: モジュールが見つからない）

- [ ] **Step 3: 実装する**

- [ ] **Step 4: `npm test` と `npx tsc --noEmit -p .` と `npm run lint` が通る**

- [ ] **Step 5: Commit**

```bash
git add src/lib/staffPaymentScan.ts src/lib/staffPaymentScan.test.ts tsconfig.json package.json .github/workflows/student-account-check.yml
git commit -m "受付QRの解析と受付画面の状態判定を追加（node:testで確認）"
```

---

### Task 5: RPC呼び出し、カメラ読み取りと全画面表示の切り出し

**Files:**
- Create: `src/lib/staffPaymentRpc.ts`
- Create: `src/components/payment/QrCameraScanner.tsx`
- Create: `src/hooks/useFullscreenOverlay.ts`
- Modify: `src/components/payment/PaymentQrScanButton.tsx`（中身を `QrCameraScanner` に置き換え）
- Modify: `src/components/payment/DynamicPaymentQr.tsx:115-189`（`useFullscreenOverlay` に置き換え）

**Interfaces:**
- Consumes: Task 4 の型。
- Produces:
  - `staffPaymentRpc.ts`（引数 `client: SupabaseClient`。エラーは `{ data: null, error: string }`、成功は `{ data: T, error: null }` の形 `RpcResult<T>` で返す）：
    - `findPaymentTarget(client, eventId: string | null, query: string): Promise<RpcResult<FindResult>>`
    - `receivePayment(client, reservationIds: string[]): Promise<RpcResult<ReceiveResult>>`
    - `undoPayment(client, reservationId: string): Promise<RpcResult<UndoResult>>`
    - `getPaymentSummary(client, eventId: string, date?: string): Promise<RpcResult<PaymentSummary>>`
    - `getPaymentConfirmModes(client, eventIds: string[]): Promise<Record<string, PaymentConfirmMode>>` — エラー時・RPC がない時は `{}`（呼び出し側は無い企画を `'student_scan'` とみなす）。
  - `QrCameraScanner({ title, fallbackHint, rejectHint, onDetect, onClose }: { title: string; fallbackHint: string; rejectHint: string; onDetect: (text: string) => boolean; onClose: () => void })` — 今の `PaymentQrScanner` の中身。`onDetect` が true なら止めて閉じる側に任せ、false なら `rejectHint` を出して読み続ける。カメラのエラー文の「スマホのカメラアプリで…」の部分は `fallbackHint` にする。
  - `useFullscreenOverlay(open: boolean, onClose: () => void): void` — 今の DynamicPaymentQr の effect（スクロール固定、Wake Lock、requestFullscreen、Esc、fullscreenchange で閉じる）。

- [ ] **Step 1: 切り出しと RPC ファイルを書く。PaymentQrScanButton は `onDetect={(text) => { const token = paymentTokenFromQr(text, location.origin); if (token) location.assign(`/pay?token=${encodeURIComponent(token)}`); return Boolean(token); }}` で今と同じ動きにする**

- [ ] **Step 2: `npx tsc --noEmit -p .`、`npm run lint`、`npm test`、`npm run build` が通る**（切り出しだけで動きは変えない。既存画面の確認は Task 9）

- [ ] **Step 3: Commit**

```bash
git add src/lib/staffPaymentRpc.ts src/components/payment/ src/hooks/useFullscreenOverlay.ts
git commit -m "カメラ読み取りと全画面表示を部品に切り出し、受付RPCの呼び出しを追加"
```

---

### Task 6: 係の受付画面 `PaymentReceiveDesk` と照合 `PaymentReconciliation`

**Files:**
- Create: `src/components/payment/PaymentReceiveDesk.tsx`
- Create: `src/components/payment/PaymentReconciliation.tsx`

**Interfaces:**
- Consumes: Task 4 の `reservationTokenFromScan`, `deskViewFromFind`、Task 5 の RPC と `QrCameraScanner`、`formatJstDateTime`、`formatYen`、`formatVisitSlot`, `visitSlotPlace`。
- Produces:
  - `PaymentReceiveDesk({ client, eventId, isAdmin, initialQuery }: { client: SupabaseClient; eventId: string; isAdmin: boolean; initialQuery?: string | null })`
  - `PaymentReconciliation({ client, eventId, isAdmin }: { client: SupabaseClient; eventId: string; isAdmin: boolean })`

`PaymentReceiveDesk` の決まりごと（設計書「5. 係の画面」のとおり。以下は設計書で決まっていない部分の決定）：
- 入力欄は `<input type="text" autoComplete="off" spellCheck={false}>`。表示時・処理後・結果を閉じた後に `focus()`。Enter で送る。送ったら欄を空にする。
- `reservationTokenFromScan` が null なら RPC を呼ばず「QRコードをスキャナーで読んでください（学籍番号・氏名では探せません）」。
- 検索中・受領中は新しい入力を無視する（`busy` の ref）。受領ボタンは押したら無効にする。
- `pending` を表示中に次のQRが読まれたら、前の人を直前リストに「未受領（読んだだけ）」として残し、その行に「受け取った」ボタンを出す（押し忘れ対策）。
- `pending`：氏名・学籍番号・券種ごとの行・合計を大きく出し、ボタン文言は `${formatYen(totalYen)} 受け取った`。`paidCount > 0` なら「ほかに支払い済みが n 件あります」。支払い受付枠があれば枠を出し、今が枠の外なら「予定の時間外です（受け取りはできます）」。
- `already_paid`：赤の帯。`byMe` なら「支払い済み（今あなたが受領 HH:mm）」、名前があれば「HH:mm に◯◯さんが受領済み。受け取らないでください」、名前がなければ「支払い済み（HH:mm、学生のQR読み取りまたは管理画面）。受け取らないでください」。
- `unavailable`：「期限切れでキャンセルされています／キャンセル済みです。受領できません。管理者に回してください」。`other_event`：「この予約は『{eventTitle}』の予約です。正しい予約のQRを出してもらってください」。`not_found`：「この企画の予約が見つかりません」。
- 受領成功：緑の帯「受領しました {formatYen(received_total_yen)}」。`already_paid` が返った分は赤の帯で並べて出す。
- 画面下：`getPaymentSummary(client, eventId)` の自分の行（管理者は自分の `operator_user_id` の行。`client.auth.getUser()` で uid を取る）の `net_count` 件・`net_yen`、`items` の先頭5件。`received` かつ `reversed=false` の行に「取消」→ `window.confirm('{氏名} {金額} の受領を取り消します。よろしいですか？')` → `undoPayment`。`will_expire` なら「支払い期限を過ぎているため、1分以内に自動キャンセルされます」を出す。受領・取消のあとに集計を読み直す。
- 「照合を見る」で `PaymentReconciliation` を開閉。
- `initialQuery` があれば最初に1回だけそれで検索する。
- 予備のカメラボタン（「📷 読む」）：`QrCameraScanner` を `onDetect={(t) => Boolean(reservationTokenFromScan(t))}` で開き、読めたら閉じてその文字列で検索。

`PaymentReconciliation`：
- 管理者だけ日付入力（既定は `todayJst()`）。スタッフは今日固定。
- 係ごとの表（受領 件・円、取消 件・円、差し引き 件・円）、合計、明細（時刻 JST・氏名・学籍番号・券種・金額・受領/取消・操作した人）。取り消された受領は打ち消し線。
- 「現金の合計がこの金額と合うか確認してください」の一文。

- [ ] **Step 1: 2つの部品を書く**
- [ ] **Step 2: `npx tsc --noEmit -p .`、`npm run lint`、`npm test` が通る**
- [ ] **Step 3: Commit**

```bash
git add src/components/payment/PaymentReceiveDesk.tsx src/components/payment/PaymentReconciliation.tsx
git commit -m "係の支払い受付画面と照合画面を追加"
```

---

### Task 7: 画面への組み込み（/staff、管理画面、学生の予約一覧、企画の編集）

**Files:**
- Modify: `src/app/staff/page.tsx`
- Create: `src/app/admin/payment-receive/page.tsx`
- Modify: `src/components/AdminNav.tsx`
- Modify: `src/app/admin/payment-qr/page.tsx`、`src/app/admin/daily-payment-qr/page.tsx`
- Create: `src/components/payment/ReceptionQrCard.tsx`
- Modify: `src/components/MyTicketsList.tsx`
- Modify: `src/components/admin/AdminEditEventPage.tsx`（読み込み ~159行、保存 ~549行、支払いの節 ~1397行）

**Interfaces:**
- Consumes: Task 5 の `getPaymentConfirmModes`, `findPaymentTarget`, `useFullscreenOverlay`、Task 4 の `staffPaymentQrUrl`、Task 6 の `PaymentReceiveDesk`。
- Produces: `ReceptionQrCard({ eventTitle, publicToken, totalYen }: { eventTitle: string; publicToken: string; totalYen: number | null })`

内容：
- **/staff**：企画一覧を読んだあと `getPaymentConfirmModes` で方式を取る。タブに `{ id: 'receive', label: '支払い受付', icon: ScanLine }` を足し、`payment_required && mode==='staff'` のとき有効。動的QR・1日QRは `payment_required && mode!=='staff'` のときだけ有効。`useQueryParam('r')` があれば `findPaymentTarget(supabase, null, r)` を呼び、返った `event_id`（`found`/`expired`/`cancelled` のとき）を選んで `receive` タブにし、`initialQuery={r}` を渡す。例外（権限なし）はエラー帯に出す。未ログイン時のログインリンクの `next` は `/staff` に今のクエリを付けたものにする。説明文の「予約者の個人情報は表示されません」は、`receive` タブがある企画では「支払い受付では、読み取った予約者の氏名・学籍番号が表示されます」に変える。
- **/admin/payment-receive**：`useAdminAuth` と `AdminNav` を使い、`adminSupabase.from('events').select('*').eq('payment_required', true)` から `payment_confirm_mode === 'staff'` の企画だけ選択肢にする。0件なら「受付の係が確認する企画はありません。企画の編集で『受付の係が確認する』を選んでください」。`<PaymentReceiveDesk client={adminSupabase} eventId isAdmin />`。
- **AdminNav**：`['/admin/payment-receive', ScanLine, '支払い受付（係）']` を「支払い管理」の次に追加。
- **管理の動的QR・1日QR**：`select('*')` にして `payment_confirm_mode === 'staff'` の企画を選択肢から外し、外した企画があれば「受付の係が確認する企画（n件）は『支払い受付（係）』で受け付けます」と出す。
- **ReceptionQrCard**：見出し「受付で見せるQR」、企画名、`totalYen` があれば「{formatYen} を受付で払ってください」、`QRCodeSVG value={staffPaymentQrUrl(window.location.origin, publicToken)} size={240} level="M" includeMargin`（`qr-frame qr-frame-button` のボタンで包む）、「タップすると大きく表示します」。全画面は既存の `qr-fullscreen` のクラスと `useFullscreenOverlay` で、閉じるボタンだけ（作り直しボタンはなし）。
- **MyTicketsList**：`MyTicket` に `event_id: string; public_token: string` を足す（`get_my_tickets` はすでに返している）。予約を読んだら `getPaymentConfirmModes` を呼ぶ。`status='reserved' && payment_status='pending'` で方式が `'staff'` の予約を企画ごとにまとめ、企画ごとに1枚 `ReceptionQrCard`（トークンは最初の予約、金額はその企画の未払いの合計。券種の金額が1件も無ければ null）を一覧の上に出す。`PaymentQrScanButton` とその説明は、方式が `'staff'` でない未払いがあるときだけ出す。
- **企画の編集**：`const [paymentConfirmMode, setPaymentConfirmMode] = useState<PaymentConfirmMode | null>(null)`。読み込みで `data.payment_confirm_mode ?? null`。保存では `...(paymentConfirmMode ? { payment_confirm_mode: paymentRequired ? paymentConfirmMode : 'student_scan' } : {})`。支払いの節の `PaymentVisitSettings` の下に、`paymentRequired && paymentConfirmMode` のときラジオ「支払いの確認方法：学生がQRを読む（今まで）／受付の係が確認する（係が学生のQRをスキャナーで読む）」。

- [ ] **Step 1: 上の変更を書く**
- [ ] **Step 2: `npx tsc --noEmit -p .`、`npm run lint`、`npm test`、`npm run build` が通る**
- [ ] **Step 3: Commit**

```bash
git add src/app/staff/page.tsx src/app/admin/ src/components/AdminNav.tsx src/components/payment/ReceptionQrCard.tsx src/components/MyTicketsList.tsx src/components/admin/AdminEditEventPage.tsx
git commit -m "受付の係が確認する方式を係の画面・管理画面・予約一覧・企画の編集に組み込む"
```

---

### Task 8: 支払い管理に検索・受領者・係ごとの集計を出す

**Files:**
- Create: `src/lib/reservationSearch.ts`
- Create: `src/lib/reservationSearch.test.ts`
- Modify: `src/app/admin/payment-management/page.tsx`

**Interfaces:**
- Consumes: Task 3 の `admin_list_payment_receipts`、Task 6 の `PaymentReconciliation`。
- Produces: `matchesReservationSearch(row: { student_name: string; student_number: string; university_email: string }, query: string): boolean` — `query.trim().toLowerCase()` が空なら true、そうでなければ3項目のどれかの小文字に含まれるか。

- [ ] **Step 1: テストを書く** — `'  S23X1 '` が学籍番号 `s23x123` に一致、`'TANAKA'` がメール `tanaka@…` に一致、`'田中'` が氏名に一致、`'zzz'` は不一致、`''` は一致。
- [ ] **Step 2: `npm test` で失敗を確かめる**
- [ ] **Step 3: 実装し、ページを変える**
  - 検索欄（`type="search"`、placeholder「氏名・学籍番号・大学メールで検索...」）を企画の選択の下に置く。企画を変えたら空にする。
  - 検索中（trim 後が空でない）は `scopedRows = rows.filter(r => matchesReservationSearch(r, q))` とし、日付・受付枠・支払日の絞り込みと、その見出し部分を出さない（「検索中は日付・受付枠の絞り込みを使いません」と一言）。状態ボタンと並べ替えはそのまま。
  - `loadRows` と同時に `admin_list_payment_receipts(eventId)` を読み、`Map<reservation_id, row>` にする（エラーなら空の Map で続ける）。表に「受領」列：`last_received_at` があれば `formatJstDateTime(last_received_at)` と `last_received_by`、`undone_count > 0` なら「取消あり」バッジ。
  - `<details>`「係ごとの受領（照合）」の中に `<PaymentReconciliation client={supabase} eventId={eventId} isAdmin />`。
  - 支払い済み／未払いへの変更後に受領記録も読み直す。
- [ ] **Step 4: `npm test`、`npx tsc --noEmit -p .`、`npm run lint` が通る**
- [ ] **Step 5: Commit**

```bash
git add src/lib/reservationSearch.ts src/lib/reservationSearch.test.ts src/app/admin/payment-management/page.tsx
git commit -m "支払い管理に予約者の検索・受領者・係ごとの集計を追加"
```

---

### Task 9: 本番DBへの反映とリリース

**Files:**
- Rename: `supabase/migrations/20261126000{1,2,3}00_*.sql` → 本番の version に合わせた名前

- [ ] **Step 1: 3つのマイグレーション＋3つのテストを1トランザクションで流し、最後の行が `staff_confirmed_payment_admin.test.sql passed` であることを確かめる（rollback）**
- [ ] **Step 2: `apply_migration` で3つを順に本番へ反映**（name は `staff_confirmed_payment_schema`, `staff_payment_rpcs`, `admin_payment_receipts`）。`list_migrations` で version を確かめ、ローカルのファイル名をそれに変える。
- [ ] **Step 3: AGENTS.md の確認**
  - `select count(*) from pg_proc where proname = 'create_reservation'` と `create_walkin_reservation` がそれぞれ 1。
  - `claim_payment_qr` / `redeem_payment_qr` がそれぞれ 2（1引数・2引数。変わっていないこと）。
  - 新しい関数すべてで `has_function_privilege('anon', …, 'execute') = false`。
  - 本番の `pg_get_functiondef` と、リポジトリの最新マイグレーションの定義が一致する。
  - `get_advisors`（security と performance）で、今回の追加分に新しい警告が出ていない（`payment_receipts` の RLS ポリシーなしは意図どおり。INFO なら説明を PR に書く）。
- [ ] **Step 4: 本番の動きを1回確かめる** — Step 1 のテスト一式をもう一度、今度はマイグレーション抜きで流して `passed`（本番の定義でテストが通る）。
- [ ] **Step 5: 画面の確認** — `npm run dev` を起動し、Playwright で `/staff`（未ログインの説明とログインリンクの `next` に `r` が残ること）と `/staff?r=…` を開いてエラーにならないことを確認。ログインが要る画面は、Supabase のテスト用セッションがないため、受付画面の操作はこの段階では手で見られない。PR に「マグロ企画で切り替える前に、係のアカウントで1件ずつ受領→取消→照合を試す」手順を書く。
- [ ] **Step 6: push、PR を作る、CI が通ったら main にマージ**（AGENTS.md「本番への反映」のとおり、確認を待たない）。PR 本文に、企画を `'staff'` に切り替えるのは管理者が企画の編集で行うこと、既定は今の方式のままであることを書く。

---

## 設計書で「実装で決めること」とした点の決定

- `/staff/receive` という別ページは作らない。学生のQRは `/staff?r=<public_token>` を指し、`/staff` が `r` を見て受付タブを開く（係の確認処理を1か所にするため）。管理者は別セッションなので `/admin/payment-receive` で同じ部品を使う。
- RPC の返り値は Task 2 の JSON のとおり。
- Excel 出力（`reservationExport.ts`）に受領者の列は足さない（今回は画面の照合で足りる。必要になれば `admin_list_payment_receipts` を使って足せる）。
- 取消の照合は `reverses_receipt_id` で受け取った人に帰属させる（設計書の表に1列追加）。
- 係が取り消した予約は、期限を過ぎていれば1分以内に既存の自動キャンセルで取り消される（`will_expire` で画面に知らせる）。
