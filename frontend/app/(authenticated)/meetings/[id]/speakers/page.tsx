import { SpeakersScreen } from '@/ui/components/upload-recording/SpeakersScreen';

type Props = { params: Promise<{ id: string }> };

/**
 * Подпись говорящих загруженной записи (ТЗ-5 Ф5). Слева — панель говорящих
 * с действием «Подписать», справа — расшифровка с цветами говорящих. После
 * «Готов» — переход на страницу результата встречи.
 */
export default async function SpeakersPage({ params }: Props) {
  const { id } = await params;
  return <SpeakersScreen meetingId={id} />;
}
