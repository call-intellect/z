'use client';

/**
 * WelcomeTourAutoStart — ранее запускал action-тур «welcome» (Блок B)
 * при первом заходе после Блока A.
 *
 * Убрано 2026-05-28: принудительный тур заменён на ненавязчивый
 * IncompleteSetupBanner на дашборде. Пользователь сам решает, когда
 * начать настройку компании. Тур остаётся доступен через ручной
 * перезапуск в /settings и через кнопку «Продолжить» в баннере.
 */

export function WelcomeTourAutoStart() {
  return null;
}
