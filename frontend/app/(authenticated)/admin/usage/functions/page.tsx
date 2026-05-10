import type { Metadata } from 'next';

import { FunctionsClient } from './FunctionsClient';

export const metadata: Metadata = { title: 'Z-Admin — Функции LLM' };

export default function FunctionsPage() {
  return <FunctionsClient />;
}
