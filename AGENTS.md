<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 委員会予約サイト 開発ルール

## 基本方針

- Supabase本番DBを直接修正した場合は、同じ内容を必ず `supabase/migrations/` に追加する。
- フロントエンドが呼ぶRPCの引数名・戻り値を変更するときは、呼び出し側とSQLを同じ変更で更新する。
- 既存の列・RPC・画面機能は、利用箇所を確認せず削除しない。
- 破壊的変更は新しいマイグレーションで段階的に行い、互換期間を設ける。
- `ticket_code` と `public_token` はテーブルのトリガーで必ず生成する。
- 管理者用RPCは匿名利用者へ公開しない。関数内部でも `admin_users.user_id = auth.uid()` を確認する。
- 公開予約RPCでは、公開状態、受付停止、受付日時、学籍番号、大学メール、重複予約、券種競合、予約枠、総定員をDB側でも検証する。
- 日時表示は必ず `Asia/Tokyo` を明示する。

## 外部AIサービス

- この予約サイトの実行環境では GitHub Models を使用しない。
- 廃止対象の GitHub Models API、`models.github.ai`、`models.inference.ai.azure.com`、関連SDKやトークンを新規追加しない。
- AI機能を追加する場合は、利用する提供元、料金、保存されるデータ、個人情報の送信範囲を確認してから実装する。
- 外部AIサービスの秘密鍵を `NEXT_PUBLIC_` 付き環境変数やブラウザ側コードへ置かない。
- GitHub Copilotなどの開発支援機能は、予約サイト本番の実行時依存とは分離して扱う。

## 現行の正式RPC契約

- `create_reservation(...) -> jsonb`
  - `public_token`, `ticket_code`, `id`, `event_id`, `event_slot_id`, `status` を返す。
- `create_walkin_reservation(...) -> jsonb`
  - `public_token` を返す。互換用に `publicToken` も返す。
- `create_reservations_bulk(...) -> json`
  - 予約結果の配列を返す。
- `get_ticket(text) -> table`
  - チケット画面が使用する企画・開催枠・利用時間情報を返す。

## 作業完了前の確認

1. `create_reservation` のオーバーロードが1個だけであること。
2. `create_walkin_reservation` のオーバーロードが1個だけであること。
3. RPCの返却値に `public_token` が含まれること。
4. テスト登録はトランザクション内で実行し、最後にロールバックすること。
5. Supabase Security/Performance Advisorsを確認すること。
6. GitHubの最新マイグレーションと本番DBの定義が一致すること。
