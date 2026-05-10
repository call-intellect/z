import type { Metadata } from 'next';

import { ThemesClient } from './ThemesClient';

export const metadata: Metadata = {
  title: 'AI-темы',
};

export default function ThemesPage() {
  return <ThemesClient />;
}
