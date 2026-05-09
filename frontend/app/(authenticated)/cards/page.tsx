import type { Metadata } from 'next';

import { CardsClient } from './CardsClient';

export const metadata: Metadata = {
  title: 'Карточки',
};

export default function CardsPage() {
  return <CardsClient />;
}
