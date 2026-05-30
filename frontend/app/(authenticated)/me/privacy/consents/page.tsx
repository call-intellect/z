import type { Metadata } from 'next';

import { ConsentsListClient } from './ConsentsListClient';

export const metadata: Metadata = {
  title: 'Приватность · мои согласия — Кора',
};

/**
 * `/me/privacy/consents` — Pulse Wave 4 §4.1.
 *
 * Список текущих согласий 152-ФЗ и кнопка «отозвать / выдать заново»
 * рядом с каждым. Каждое действие → POST `/api/v1/me/consents`
 * (новая запись в append-only `ConsentLog`).
 */
export default function MyPrivacyConsentsPage() {
  return <ConsentsListClient />;
}
