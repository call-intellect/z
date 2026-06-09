import type { Metadata } from 'next';

import { StructureClient } from './StructureClient';

export const metadata: Metadata = {
  title: 'Структура',
};

/**
 * `/structure` — серверная обёртка. Бизнес-логика, выбор таба, CRUD —
 * целиком в <StructureClient>. Доступ — все авторизованные; кнопки
 * редактирования скрыты для manager (см. компонент).
 */
export default function StructurePage() {
  return <StructureClient />;
}
