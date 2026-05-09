import type { Metadata } from 'next';

import { DestinationsClient } from './DestinationsClient';

export const metadata: Metadata = {
  title: 'Интеграции — Z',
};

export default function SettingsIntegrationsPage() {
  return <DestinationsClient />;
}
