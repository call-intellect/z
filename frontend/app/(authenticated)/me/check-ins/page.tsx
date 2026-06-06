import type { Metadata } from 'next';

import { MyCheckInsClient } from './MyCheckInsClient';

export const metadata: Metadata = {
  title: 'Мои чек-ины — Кора',
};

/**
 * SBA β-8 — `/me/check-ins` — личная страница утренних/вечерних чек-инов.
 *
 * Показывает историю + быструю форму для manual create. Auth + tenant —
 * через CookieAuthGuard + TenantGuard на backend; sсли Person не привязан
 * к user'у в Org — backend вернёт 403 (handled в client).
 */
export default function MyCheckInsPage() {
  return <MyCheckInsClient />;
}
