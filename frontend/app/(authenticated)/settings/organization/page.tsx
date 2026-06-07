import type { Metadata } from 'next';

import { OrganizationClient } from './OrganizationClient';

export const metadata: Metadata = {
  title: 'Организация',
};

export default function OrganizationPage() {
  return <OrganizationClient />;
}
