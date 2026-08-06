'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

export function useAdminAuth() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;

    async function queryAdminRow(userId: string) {
      return supabase.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle();
    }

    async function checkAuth() {
      try {
        // 1. Get current session
        const { data: { session } } = await supabase.auth.getSession();

        if (!active) return;

        if (!session || !session.user) {
          setUser(null);
          router.push('/admin/login');
          return;
        }

        // 2. Validate admin role. A failed query (network blip, token refresh
        // in flight, etc.) is not proof the user isn't an admin, so retry once
        // before deciding — signing out a real admin on a transient error is
        // worse than a slightly slower check.
        let { data: adminData, error: adminError } = await queryAdminRow(session.user.id);
        if (adminError) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          if (!active) return;
          ({ data: adminData, error: adminError } = await queryAdminRow(session.user.id));
        }

        if (!active) return;

        if (adminError) {
          console.error('Admin status check failed, leaving session intact:', adminError);
          setUser(null);
          return;
        }

        if (!adminData) {
          console.warn('Unauthorized admin access attempt. Logging out.');
          await supabase.auth.signOut();
          if (!active) return;
          setUser(null);
          router.push('/admin/login');
          return;
        }

        setUser(session.user);
      } catch (err) {
        console.error('Admin Auth Error:', err);
        if (active) router.push('/admin/login');
      } finally {
        if (active) setLoading(false);
      }
    }

    checkAuth();
    return () => {
      active = false;
    };
  }, [router]);

  return { loading, user };
}
