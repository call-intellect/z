import type { Metadata } from 'next';

import { ClonesMarketplaceClient } from './ClonesMarketplaceClient';

export const metadata: Metadata = {
  title: 'Клоны должностей — Кора',
};

/**
 * `/clones` (ТЗ 2026-05-26 «Маркетплейс клонов») — публичная витрина
 * ролевых клонов Org. Виден всем member'ам, но «Спросить» возможна
 * только при наличии активного CloneAccessGrant.
 *
 * Заменил прежний ClonesListClient (Ф4 Clones=Roles), оставив пути:
 *   /clones                            — маркетплейс
 *   /clones/[roleId]                   — карточка клона
 *   /clones/[roleId]/chat/[id]         — чат с боковой панелью диалогов
 *
 * См. plans/tz/2026-05-26-clones-marketplace-frontend.md.
 */
export default function ClonesPage() {
  return <ClonesMarketplaceClient />;
}
