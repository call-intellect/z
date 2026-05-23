import type { Metadata } from 'next';

import { CompanyClient } from './CompanyClient';

export const metadata: Metadata = {
  title: 'Компания',
};

/**
 * `/company` — профиль компании (SBA α-9 wave 3).
 *
 * Хранит миссию, видение, стратегию, стадию зрелости, целевые рынки.
 * Отличается от /structure тем, что /company — про идентичность,
 * /structure — про оперативную карту отделов/должностей/людей.
 */
export default function CompanyPage() {
  return <CompanyClient />;
}
