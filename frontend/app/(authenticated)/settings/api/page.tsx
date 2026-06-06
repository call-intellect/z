import type { Metadata } from 'next';

import { ApiKeysClient } from './ApiKeysClient';

export const metadata: Metadata = {
  title: 'API ключи — Кора',
};

export default function SettingsApiPage() {
  return <ApiKeysClient />;
}
