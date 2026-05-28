import type { Metadata } from 'next';

import { ProjectDocumentEditorClient } from './ProjectDocumentEditorClient';

export const metadata: Metadata = {
  title: 'Документ — Z',
};

export default function ProjectDocumentEditorPage({
  params,
}: {
  params: { slug: string; docId: string };
}) {
  return (
    <ProjectDocumentEditorClient slug={params.slug} docId={params.docId} />
  );
}
