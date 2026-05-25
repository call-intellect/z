import type { Metadata } from 'next';

import { MeetingTypesClient } from './MeetingTypesClient';

export const metadata: Metadata = { title: 'Z-Admin — Типы встреч' };

export default function AdminMeetingTypesPage() {
  return <MeetingTypesClient />;
}
