import type { Metadata } from 'next';

import { ConsentsClient } from './ConsentsClient';

export const metadata: Metadata = {
  title: 'Согласия — Кора',
};

/**
 * `/onboarding/consents` — Блок C онбординга (Pulse Wave 4 §4.1).
 *
 * Три согласия 152-ФЗ перед первым входом сотрудника в продукт:
 *   1. Обработка чек-инов и sentiment.
 *   2. Анализ risk-сигналов.
 *   3. Показ карточки руководителю.
 *
 * Каждый ответ → POST `/api/v1/me/consents`. По клику «Продолжить» —
 * редирект в дашборд.
 */
export default function OnboardingConsentsPage() {
  return <ConsentsClient />;
}
