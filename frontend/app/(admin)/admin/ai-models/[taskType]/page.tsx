import type { Metadata } from 'next';

import { TaskTypeDetailsClient } from './TaskTypeDetailsClient';

export const metadata: Metadata = {
  title: 'Модель агента — Admin',
};

export default function TaskTypePage({
  params,
}: {
  params: { taskType: string };
}) {
  return <TaskTypeDetailsClient taskType={decodeURIComponent(params.taskType)} />;
}
