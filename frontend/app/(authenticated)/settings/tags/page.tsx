import type { Metadata } from 'next';

import { TagsClient } from './TagsClient';

export const metadata: Metadata = {
  title: 'Теги — Z',
};

export default function TagsPage() {
  return <TagsClient />;
}
