'use client';

// スマホアプリの中で、大学アカウントでログインしているとき、この端末の通知の番号を本人と結びつける。
// （予約が近づいたときの通知を、予約した本人の端末にだけ送るため。送るのは supabase/functions/app-push）
// 端末の番号は、アプリが がっけんぽ.jp を開いたときに Cookie（gakkenpo_app_device）に入れている。
import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { appDeviceToken, isNativeApp, nativePlatform } from '@/lib/nativeApp';

let linkedKey: string | null = null;

async function link(session: Session | null) {
  if (!session?.user) return;
  const token = appDeviceToken();
  if (!token) return;
  const key = `${session.user.id}:${token}`;
  if (linkedKey === key) return;
  const { error } = await supabase.rpc('register_app_device', { p_token: token, p_platform: nativePlatform() });
  if (!error) linkedKey = key;
}

export default function AppDeviceLinker() {
  useEffect(() => {
    if (!isNativeApp()) return;
    void supabase.auth.getSession().then(({ data }) => link(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') void link(session);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return null;
}
