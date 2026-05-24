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
 *
 * Wave 2 A7: пагинация — кнопка «Загрузить ещё» под списком; useMyInbox
 * накапливает страницы внутри себя (issues = page1 + extraItems).
 */
export function InboxClient() {
  const { currentOrgId } = useAuth();
  const { issues, isLoading, isLoadingMore, hasMore, loadMore, error } =
    useMyInbox(currentOrgId);

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
        <>
          <IssueList
            issues={issues}
            group
            emptyText="Задач, назначенных на вас, пока нет"
          />

          {/* Wave 2 A7: пагинация. Показываем «Загрузить ещё» когда есть
              следующая страница; «Это всё» — когда дошли до конца
              (и при этом что-то уже было загружено). */}
          {hasMore ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => {
                  void loadMore();
                }}
                disabled={isLoadingMore}
                className="rounded-md border border-border-subtle bg-bg-elevated px-4 py-2 text-sm font-medium text-fg-secondary transition-colors hover:border-accent/40 hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingMore ? 'Загружаем…' : 'Загрузить ещё'}
              </button>
            </div>
          ) : issues.length > 0 ? (
            <p className="pt-2 text-center text-xs text-fg-tertiary">
              Это всё
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
