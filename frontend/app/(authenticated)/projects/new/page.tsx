import type { Metadata } from 'next';

import { NewProjectClient } from './NewProjectClient';

export const metadata: Metadata = {
  title: 'Новый проект — Z',
};

export default function NewProjectPage() {
  return <NewProjectClient />;
}
