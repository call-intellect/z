import type { Metadata } from 'next';

import { NewProjectClient } from './NewProjectClient';

export const metadata: Metadata = {
  title: 'Новый проект — Кора',
};

export default function NewProjectPage() {
  return <NewProjectClient />;
}
