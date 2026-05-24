import type { Metadata } from 'next';

import { IntakeClient } from './IntakeClient';

export const metadata: Metadata = {
  title: 'Входящие — Z',
};

/**
 * Phase 3 (Sprint 6) — глобальный inbox для auto-triage входящих задач
 * (email / Telegram / встречи / API / manual). Триаж выполняют только
 * пользователи с ролью owner / admin (см. IntakeClient).
 */
export default function IntakePage() {
  return <IntakeClient />;
}
