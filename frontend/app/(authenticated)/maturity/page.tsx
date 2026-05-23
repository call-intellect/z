import type { Metadata } from 'next';

import { MaturityClient } from './MaturityClient';

export const metadata: Metadata = {
  title: 'Зрелость компании',
};

/**
 * `/maturity` — сводка зрелости компании (SBA α-9 wave 3).
 *
 * Показывает агрегатный maturityScore Org + средние по ролям и отделам +
 * гистограмму распределения. Drill-down — по scope: role|department|company.
 */
export default function MaturityPage() {
  return <MaturityClient />;
}
