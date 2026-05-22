import type { Metadata } from 'next';

import { EventsListClient } from './EventsListClient';

export const metadata: Metadata = {
  title: 'События',
};

/**
 * `/events` — список событий Org (SBA α-3, категория A онтологии).
 * Минимальный read-only экран.
 */
export default function EventsPage() {
  return <EventsListClient />;
}
