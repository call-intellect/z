import type { Metadata } from 'next';

import { EmailTemplatesClient } from './EmailTemplatesClient';

export const metadata: Metadata = { title: 'Email-шаблоны' };

export default function AdminEmailTemplatesPage() {
  return <EmailTemplatesClient />;
}
