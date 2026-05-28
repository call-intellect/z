import type { Metadata } from 'next';

import { ReferralsClient } from './ReferralsClient';

export const metadata: Metadata = {
  title: 'Реферальная программа — Кора',
};

export default function ReferralsPage() {
  return <ReferralsClient />;
}
