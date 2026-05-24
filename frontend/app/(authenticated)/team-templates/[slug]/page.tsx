import type { Metadata } from 'next';

import { TeamTemplateDetailClient } from './TeamTemplateDetailClient';

export const metadata: Metadata = {
  title: 'Шаблон команды — Z',
};

export default function TeamTemplateDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  return <TeamTemplateDetailClient slug={params.slug} />;
}
