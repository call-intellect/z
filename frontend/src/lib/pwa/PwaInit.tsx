'use client';

import { useEffect } from 'react';

import { registerServiceWorker } from './register-sw';

/**
 * Клиентский init-компонент: регистрирует Service Worker один раз после mount.
 * Подключается из root layout. Ничего не рендерит.
 */
export function PwaInit(): null {
  useEffect(() => {
    let cancelled = false;
    void registerServiceWorker().then((reg) => {
      if (cancelled) return;
      // Авто-обновление SW при появлении новой версии (после deploy).
      // Без UI — на MVP достаточно skipWaiting в самом SW.
      if (reg && reg.update) {
        reg.update().catch(() => {
          // silent — обновление не критично
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
