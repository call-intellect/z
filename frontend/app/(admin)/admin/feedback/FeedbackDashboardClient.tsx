'use client';

/**
 * `/admin/feedback` — клиентский компонент дашборда смысловых блоков
 * обратной связи. Все тексты — на русском.
 *
 * Фаза 7+8 ТЗ user-feedback-with-ai-clustering. Действия rename / merge /
 * archive / unarchive открывают соответствующий диалог; после успеха SWR
 * mutate перетягивает таблицу.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PlayCircle, AlertTriangle } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { adminFeedbackApi } from '@/api/admin-feedback.api';
import {
  toFeedbackTopicsList,
  type FeedbackSort,
  type FeedbackTopicSummary,
  type FeedbackWindow,
} from '@/domain/admin-feedback';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { Button } from '@/ui/shadcn/button';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../AdminStateViews';
import { ArchiveTopicDialog } from './components/ArchiveTopicDialog';
import { MergeTopicDialog } from './components/MergeTopicDialog';
import { RenameTopicDialog } from './components/RenameTopicDialog';
import { TopicsFilters } from './components/TopicsFilters';
import { TopicsTable } from './components/TopicsTable';
import { adminRootCrumb } from '@/ui/components/admin/brand';

type DialogState =
  | { kind: 'rename'; topic: FeedbackTopicSummary }
  | { kind: 'merge'; topic: FeedbackTopicSummary }
  | { kind: 'archive'; topic: FeedbackTopicSummary }
  | null;

const PAGE_SIZE = 20;

export function FeedbackDashboardClient() {
  const [window, setWindow] = useState<FeedbackWindow>('30');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState<FeedbackSort>('percent');
  const [page, setPage] = useState(1);
  const [digestRunning, setDigestRunning] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

  const swrKey = useMemo(
    () =>
      [
        'admin-feedback-topics',
        window,
        search,
        includeArchived,
        sort,
        page,
      ] as const,
    [window, search, includeArchived, sort, page],
  );

  const swr = useSWR(swrKey, async () =>
    adminFeedbackApi.listTopics({
      window,
      ...(search.trim() ? { q: search.trim() } : {}),
      includeArchived,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
  );

  const isForbidden = swr.error instanceof ApiError && swr.error.code === 'forbidden';
  const errorMessage =
    swr.error && !isForbidden
      ? swr.error instanceof ApiError
        ? swr.error.message
        : 'Не удалось загрузить список блоков'
      : null;

  const list = swr.data ? toFeedbackTopicsList(swr.data) : null;
  const totalPages = list
    ? Math.max(1, Math.ceil(list.totalTopicsInWindow / PAGE_SIZE))
    : 1;

  async function handleRunDigest() {
    setDigestRunning(true);
    try {
      const res = await adminFeedbackApi.runDigest();
      toast.success(`Запущена обработка, ID: ${res.jobId}`);
      // Обновим таблицу через короткое время, чтобы свежие блоки подтянулись.
      await swr.mutate();
    } catch (err) {
      if (err instanceof ApiError) {
        // Phase 5 ещё не подключён — backend отдаёт NotImplementedException (501).
        if (err.code === 'http_501') {
          toast.error('Обработка появится в Фазе 5 (digest-сервис ещё не подключён)');
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Не удалось запустить обработку');
      }
    } finally {
      setDigestRunning(false);
    }
  }

  function handleAction(action: 'rename' | 'merge' | 'archive', topicId: string) {
    const topic = list?.items.find((t) => t.id === topicId);
    if (!topic) {
      toast.error('Блок не найден в текущем списке. Обновите страницу.');
      return;
    }
    setDialog({ kind: action, topic });
  }

  async function refreshAfterAction() {
    await swr.mutate();
  }

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Обратная связь' },
      ]}
      title="Обратная связь пользователей"
      description="Смысловые блоки, в которые AI-кластеризатор сводит сообщения канала «Ваши предложения». Метрики считаются за выбранное окно. Действия переименовать / объединить / архивировать доступны в меню «⋯» строки."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRunDigest()}
          disabled={digestRunning}
        >
          <PlayCircle size={14} className="mr-1" />
          {digestRunning ? 'Запускаем…' : 'Запустить обработку сейчас'}
        </Button>
      }
    >
      <TopicsFilters
        window={window}
        onWindowChange={(w) => {
          setWindow(w);
          setPage(1);
        }}
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        includeArchived={includeArchived}
        onIncludeArchivedChange={(v) => {
          setIncludeArchived(v);
          setPage(1);
        }}
      />

      {list && !errorMessage && !isForbidden && (
        <div className="mb-3 mt-4 text-sm text-fg-secondary">
          За выбранный период:{' '}
          <span className="font-medium text-fg-primary">
            {list.totalItemsInWindow}
          </span>{' '}
          items от{' '}
          <span className="font-medium text-fg-primary">
            {list.totalUsersInWindow}
          </span>{' '}
          пользователей,{' '}
          <span className="font-medium text-fg-primary">
            {list.totalTopicsInWindow}
          </span>{' '}
          смысловых блоков
        </div>
      )}

      {swr.isLoading && <AdminLoading rows={8} />}
      {!swr.isLoading && isForbidden && <AdminForbidden />}
      {!swr.isLoading && errorMessage && (
        <AdminError message={errorMessage} onRetry={() => void swr.mutate()} />
      )}

      {!swr.isLoading &&
        !isForbidden &&
        !errorMessage &&
        list &&
        list.items.length === 0 && (
          <AdminEmpty
            title="Смысловых блоков пока нет"
            description="Они появятся после того, как ночной воркер (cron 01:00 UTC) обработает накопленные сообщения. Можно нажать «Запустить обработку сейчас», когда подключён Фаза 5."
          />
        )}

      {!swr.isLoading &&
        !isForbidden &&
        !errorMessage &&
        list &&
        list.items.length > 0 && (
          <>
            <TopicsTable
              topics={list.items}
              sort={sort}
              onSortChange={(s) => {
                setSort(s);
                setPage(1);
              }}
              onAction={handleAction}
            />

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Назад
                </Button>
                <span className="text-xs text-fg-tertiary">
                  Стр. {page} из {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Вперёд
                </Button>
              </div>
            )}
          </>
        )}

      <FailedMessagesHint />

      {dialog?.kind === 'rename' && (
        <RenameTopicDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
          topicId={dialog.topic.id}
          initialTitle={dialog.topic.title}
          initialDescription={dialog.topic.description}
          onSaved={() => void refreshAfterAction()}
        />
      )}

      {dialog?.kind === 'merge' && (
        <MergeTopicDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
          sourceId={dialog.topic.id}
          sourceTitle={dialog.topic.title}
          sourceItemsCount={dialog.topic.itemsCount}
          onSaved={() => void refreshAfterAction()}
        />
      )}

      {dialog?.kind === 'archive' && (
        <ArchiveTopicDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
          topicId={dialog.topic.id}
          topicTitle={dialog.topic.title}
          mode={dialog.topic.status === 'archived' ? 'unarchive' : 'archive'}
          onSaved={() => void refreshAfterAction()}
        />
      )}
    </AdminSection>
  );
}

/**
 * Информационный блок про failed-сообщения. Просто счётчик + ссылка-подсказка.
 * Полноценный список failed — отдельная страница (вне scope Phase 7), здесь
 * лишь сигнальная плашка для оператора.
 */
function FailedMessagesHint() {
  const swr = useSWR(
    'admin-feedback-failed-hint',
    async () =>
      adminFeedbackApi.listFailedMessages({ page: 1, pageSize: 1 }),
    { revalidateOnFocus: false },
  );

  // Не показываем плашку при загрузке, forbidden или пустом списке.
  if (swr.isLoading || swr.error || !swr.data || swr.data.total === 0) {
    return null;
  }

  return (
    <div className="mt-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
      <div>
        <div className="font-medium text-fg-primary">
          Сообщения, упавшие при обработке: {swr.data.total}
        </div>
        <div className="text-xs text-fg-secondary">
          У сообщений `failedRuns` {'>='} 3 — требуется ручной разбор. Список
          доступен через API `GET /api/v1/admin/feedback/messages/failed`.
        </div>
      </div>
    </div>
  );
}
