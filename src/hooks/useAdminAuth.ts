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
    async function checkAuth() {
      try {
        // 1. Get current session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session || !session.user) {
          setUser(null);
          router.push('/admin/login');
          return;
        }

        // 2. Validate admin role
        const { data: adminData, error: adminError } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (adminError || !adminData) {
          console.warn('Unauthorized admin access attempt. Logging out.');
          await supabase.auth.signOut();
          setUser(null);
          router.push('/admin/login');
          return;
        }

        setUser(session.user);
      } catch (err) {
        console.error('Admin Auth Error:', err);
        router.push('/admin/login');
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [router]);

  return { loading, user };
}
