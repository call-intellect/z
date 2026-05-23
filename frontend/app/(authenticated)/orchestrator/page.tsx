import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { OrchestratorRequestClient } from './OrchestratorRequestClient';

export const metadata: Metadata = {
  title: 'Orchestrator — глубокий research',
};

/**
 * SBA δ-1 — страница `/orchestrator` (request page).
 *
 * Пользователь вводит сложный запрос («составь отчёт по X», «сравни Y и Z»),
 * мы создаём run и перенаправляем на live-view `/orchestrator/runs/:id`.
 */
export default function OrchestratorPage(): ReactElement {
  return <OrchestratorRequestClient />;
}
