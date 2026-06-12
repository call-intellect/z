'use client';

/**
 * WelcomeTourAutoStart — ненавязчивый авто-старт welcome-тура при первом
 * входе в авторизованный кабинет.
 *
 * История:
 *   - Ранее (Блок B) принудительно запускал action-тур; убрано 2026-05-28
 *     в пользу IncompleteSetupBanner.
 *   - ТЗ Ф7 (D3) 2026-06-11 — возвращён НЕнавязчивый авто-старт: один раз,
 *     через `startIfNotCompleted('welcome')` (хук `useTour`). Гейт — только
 *     прогресс тура (`completedAt`/`skipped` в tour-progress); НИКАКОГО
 *     нового серверного «первый вход»-флага и НИКАКОГО force-показа. Тур
 *     неблокирующий, на каждом шаге есть «Пропустить». Прогресс персистится
 *     (PATCH в TourProvider), поэтому повторно тур не всплывёт.
 *
 * Монтируется в `AuthenticatedShell` внутри `TourProvider` — то место, где
 * авторизованная оболочка впервые монтируется. Сам компонент ничего не
 * рендерит: UI тура рисует `<TourOverlay />` из провайдера.
 */

import { useTour } from './useTour';

export function WelcomeTourAutoStart() {
  useTour('welcome');
  return null;
}
