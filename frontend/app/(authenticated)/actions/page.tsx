import type { Metadata } from 'next';

import { ActionsClient } from './ActionsClient';

export const metadata: Metadata = {
  title: 'Подтверждения — Кора',
};

export default function ActionsPage() {
  return <ActionsClient />;
}
