import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CalendarView } from '@/ui/calendar/CalendarView';

export const metadata: Metadata = {
  title: 'Календарь — Z',
};

export default function MyCalendarPage(): JSX.Element {
  return <CalendarView mode="me" />;
}
