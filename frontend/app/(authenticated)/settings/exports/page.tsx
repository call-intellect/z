import type { Metadata } from 'next';

import { ExportsClient } from './ExportsClient';

export const metadata: Metadata = {
  title: 'Экспорты — Кора',
};

export default function ExportsPage() {
  return <ExportsClient />;
}
