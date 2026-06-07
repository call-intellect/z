import type { Metadata } from 'next';

import { IssueDetailClient } from './IssueDetailClient';

export const metadata: Metadata = {
  title: 'Задача',
};

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IssueDetailClient issueId={id} />;
}
