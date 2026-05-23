import type { Metadata } from 'next';

import { RoleMapClient } from './RoleMapClient';

export const metadata: Metadata = {
  title: 'Карта должности — Z',
};

/**
 * SBA α-8 wave 4 — графический вид карты должности (5 нормализованных
 * категорий wave-2 + KPI + completeness + maturity).
 */
export default function RoleMapPage({
  params,
}: {
  params: { id: string };
}) {
  return <RoleMapClient roleId={params.id} />;
}
