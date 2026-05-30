import { redirect } from 'next/navigation';

/**
 * `/projects/[slug]` — default view → редирект на /overview.
 *
 * Tracker Project Overview (2026-05-27): «Обзор» становится стартовой
 * вкладкой проекта вместо канбан-доски (паритет Weeek/Kaiten/Bitrix24).
 * ТЗ: plans/tz/2026-05-27-tracker-project-overview.md.
 */
export default async function ProjectSlugIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/projects/${encodeURIComponent(slug)}/overview`);
}
