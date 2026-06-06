import type { Metadata } from 'next';

import { RetentionClient } from './RetentionClient';

export const metadata: Metadata = {
  title: 'Хранение данных и 152-ФЗ — Кора',
};

export default function RetentionPage() {
  return <RetentionClient />;
}
