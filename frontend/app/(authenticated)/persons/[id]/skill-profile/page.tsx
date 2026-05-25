import { redirect } from 'next/navigation';

/**
 * `/persons/:id/skill-profile` — удалена в фазе 3 ТЗ Clones=Roles
 * (2026-05-25). Skill-профиль больше не публичный артефакт человека:
 * клоны теперь делаются по должности (см. `/clones`).
 *
 * Маршрут оставлен только для редиректа со старых ссылок.
 */
export default function PersonSkillProfilePage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/persons/${params.id}`);
}
