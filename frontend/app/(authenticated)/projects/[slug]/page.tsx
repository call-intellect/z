import { redirect } from 'next/navigation';

/**
 * `/projects/[slug]` — default view → редирект на /board.
 */
export default function ProjectSlugIndex({
  params,
}: {
  params: { slug: string };
}) {
  redirect(`/projects/${encodeURIComponent(params.slug)}/board`);
}
