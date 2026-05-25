import type { Metadata } from 'next';

import { ClonesListClient } from './ClonesListClient';

export const metadata: Metadata = {
  title: 'Клоны должностей — Кора',
};

/**
 * `/clones` (Clones=Roles Ф4) — публичная витрина клонов должностей.
 *
 * Клоны теперь ролевые, а не персональные: на каждую Role в Org может
 * существовать активный `ExecutablePersona(scope='role')` — «Клон
 * Маркетолога v2». Здесь — сетка карточек этих клонов с фильтрами,
 * сортировкой и переходом в `/roles/:id/clone`.
 *
 * См. plans/tz/2026-05-25-clones-role-based-rebrand.md (Ф4).
 */
export default function ClonesPage() {
  return <ClonesListClient />;
}
