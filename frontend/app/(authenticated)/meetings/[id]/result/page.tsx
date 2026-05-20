import { MeetingResultPageReal } from '@/ui/components/meeting-result-v2/MeetingResultPageReal';

type Props = { params: Promise<{ id: string }> };

/**
 * Защищённая страница результата встречи (production-версия M7).
 * Доступ к данным проверяет backend в `GET /api/v1/meetings/:id/result`
 * (host-only) — фронт показывает 403/404 как ошибку.
 *
 * Авторизация (наличие `z_session`) — проверяется middleware'ом.
 *
 * Старая реализация (`@/ui/components/meeting-result/ResultPage`) оставлена
 * в репозитории до полного cleanup (TODO M7).
 */
export default async function MeetingResultPage({ params }: Props) {
  const { id } = await params;
  return <MeetingResultPageReal meetingId={id} />;
}
