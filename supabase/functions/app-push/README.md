# app-push(アプリへの通知)

がっけんぽアプリ(osu-gakkenpo/shic-portal の `mobile/`)に通知を送る Edge Function。中身の説明は `index.ts` の先頭。

## 動かし始める手順(Firebase の鍵を用意してから)

1. Firebase コンソール → プロジェクトの設定 → サービス アカウント → 「新しい秘密鍵を生成」で JSON をダウンロードする
   (議事録・がっけんぽ.jp のログインと同じ Firebase プロジェクト)
2. Supabase → Edge Functions → Secrets に次の2つを入れる
   - `FCM_SERVICE_ACCOUNT`:ダウンロードした JSON の中身をそのまま
   - `APP_PUSH_CRON_SECRET`:32文字くらいのでたらめな文字列
3. 同じ合言葉を Vault に入れ、10分おきに呼ぶ(SQL エディタで1回だけ。`pg_net` が必要):

```sql
create extension if not exists pg_net;
select vault.create_secret('<APP_PUSH_CRON_SECRET と同じ文字列>', 'app_push_cron_secret');
select cron.schedule('app-push', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://nbhpsjhqaakaweeywhxa.supabase.co/functions/v1/app-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'app_push_cron_secret')
    ),
    body := '{}'::jsonb
  );
$$);
```

この SQL を本番で実行したら、同じ内容を `supabase/migrations/` に追加すること(AGENTS.md)。
