import type { Metadata } from 'next';

import { RoleMapClient } from './RoleMapClient';

export const metadata: Metadata = {
  title: 'Карта должности — Z',
};

/**
 * SBA α-8 wave 4 — графический вид карты должности (5 нормализованных
 * категорий wave-2 + KPI + completeness + maturity).
 */
export default async function RoleMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleMapClient roleId={id} />;
}
