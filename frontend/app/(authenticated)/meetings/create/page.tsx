import { CreateMeetingFormV2 } from '@/ui/components/create-meeting-form/CreateMeetingFormV2';

/**
 * Создание встречи (M7) — wizard в 2 шага: галерея шаблонов → параметры.
 *
 * Старая форма (`CreateMeetingForm`) остаётся в репо для возможного отката
 * (TODO M7 cleanup).
 */
export default function CreateMeetingPage() {
  return <CreateMeetingFormV2 />;
}
