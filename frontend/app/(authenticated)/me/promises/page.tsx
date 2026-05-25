import type { Metadata } from 'next';

import { MyPromisesClient } from './MyPromisesClient';

export const metadata: Metadata = {
  title: 'Мои обещания — Z',
};

/**
 * SBA β-8.2 — `/me/promises` — личный список «обещал → сделал?».
 *
 * Показывает открытые и asked обещания текущего сотрудника.
 * Backend изолирует выборку через `Person.userId === currentUserId`;
 * другие сотрудники в списке не появятся.
 */
export default function MyPromisesPage() {
  return <MyPromisesClient />;
}
