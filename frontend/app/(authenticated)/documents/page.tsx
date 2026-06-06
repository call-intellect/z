import type { Metadata } from 'next';

import { DocumentsListClient } from './DocumentsListClient';

export const metadata: Metadata = {
  title: 'Документы — Кора',
};

export default function DocumentsPage() {
  return <DocumentsListClient />;
}
