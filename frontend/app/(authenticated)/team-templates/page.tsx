import type { Metadata } from 'next';

import { TeamTemplatesClient } from './TeamTemplatesClient';

export const metadata: Metadata = {
  title: 'Шаблоны команд — Z',
};

export default function TeamTemplatesPage() {
  return <TeamTemplatesClient />;
}
