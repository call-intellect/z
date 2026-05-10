import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Org-Admin — Источники' };

/**
 * Заглушка — управление источниками появится в Фазе 10.
 */
export default function SettingsAdminSourcesPage() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Источники данных</h1>
        <p className="text-sm text-fg-tertiary">
          Подключение почты, Telegram, Google Drive и т.п. — раздел появится в
          Фазе 10.
        </p>
      </div>
      <div className="rounded-lg border border-border-subtle bg-bg-card p-4 text-sm">
        <p>
          Текущие интеграции и API-доступ — в разделе{' '}
          <Link
            href="/settings/integrations"
            className="text-accent hover:underline"
          >
            «Интеграции»
          </Link>
          . Когда Фаза 10 выйдет, здесь появится управление IngestSource (e-mail
          forward, Telegram-бот, мониторинг Google Drive).
        </p>
      </div>
    </div>
  );
}
