import type { Metadata } from 'next';
import { HomeClient } from './HomeClient';

export const metadata: Metadata = {
  title: 'КОРА — компании растут, когда добивают цели',
  description:
    'Видеовстречи, задачи, спринты и память компании в одном месте. Кора следит, чтобы точно добивались.',
};

export default function HomePage() {
  return <HomeClient />;
}
