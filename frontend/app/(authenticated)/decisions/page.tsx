import type { Metadata } from 'next';

import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileMemoryClient } from '@/ui/mobile/manager/MobileMemoryClient';

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
  // Ниже md — мобильный таб «Память» (лента решений + поиск); md+ — десктопный
  // master-detail реестр БЕЗ изменений (инвариант №1).
  return (
    <MobileShell
      mobile={<MobileMemoryClient />}
      desktop={<DecisionsListClient />}
    />
  );
}
