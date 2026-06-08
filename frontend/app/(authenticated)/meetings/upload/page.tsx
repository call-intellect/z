import { UploadRecordingWizard } from '@/ui/components/upload-recording/UploadRecordingWizard';

/**
 * Загрузка готовой записи (ТЗ-5 Ф5) — wizard в 2 шага: тип встречи → файл и
 * параметры. После заливки файла встреча уходит в распознавание речи, затем —
 * на экран подписи говорящих `/meetings/:id/speakers`.
 */
export default function UploadMeetingPage() {
  return <UploadRecordingWizard />;
}
