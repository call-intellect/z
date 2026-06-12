import type { Metadata } from 'next';

import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileMemoryClient } from '@/ui/mobile/manager/MobileMemoryClient';

import { DecisionsListClient } from '../DecisionsListClient';

export const metadata: Metadata = { title: 'Решение' };

/**
 * `/decisions/[id]` — deep-link на конкретное решение. Рендерит тот же
 * десктопный master-detail реестр с предвыбранным решением (правая колонка
 * сразу грузит деталь). Чинит 404 от ссылок на дашборде, в радаре сигналов и
 * недельной сводке. Мобайл — та же лента «Память» (без предвыбора).
 */
export default async function DecisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <MobileShell
      mobile={<MobileMemoryClient />}
      desktop={<DecisionsListClient initialSelectedId={id} />}
    />
  );
}
