'use client';

/**
 * WelcomeTourAutoStart — невидимый компонент, который запускает
 * action-тур «welcome» (Блок B) при первом заходе после Блока A.
 * Монтируется в AuthenticatedShell.
 *
 * ТЗ 2026-05-29 onboarding-v2: тур стартует только если
 * Org.setupCompletedAt === null (все 6 шагов не пройдены).
 */

import { useAuth } from '@/contexts/auth-context';
import { useOrgSetup } from '@/hooks/useOrgSetup';
import { useTour } from './useTour';
import { useTourContext } from './TourProvider';
import { useEffect } from 'react';

export function WelcomeTourAutoStart() {
  const { currentOrgId } = useAuth();
  const { setupCompletedAt, isLoading } = useOrgSetup(currentOrgId);
  const { startIfNotCompleted, progress } = useTourContext();

  useEffect(() => {
    if (isLoading || progress === null) return;
    if (setupCompletedAt) return;
    startIfNotCompleted('welcome');
  }, [startIfNotCompleted, progress, setupCompletedAt, isLoading]);

  return null;
}
