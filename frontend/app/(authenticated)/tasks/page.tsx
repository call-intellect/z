import type { Metadata } from 'next';

import { TasksClient } from './TasksClient';

export const metadata: Metadata = {
  title: 'Задачи — Кора',
};

export default function TasksPage() {
  return <TasksClient />;
}
