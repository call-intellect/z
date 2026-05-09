import { ResultPage } from '@/ui/components/meeting-result/ResultPage';

type Props = { params: { id: string } };

/**
 * Защищённая страница результата встречи. Доступна только host'у —
 * это проверяет backend в `GET /api/v1/meetings/:id/result`.
 * Если юзер не host — backend вернёт 403, и `ResultPage` покажет ошибку.
 *
 * Авторизация (наличие `z_session`) — проверяется middleware'ом.
 */
export default function MeetingResultPage({ params }: Props) {
  return <ResultPage meetingId={params.id} />;
}
