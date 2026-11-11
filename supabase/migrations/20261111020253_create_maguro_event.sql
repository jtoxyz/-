-- 本番用「自治会×がっけんぽ マグロ企画」を作成する（データ追加）。
--   打ち合わせ決定事項:
--     * 開催 12月2日（水）・3日（木）、各日250食、完全予約制
--     * アンケート回答で1食100円、回答なしで1食500円（券種は各日の250食を共有）
--     * 予約受付 11月16日開始、支払い受付 11月17日〜25日（学生会館3階コモンズ）
--   未決定のため仮置きしている値:
--     * 受け取り時間 11:30〜13:30（JST）
--     * 予約締切 11月24日 23:59（JST）、支払期限 11月25日 23:59（JST）
--   支払い受付のシフトが決まるまで、来室日時の選択（payment_visit_required）は使わない。
--   テスト用の「自治会コラボマグロ企画」(85387db6-...) には手を加えない。
--   アンケート設問は、テスト企画で本番DBの管理画面から更新された最新版（q4〜q10、分岐あり）と同じ内容。
begin;

insert into public.events (
  id, title, description, capacity, is_public,
  starts_at, ends_at,
  reservation_enabled, reservation_starts_at, reservation_ends_at,
  ticket_enabled, use_button_enabled, slot_selection_mode,
  allowed_email_domains,
  payment_required, payment_deadline_mode, payment_due_fixed_at, payment_visit_required,
  low_remaining_threshold, low_remaining_threshold_type,
  post_reservation_notes, survey_config
)
select
  '2c3e4a32-ea78-43c6-9de1-2efefab83e2e',
  '自治会×がっけんぽ マグロ企画',
  $txt$学生自治会執行委員会×がっけんぽ のコラボ企画です。学食JOLIEでマグロを提供します。

【開催日】12月2日（水）・12月3日（木）
【提供数】各日250食（完全予約制）
【受け取り場所】JOLIE
【受け取り時間】11:30〜13:30

【料金】
・予約時にアンケートに回答：1食100円
・アンケートに回答しない：1食500円

[alert:[red:【お支払い】
期間：11月17日（火）〜11月25日（水）
場所：学生会館3階 コモンズ
受付時間は決まり次第お知らせします。
期間内にお支払いがない場合、予約は自動でキャンセルされます。]]

【参加の流れ】
1. 受け取り日と券種（アンケート回答100円／回答なし500円）を選んで予約する
2. 11月17日〜25日に、学生会館3階コモンズで代金を支払う
3. 当日、受け取り時間内にJOLIEでチケットを提示して受け取る

学生自治会執行委員会×がっけんぽ$txt$,
  250, true,
  '2026-12-02 11:30:00+09', '2026-12-03 13:30:00+09',
  true, '2026-11-16 00:00:00+09', '2026-11-24 23:59:00+09',
  true, true, 'single',
  array['ge.osaka-sandai.ac.jp'],
  true, 'absolute', '2026-11-25 23:59:00+09', false,
  20, 'count',
  $txt$[alert:[red:11月17日（火）〜11月25日（水）に、学生会館3階コモンズで代金をお支払いください。
期間内にお支払いがない場合、予約は自動でキャンセルされます。]]

【お支払い】
・場所：学生会館3階 コモンズ
・期間：11月17日（火）〜11月25日（水）
・金額：選んだ券種の金額（アンケート回答100円／回答なし500円）

【受け取り】
・場所：JOLIE
・日時：予約した日の11:30〜13:30
・受け取りの際に、係の前でこの画面の「このチケットを使用する」を押し、表示されたチケットコードを見せてください。

[red:お支払いが確認できるまで、チケットは使用できません。
受け取り時間を過ぎるとチケットは使用できなくなります。]$txt$,
  $json$
{"intro":"ご協力をお願いします。","questions":[
 {"id":"q4","text":"この企画をどこで知りましたか？（複数選択可）","type":"multiple","options":["電子掲示板","自治会の投稿","がっけんぽの投稿","大学の学内メール(ポータル)","総務企画","その他"],"required":true},
 {"id":"q5","text":"「その他」の内容を教えてください","type":"text","options":[],"required":true,"show_if":{"question_id":"q4","values":["その他"]}},
 {"id":"q6","text":"どこで投稿を見ましたか？（複数選択可）","type":"multiple","options":["X","Instagram"],"required":true,"show_if":{"question_id":"q4","values":["自治会の投稿","がっけんぽの投稿"]}},
 {"id":"q7","text":"自治会のことを知っていますか？","type":"single","options":["知っている","知らない"],"required":true},
 {"id":"q8","text":"自治会をどこで知りましたか？","type":"single","options":["この企画","各SNS","総務企画"],"required":true,"show_if":{"question_id":"q7","values":["知っている"]}},
 {"id":"q9","text":"次もやって欲しいですか","type":"single","options":["はい","いいえ"],"required":true},
 {"id":"q10","text":"次に何をやって欲しいですか","type":"text","options":[],"required":true}
]}
$json$::jsonb
where not exists (select 1 from public.events where id = '2c3e4a32-ea78-43c6-9de1-2efefab83e2e');

insert into public.event_slots (
  id, event_id, label, sort_order, is_enabled,
  starts_at, ends_at,
  reservation_capacity, total_capacity,
  is_reservation_enabled, reservation_starts_at, reservation_ends_at,
  is_ticket_use_enabled, ticket_use_starts_at, ticket_use_ends_at,
  is_walkin_enabled
) values
  ('51cda840-fa11-466c-a10f-75bbe66fc0ff', '2c3e4a32-ea78-43c6-9de1-2efefab83e2e', '12月2日（水）', 0, true,
   '2026-12-02 11:30:00+09', '2026-12-02 13:30:00+09',
   250, 250,
   true, '2026-11-16 00:00:00+09', '2026-11-24 23:59:00+09',
   true, '2026-12-02 11:30:00+09', '2026-12-02 13:30:00+09',
   false),
  ('399e09c2-a847-49d5-a540-75849f21282d', '2c3e4a32-ea78-43c6-9de1-2efefab83e2e', '12月3日（木）', 1, true,
   '2026-12-03 11:30:00+09', '2026-12-03 13:30:00+09',
   250, 250,
   true, '2026-11-16 00:00:00+09', '2026-11-24 23:59:00+09',
   true, '2026-12-03 11:30:00+09', '2026-12-03 13:30:00+09',
   false)
on conflict (id) do nothing;

insert into public.event_ticket_options (
  id, event_id, label, description, price_yen, requires_survey, per_slot_limit, sort_order, is_enabled
) values
  ('aa75546a-5163-42ee-b4d0-b5e6431670a5', '2c3e4a32-ea78-43c6-9de1-2efefab83e2e',
   'アンケート回答', '予約時にアンケートに回答すると1食100円', 100, true, null, 0, true),
  ('a3b6dbc4-7706-435a-87d5-6abac30b32e4', '2c3e4a32-ea78-43c6-9de1-2efefab83e2e',
   'アンケートなし', 'アンケートに回答しない場合は1食500円', 500, false, null, 1, true)
on conflict (id) do nothing;

commit;
