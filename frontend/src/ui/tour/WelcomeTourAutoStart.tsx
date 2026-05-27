'use client';

/**
 * WelcomeTourAutoStart — невидимый компонент, который запускает
 * onboarding-тур №1 «welcome» при первом заходе авторизованного
 * пользователя. Монтируется в AuthenticatedShell.
 *
 * Если тур уже завершён/пропущен — ничего не делает (внутри
 * `startIfNotCompleted`).
 */

import { useTour } from './useTour';

export function WelcomeTourAutoStart() {
  useTour('welcome');
  return null;
}
