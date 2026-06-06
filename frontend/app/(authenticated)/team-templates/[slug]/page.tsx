import type { Metadata } from 'next';

import { TeamTemplateDetailClient } from './TeamTemplateDetailClient';

export const metadata: Metadata = {
  title: 'Шаблон команды — Кора',
};

export default async function TeamTemplateDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TeamTemplateDetailClient slug={slug} />;
}
