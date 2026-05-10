import type { Metadata } from 'next';

import { KnowledgeCoreClient } from './KnowledgeCoreClient';

export const metadata: Metadata = { title: 'Org-Admin — Ядро знаний' };

export default function KnowledgeCorePage() {
  return <KnowledgeCoreClient />;
}
