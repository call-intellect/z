'use client';

import { Inbox } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useMyInbox } from '@/hooks/tracker/useMyInbox';
import { IssueList } from '@/ui/tracker';

/**
 * `/me/inbox` — мои задачи во всех проектах текущей организации.
 *
 * Backend endpoint: `GET /api/v1/me/inbox` (cursor-based пагинация).
 * Хук `useMyInbox` уже подписан на live-события трекера через
 * `useTrackerLiveRefresh` — список обновляется при `issue.*` и `intake.triaged`.
 */
export function InboxClient() {
  const { currentOrgId } = useAuth();
  const { issues, isLoading, error } = useMyInbox(currentOrgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
          <Inbox size={18} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
            Мой инбокс
          </h1>
          <p className="text-sm text-fg-tertiary">
            Все задачи, где вы исполнитель
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Не удалось загрузить инбокс. Обнови страницу.
        </div>
      ) : (
        <IssueList
          issues={issues}
          group
          emptyText="Задач, назначенных на вас, пока нет"
        />
      )}
    </div>
  );
}
