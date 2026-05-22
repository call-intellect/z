import type { Metadata } from 'next';

import { DecisionsListClient } from './DecisionsListClient';

export const metadata: Metadata = {
  title: 'Решения',
};

/**
 * `/decisions` — master-detail реестр решений компании (SBA β-3).
 *
 * Решения автоматически извлекаются Специалистом 3.3 из встреч и документов
 * (signalType ∈ decision / rationale / decision_basis). Каждое решение
 * проходит ручную модерацию (deep review) — `decision` относится к
 * критическим типам в `CurationService`.
 *
 * Ключевая ценность: «почему мы так решили» больше не теряется при кадровой
 * ротации. См. plans/tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md.
 */
export default function DecisionsPage() {
  return <DecisionsListClient />;
}
