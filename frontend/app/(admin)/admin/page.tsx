import Link from 'next/link';

import { t } from '@/lib/i18n';

const TILES = [
  { href: '/admin/meetings', key: 'admin.home.meetings_link' },
  { href: '/admin/integration-keys', key: 'admin.home.keys_link' },
  { href: '/admin/ai-usage', key: 'admin.home.usage_link' },
  { href: '/admin/recordings/expiring', key: 'admin.home.expiring_link' },
] as const;

export default function AdminHomePage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">
        {t('admin.home.title')}
      </h1>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {TILES.map((tile) => (
          <li key={tile.href}>
            <Link
              href={tile.href}
              className="block rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100"
            >
              {t(tile.key)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
