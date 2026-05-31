import type { Metadata } from 'next';

import { EmailTemplatesClient } from './EmailTemplatesClient';

export const metadata: Metadata = { title: 'Z-Admin — Email-шаблоны' };

export default function AdminEmailTemplatesPage() {
  return <EmailTemplatesClient />;
}
