import type { Metadata } from 'next';

import { MeetingTypesClient } from './MeetingTypesClient';

export const metadata: Metadata = { title: 'Типы встреч' };

export default function AdminMeetingTypesPage() {
  return <MeetingTypesClient />;
}
