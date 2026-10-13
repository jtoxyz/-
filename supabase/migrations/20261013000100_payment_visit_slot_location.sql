-- 支払い受付枠ごとに支払い場所を持たせる。
-- 受付場所が日によって変わる（例：10/13までは学生会館6階、10/14からは学生会館3階）ため、
-- 枠に場所を記録し、学生の予約画面・マイチケットに枠ごとの場所を表示する。
-- null の枠は従来どおりの場所（src/lib/config.ts の PAYMENT_ROOM_LABEL）を表示する。

begin;

alter table public.payment_visit_slots
  add column if not exists location text;

notify pgrst, 'reload schema';
commit;
