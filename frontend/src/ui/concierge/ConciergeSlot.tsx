'use client';

import { usePathname } from 'next/navigation';

import { ConciergeChat } from './ConciergeChat';
import type { ConciergePageContextApi } from '@/api/concierge.api';

/**
 * SBA γ-2 — opt-in компонент для страниц, которые хотят embedded Concierge
 * с подмешанным контекстом. Можно использовать вместо или вместе с
 * ConciergeFloatingButton.
 *
 * Использование (пример на странице карточки):
 *   <ConciergeSlot
 *     context={{
 *       currentEntityKind: 'card',
 *       currentEntityId: card.id,
 *       extras: { cardName: card.name },
 *     }}
 *   />
 */
export interface ConciergeSlotProps {
  context?: ConciergePageContextApi;
  className?: string;
}

export function ConciergeSlot({ context, className }: ConciergeSlotProps) {
  const pathname = usePathname();
  const pageContext: ConciergePageContextApi = {
    clientPath: pathname ?? undefined,
    ...(context ?? {}),
  };
  return <ConciergeChat pageContext={pageContext} className={className} />;
}
