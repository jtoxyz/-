# Supabase運用方針

このディレクトリには過去のSQLと正式マイグレーションが混在しています。
新しい環境を再現するときは、`supabase/migrations/` をファイル名順に実行してください。

## 現行の確定マイグレーション

- `20260714000100_consolidate_production_schema.sql`
  - `department`列
  - チケット識別子の自動生成
  - `create_reservation`と`get_ticket`の基本契約
  - 必要なインデックス
- `20260714000200_finalize_reservation_rpc_contracts.sql`
  - 単枠予約と当日券RPCの正式仕様
  - 重複予約・券種競合・定員・受付時間・停止状態のDB検証
  - 管理者事前登録RPCの認証列修正
  - 管理者RPCの匿名実行禁止
  - 当日券専用枠のため予約枠0を許可

## 重要

`supabase/`直下にある古いSQLファイルは、履歴確認と既存環境の互換性確認のため残しています。
新規構築時に直下のSQLを個別に再実行すると、古いRPCが上書きされる可能性があります。
新しい変更は必ず新規マイグレーションとして追加してください。

## 本番DBを直接修正した場合

1. 同内容のマイグレーションを作成する。
2. RPCの引数と戻り値をフロントエンドと照合する。
3. `NOTIFY pgrst, 'reload schema';` を実行する。
4. トランザクション内のテスト予約で確認し、ロールバックする。
5. Security AdvisorとPerformance Advisorを確認する。

## 公開RPCと管理者RPC（2026-11-07 時点）

ログインなしで呼べる（anon）:

- `get_public_events`
- `get_event_slots`
- `claim_payment_qr`（支払いQRを読み取った時点で、ログイン前に「読み取り済み」にするため）
- `get_allowed_student_department_codes`

ログイン中の大学アカウントだけ（authenticated）:

- `create_my_reservation` / `create_my_reservations_bulk` / `create_my_walkin_reservation`
- `get_my_tickets` / `get_my_ticket` / `use_my_ticket` / `get_my_cancelled_tickets`
- `find_ticket` / `get_ticket` / `use_ticket`（「チケットを探す」。代理で使った人は `reservations.used_by` に残る）
- `redeem_payment_qr`
- スタッフ用：`get_my_staff_status` / `staff_list_events` / `staff_get_event_stats` /
  `staff_get_payment_visit_stats` / `staff_get_lane_payment_qr` / `staff_get_daily_payment_qr`
  （関数の中で、管理者か担当企画のスタッフかを `can_operate_event` で確認する）

内部からだけ呼ぶ（API から直接は呼べない）:

- `create_reservation` / `create_reservations_bulk` / `create_walkin_reservation`
  （定義・引数・戻り値は正式契約のまま。学生は `create_my_*` 経由でだけ使う。直接呼ぶと氏名や支払い日時の検証を飛ばせてしまうため）
- トリガー関数（`ensure_reservation_tokens` など。EXECUTE 権限がなくてもトリガーは動く）
- `current_staff_id` / `can_operate_event`

管理者RPC（authenticated に公開されているが、関数の中で `admin_users` を確認する。anon には公開しない）:

- `admin_*` / `delete_event_admin`

## マイグレーション履歴について

本番の `supabase_migrations.schema_migrations` と、このフォルダのファイル名（バージョン番号）は、
2026-11-05 までの分が一致していません（本番には別の番号で記録されていたり、本番にしかない記録があったりします）。
そのため `supabase db push` はそのままでは使えません。本番に適用するときは、
Supabase のダッシュボードか MCP の apply_migration で、ファイルの内容を1つずつ適用してください。
2026-11-07 以降のマイグレーションは、本番に記録された番号と同じファイル名にしています。
