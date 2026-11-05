-- 「自治会コラボマグロ企画」のアンケートを、分岐つきの設問に差し替える（データ変更）。
--   旧設問（q1 来年度もやってほしいか / q2 その他 / q3 自由記述）は削除。
--   新設問は旧回答と混ざらないよう q4〜q8 を使う。旧回答は reservations.survey_answers に残る。
--   q5 は q4 で「その他」、q6 は q4 で「自治会の投稿」か「がっけんぽの投稿」、
--   q8 は q7 で「知っている」を選んだ人だけに表示する。
update public.events
   set survey_config = $json$
{"intro":"ご協力をお願いします。","questions":[
 {"id":"q4","text":"この企画をどこで知りましたか？（複数選択可）","type":"multiple","options":["電子掲示板","自治会の投稿","がっけんぽの投稿","総務企画","その他"],"required":true},
 {"id":"q5","text":"「その他」の内容を教えてください","type":"text","options":[],"required":true,"show_if":{"question_id":"q4","values":["その他"]}},
 {"id":"q6","text":"どこで投稿を見ましたか？（複数選択可）","type":"multiple","options":["X","Instagram"],"required":true,"show_if":{"question_id":"q4","values":["自治会の投稿","がっけんぽの投稿"]}},
 {"id":"q7","text":"自治会のことを知っていますか？","type":"single","options":["知っている","知らない"],"required":true},
 {"id":"q8","text":"自治会をどこで知りましたか？","type":"single","options":["この企画","各SNS","総務企画"],"required":true,"show_if":{"question_id":"q7","values":["知っている"]}}
]}
$json$::jsonb
 where id = '85387db6-1ad7-4c21-a5a7-858144254281';
