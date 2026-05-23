import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { AssistantClient } from './AssistantClient';

export const metadata: Metadata = {
  title: 'Concierge — помощник кабинета',
};

/**
 * SBA γ-2 — страница `/assistant`. Полноценный UI Concierge Agent:
 * слева — история диалогов, справа — текущий чат с tool-use loop.
 */
export default function AssistantPage(): ReactElement {
  return <AssistantClient />;
}
