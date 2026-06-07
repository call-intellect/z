import type { Metadata } from 'next';

import { TagsClient } from './TagsClient';

export const metadata: Metadata = {
  title: 'Теги',
};

export default function TagsPage() {
  return <TagsClient />;
}
