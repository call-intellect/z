'use client';

import { Eye, Loader2 } from 'lucide-react';
import useSWR from 'swr';

import { privacyApi, type AccessLogItemDto } from '@/api/privacy.api';
import { useAuth } from '@/contexts/auth-context';

const SECTION_LABELS: Record<string, string> = {
  pulse: 'Pulse-карточка',
  knowledge_profile: 'Профиль знаний',
  skill_profile: 'Профиль навыков',
  appointments: 'Назначения',
  contributions: 'Вклад',
};

function formatSection(s: string): string {
  return SECTION_LABELS[s] ?? s;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 14) return `${diffD} дн назад`;
  return d.toLocaleDateString('ru-RU');
}

function formatExact(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AccessLogClient() {
  const { currentOrgId, isLoading } = useAuth();
  const swrKey = currentOrgId ? ['privacy-access-log', currentOrgId] : null;
  const { data, error, isLoading: loading } = useSWR(
    swrKey,
    async () => privacyApi.getMyAccessLog(currentOrgId!, { limit: 100 }),
  );

  if (isLoading) {
    return (
      <section className="px-6 py-8">
        <Loader2 className="h-5 w-5 animate-spin text-fg-tertiary" />
      </section>
    );
  }

  if (!currentOrgId) {
    return (
      <section className="px-6 py-8">
        <p className="text-sm text-fg-secondary">
          Этот раздел доступен только в рамках организации.
        </p>
      </section>
    );
  }

  return (
    <section className="container mx-auto max-w-4xl space-y-4 px-4 py-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-fg-primary">
          <Eye className="text-accent" size={24} />
          Кто открывал мою карточку
        </h1>
        <p className="text-sm text-fg-secondary">
          Здесь записаны просмотры вашей pulse-карточки и связанных разделов
          (профиль знаний, навыков, назначения). Самопросмотры не записываются.
        </p>
      </header>

      {loading && (
        <div className="rounded-md border border-border-subtle bg-bg-card p-4 text-sm text-fg-tertiary">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Загружаем историю…
        </div>
      )}

      {error instanceof Error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger-fg">
          Не удалось загрузить историю: {error.message}
        </div>
      )}

      {!loading && data && data.items.length === 0 && (
        <div className="rounded-md border border-border-subtle bg-bg-card p-6 text-center text-sm text-fg-secondary">
          Пока никто не открывал вашу карточку — здесь будут записи о просмотрах.
        </div>
      )}

      {!loading && data && data.items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border-subtle bg-bg-overlay/30 text-xs uppercase text-fg-tertiary">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Кто</th>
                <th className="px-4 py-2 text-left font-medium">Раздел</th>
                <th className="px-4 py-2 text-left font-medium">Когда</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, idx) => (
                <AccessLogRow
                  key={`${item.accessedAt}-${idx}`}
                  item={item}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AccessLogRow({ item }: { item: AccessLogItemDto }) {
  const name = item.viewerUserName?.trim() || item.viewerUserEmail || 'Сотрудник Org';
  return (
    <tr className="border-b border-border-subtle last:border-b-0 hover:bg-bg-overlay/30">
      <td className="px-4 py-2.5 text-fg-primary">
        <div className="font-medium">{name}</div>
        {item.viewerUserName && item.viewerUserEmail && (
          <div className="text-xs text-fg-tertiary">{item.viewerUserEmail}</div>
        )}
      </td>
      <td className="px-4 py-2.5 text-fg-secondary">
        {formatSection(item.sectionAccessed)}
      </td>
      <td className="px-4 py-2.5 text-fg-secondary" title={formatExact(item.accessedAt)}>
        {formatRelative(item.accessedAt)}
      </td>
    </tr>
  );
}
