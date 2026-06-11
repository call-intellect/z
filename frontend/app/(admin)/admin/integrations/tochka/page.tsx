import type { Metadata } from 'next';

import { TochkaIntegrationClient } from './TochkaIntegrationClient';

export const metadata: Metadata = {
  title: 'Tochka Bank',
};

export default function TochkaIntegrationPage() {
  return <TochkaIntegrationClient />;
}
