import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { OrchestratorRunClient } from './OrchestratorRunClient';

export const metadata: Metadata = {
  title: 'Orchestrator — research run',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * SBA δ-1 — страница `/orchestrator/runs/[id]` (live view).
 *
 * При маунте подключается к SSE re-stream (`GET /runs/:id/events`) или
 * polling-у статуса (если run уже завершён).
 */
export default async function OrchestratorRunPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <OrchestratorRunClient runId={id} />;
}
