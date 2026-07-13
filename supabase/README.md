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

## 公開RPCと管理者RPC

公開が必要:

- `get_public_events`
- `get_event_slots`
- `create_reservation`
- `create_reservations_bulk`
- `create_walkin_reservation`
- `get_ticket`
- `find_ticket`
- `use_ticket`

匿名公開しない:

- `admin_create_pre_registration`
- `admin_auto_activate_pre_registrations`
- `admin_duplicate_event`
- `admin_export_event_backup`
- `admin_get_event_slots`
- `admin_restore_event_backup`
- `delete_event_admin`
