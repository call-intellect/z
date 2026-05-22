import type { Metadata } from 'next';

import { VendorsListClient } from './VendorsListClient';

export const metadata: Metadata = {
  title: 'Поставщики',
};

/**
 * `/vendors` — список поставщиков Org (SBA α-3).
 * Минимальный read-only экран. POST/PATCH/DELETE появятся в α-6 вместе
 * с UI Specialist 3-4 (project-customer).
 */
export default function VendorsPage() {
  return <VendorsListClient />;
}
