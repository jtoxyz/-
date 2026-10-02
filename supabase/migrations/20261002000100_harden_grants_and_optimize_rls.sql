-- 動作を変えない整備:
-- 1. anon に残っていた EXECUTE 権限を除去する。
--    create_reservation / create_walkin_reservation は 20260724000300 で anon から
--    REVOKE したが、デフォルトの PUBLIC 付与経由で anon が実行可能なままだった
--    (BEFORE INSERT トリガーで弾かれるため実害なし)。authenticated には明示付与済み。
-- 2. RLS ポリシーの auth.uid() を (select auth.uid()) にして行ごとの再評価を避ける。
--    条件式の意味・対象ロールは変更しない。
-- 3. インデックスの無い外部キーにインデックスを追加する。

begin;

revoke execute on function public.create_reservation(uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.create_walkin_reservation(uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.update_allowed_student_department_codes(text[]) from public, anon;
grant execute on function public.create_reservation(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.create_walkin_reservation(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.update_allowed_student_department_codes(text[]) to authenticated;

alter policy admin_action_logs_admin_select on public.admin_action_logs
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy payment_qr_codes_admin_select on public.payment_qr_codes
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy "Anyone can read active department codes" on public.student_department_codes
  using (is_active = true or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
alter policy "Admins can insert department codes" on public.student_department_codes
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
alter policy "Admins can update department codes" on public.student_department_codes
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
alter policy "Admins can delete department codes" on public.student_department_codes
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy user_blacklist_admin_select on public.user_blacklist
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
alter policy user_blacklist_admin_insert on public.user_blacklist
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
alter policy user_blacklist_admin_update on public.user_blacklist
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
alter policy user_blacklist_admin_delete on public.user_blacklist
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

create index if not exists idx_payment_qr_codes_created_by on public.payment_qr_codes (created_by);
create index if not exists idx_payment_qr_codes_replaced_by on public.payment_qr_codes (replaced_by);
create index if not exists idx_reservations_payment_confirmed_by on public.reservations (payment_confirmed_by);
create index if not exists idx_user_profiles_name_updated_by on public.user_profiles (name_updated_by);

notify pgrst, 'reload schema';
commit;
