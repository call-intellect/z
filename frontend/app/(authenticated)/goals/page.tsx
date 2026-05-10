import type { Metadata } from 'next';

import { GoalsClient } from './GoalsClient';

export const metadata: Metadata = {
  title: 'Цели',
};

export default function GoalsPage() {
  return <GoalsClient />;
}
