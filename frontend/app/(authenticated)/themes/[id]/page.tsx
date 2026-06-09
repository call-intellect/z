import type { Metadata } from 'next';

import { ThemeDetailClient } from './ThemeDetailClient';

export const metadata: Metadata = {
  title: 'Тема',
};

export default async function ThemeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ThemeDetailClient themeId={id} />;
}
