'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode } from 'react';
import clsx from 'clsx';

import { AdminRouteGuard } from '@/contexts/admin-route-guard';
import { useAuth } from '@/contexts/auth-context';
import { t } from '@/lib/i18n';

const NAV: Array<{ href: string; key: string }> = [
  { href: '/admin', key: 'admin.nav.home' },
  { href: '/admin/meetings', key: 'admin.nav.meetings' },
  { href: '/admin/integration-keys', key: 'admin.nav.integration_keys' },
  { href: '/admin/ai-usage', key: 'admin.nav.ai_usage' },
  { href: '/admin/recordings/expiring', key: 'admin.nav.expiring' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <AdminRouteGuard>
      <div className="flex min-h-screen bg-slate-50">
        <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
          <div className="flex h-14 items-center border-b border-slate-200 px-4 text-base font-semibold text-slate-900">
            {t('admin.title')}
          </div>
          <nav className="flex flex-col gap-1 p-3">
            {NAV.map((item) => {
              const active =
                item.href === '/admin'
                  ? pathname === '/admin'
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'rounded-md px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {t(item.key as Parameters<typeof t>[0])}
                </Link>
              );
            })}
          </nav>
          <div className="absolute bottom-0 w-60 border-t border-slate-200 p-3 text-xs text-slate-500">
            <div className="mb-2 truncate">{user?.email}</div>
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace('/');
              }}
              className="text-slate-700 hover:underline"
            >
              {t('admin.nav.logout')}
            </button>
          </div>
        </aside>
        <main className="flex-1 overflow-x-auto px-6 py-6">{children}</main>
      </div>
    </AdminRouteGuard>
  );
}
