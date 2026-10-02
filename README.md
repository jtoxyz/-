# 大学委員会向け 参加型企画予約システム

大阪産業大学の委員会・サークル企画向けの、参加予約・電子チケット発券サイトです。
Cloudflare Pages と Supabase の無料枠で運用しています。

- 本番: https://committee-reservation.pages.dev
- 制作: 電子計算研究部

## 構成

| 層 | 内容 |
|---|---|
| フロント | Next.js 16 + React 19。画面はクライアント側で動作し、Supabase を直接呼び出す |
| ホスティング | Cloudflare Pages（`@cloudflare/next-on-pages`）。`main` への push で自動デプロイ |
| DB・認証 | Supabase（東京リージョン）。予約処理はすべて RPC（DB関数）で実行 |
| 定期処理 | GitHub Actions がSupabaseに週3回アクセスし、無料プランの自動一時停止を防ぐ |

## 主な機能

### 学生向け
- **大学Googleアカウントでログイン**（`s[学籍番号]@ge.osaka-sandai.ac.jp` のみ）。初回のみ氏名を登録します。
  学籍番号とメールアドレスはログインしたアカウントから自動で決まり、手入力はしません。
- 同じ端末なら、次に開いたときもログインしたままです。
- 企画一覧・予約（複数枠の一括予約に対応）・当日券の取得。
- マイチケット（`/my-tickets`）でチケットを表示し、会場で「使用する」を押して使用済みにします。
  使用後のチケットコードは、企画ごとに設定した時間だけ表示されます。
- 支払いQR（`/pay`）の読み取りで支払い済みにします。
- **チケットを探す**（`/tickets/find`）: ログインなしで、企画・枠・氏名・学籍番号からチケットを探して使用できます。
- スマホのホーム画面に追加すると、アプリのように起動できます。

### 管理者向け（`/admin`）
- 企画の作成・編集・複製・削除、開催枠と定員、受付日時、当日券、公開設定。
- 予約者一覧・Excel出力・事前登録・バックアップと復元。
- 支払い設定・支払い管理・動的支払いQR（90秒で切り替え）・1日支払いQR。
- 利用者管理・学籍番号（学科コード）設定・ブラックリスト。

## セキュリティの設計

- `reservations` テーブルは直接読めません。予約はすべて RPC 経由で行い、DB側で
  公開状態・受付時間・重複予約・定員などを検証します。
- ブラックリストに登録された利用者のチケットは、表示・使用できません。
- 予約の登録時には、DBのトリガーがログイン中の大学アカウントを確認します。
- 管理者用 RPC は未ログインの利用者が実行できず、関数の中でも `admin_users` を確認します。
- 詳しい開発ルールは [AGENTS.md](AGENTS.md) を参照してください。

## ローカル開発

```bash
npm install
npm run dev
```

`.env.local` に次の値を設定します（[.env.example](.env.example) 参照）。

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS=ge.osaka-sandai.ac.jp,osaka-sandai.ac.jp
NEXT_PUBLIC_STUDENT_EMAIL_DOMAIN=ge.osaka-sandai.ac.jp
```

Googleログインをローカルで試すには、Supabase の Authentication → URL Configuration の
Redirect URLs に `http://localhost:3000/**` を追加してください。

## データベース

- スキーマは `supabase/migrations/` のファイルをファイル名順に適用すると再現できます。
  `supabase/` 直下の古いSQLは履歴用なので、個別に実行しないでください（[supabase/README.md](supabase/README.md)）。
- 本番DBを変更したときは、同じ内容のマイグレーションを必ず `supabase/migrations/` に追加します。

### 管理者アカウントの追加
1. Supabase の Authentication → Users でユーザーを作成します（メールとパスワード）。
2. SQL Editor で権限を付与します。
   ```sql
   insert into admin_users (user_id) values ('作成したユーザーのUUID');
   ```
3. `/admin/login` からメールとパスワードでログインします。

## デプロイ

`main` に push すると Cloudflare Pages が自動でビルド・デプロイします。
Pull Request では GitHub Actions がビルドし、圧縮後の Worker サイズが 3 MiB 未満かを確認します。

Cloudflare Pages の環境変数には `NEXT_PUBLIC_` で始まる4つの値を設定します。

## GitHub Actions

| ワークフロー | 内容 |
|---|---|
| `supabase-keepalive.yml` | 月・水・金に Supabase へアクセスし、7日間の無通信による一時停止を防ぐ。Secrets に `SUPABASE_URL` と `SUPABASE_ANON_KEY` が必要 |
| `student-account-check.yml` | Pull Request 時に Pages 用ビルドと Worker サイズを確認 |

## 本番前チェックリスト

- [ ] Supabase が一時停止していない（キープアライブの実行履歴が成功している）
- [ ] 企画が「一般公開」になっていて、受付日時が日本時間で正しい
- [ ] 定員・開催枠・当日券の設定が正しい
- [ ] 大学Googleアカウントでログインし、予約 → マイチケット表示 → 使用 まで通る
- [ ] 同じ企画を二重に予約しようとするとエラーになる
- [ ] 定員に達した枠は予約できない
- [ ] 使用済みチケットは、再読み込みしても使用済みのまま
- [ ] 支払いが必要な企画では、支払いQRの読み取りで支払い済みになる
- [ ] 未ログインで `/admin/events` を開くと `/admin/login` に移る
- [ ] 予約者一覧の Excel 出力が文字化けしない

## 既知の制約

- iPhone の Safari では、サイトを7日以上開かないとログイン情報が消え、再ログインが必要になることがあります。
- LINE などのアプリ内ブラウザで開くと、普段のブラウザとはログイン状態が共有されません。
