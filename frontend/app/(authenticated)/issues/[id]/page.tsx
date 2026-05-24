import type { Metadata } from 'next';

import { IssueDetailClient } from './IssueDetailClient';

export const metadata: Metadata = {
  title: 'Задача — Z',
};

export default function IssueDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <IssueDetailClient issueId={params.id} />;
}
