import type { Metadata } from 'next';
import { HomeClient } from './HomeClient';

export const metadata: Metadata = {
  title: 'КОРА — память вашей компании',
  description:
    'Кора — видеовстречи, задачи и AI-операционный директор. Встречи, переписки и вечерние отчёты автоматически сохраняются в память компании. Уходит человек — память остаётся.',
};

export default function HomePage() {
  return <HomeClient />;
}
