import type { Metadata } from 'next';

import { DemoClient } from './DemoClient';

export const metadata: Metadata = { title: 'Демо-кабинеты' };

export default function AdminDemoPage() {
  return <DemoClient />;
}
