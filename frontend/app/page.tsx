import type { Metadata } from 'next';
import { HomeClient } from './HomeClient';

export const metadata: Metadata = {
  title: 'Z — AI-видеовстречи',
  description:
    'Z — видеовстречи с AI-отчётом под тип встречи. Получите готовый отчёт через 3 минуты после звонка.',
};

export default function HomePage() {
  return <HomeClient />;
}
