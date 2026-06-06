import type { Metadata } from 'next';

import { ProjectDocumentEditorClient } from './ProjectDocumentEditorClient';

export const metadata: Metadata = {
  title: 'Документ — Кора',
};

export default async function ProjectDocumentEditorPage({
  params,
}: {
  params: Promise<{ slug: string; docId: string }>;
}) {
  const { slug, docId } = await params;
  return (
    <ProjectDocumentEditorClient slug={slug} docId={docId} />
  );
}
