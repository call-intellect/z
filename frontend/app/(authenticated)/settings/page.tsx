import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsClient } from './SettingsClient';

export const metadata: Metadata = {
  title: 'Настройки — Кора',
};

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsClient />
    </Suspense>
  );
}
