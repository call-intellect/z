'use client';

import { Inbox, Clock4 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useMyInbox } from '@/hooks/tracker/useMyInbox';
import { IssueList } from '@/ui/tracker';

/**
 * `/me/inbox` — мои задачи во всех проектах.
 * Endpoint GET /api/v1/me/inbox ещё не реализован на backend (Sprint 3+).
 * Пока показываем понятный плейсхолдер.
 */
export function InboxClient() {
  const { currentOrgId } = useAuth();
  const { issues, todo } = useMyInbox(currentOrgId);

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

      {todo ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-6 py-12 text-center">
          <Clock4 size={24} className="text-fg-tertiary" />
          <div className="text-sm font-medium text-fg-primary">
            Сводка по моим задачам появится в Sprint 3
          </div>
          <p className="max-w-md text-xs text-fg-tertiary">
            Endpoint <code className="font-mono">GET /api/v1/me/inbox</code> ещё
            не готов. До тех пор открывайте задачи из конкретных проектов.
          </p>
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
