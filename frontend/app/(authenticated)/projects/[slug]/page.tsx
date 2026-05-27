import { redirect } from 'next/navigation';

/**
 * `/projects/[slug]` — default view → редирект на /overview.
 *
 * Tracker Project Overview (2026-05-27): «Обзор» становится стартовой
 * вкладкой проекта вместо канбан-доски (паритет Weeek/Kaiten/Bitrix24).
 * ТЗ: plans/tz/2026-05-27-tracker-project-overview.md.
 */
export default function ProjectSlugIndex({
  params,
}: {
  params: { slug: string };
}) {
  redirect(`/projects/${encodeURIComponent(params.slug)}/overview`);
}
