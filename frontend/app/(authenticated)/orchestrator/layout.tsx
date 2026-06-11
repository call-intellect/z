import type { ReactNode } from 'react';

import { OrchestratorAuthGuard } from './OrchestratorAuthGuard';

export default function OrchestratorLayout({ children }: { children: ReactNode }) {
  return <OrchestratorAuthGuard>{children}</OrchestratorAuthGuard>;
}
