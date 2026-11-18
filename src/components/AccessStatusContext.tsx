'use client';

import { createContext, useContext } from 'react';
import type { AccessStatus } from '@/lib/accessStatus';

/** StudentAuthGate が読んだ本人の利用状態。ゲートの外（管理画面など）では null */
export const AccessStatusContext = createContext<AccessStatus | null>(null);

export function useAccessStatus(): AccessStatus | null {
  return useContext(AccessStatusContext);
}
