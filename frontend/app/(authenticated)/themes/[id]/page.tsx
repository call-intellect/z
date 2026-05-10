import type { Metadata } from 'next';

import { ThemeDetailClient } from './ThemeDetailClient';

export const metadata: Metadata = {
  title: 'AI-тема',
};

export default function ThemeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <ThemeDetailClient themeId={params.id} />;
}
