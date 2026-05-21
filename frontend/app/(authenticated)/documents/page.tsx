import type { Metadata } from 'next';

import { DocumentsListClient } from './DocumentsListClient';

export const metadata: Metadata = {
  title: 'Документы — Z',
};

export default function DocumentsPage() {
  return <DocumentsListClient />;
}
