'use client';

/**
 * `/admin/feedback/[topicId]` — клиентский компонент детальной страницы блока
 * обратной связи. Все тексты — на русском.
 *
 * Содержит:
 *   - шапку (TopicDetail) с заголовком, описанием, метриками, переключателем
 *     окна и кнопками действий (Phase 8 placeholder);
 *   - список items (TopicItemsList) с пагинацией и опциональной группировкой
 *     по пользователю;
 *   - каждый item можно развернуть (ItemRow) — подгружается полный текст
 *     исходного сообщения.
 *
 * Фаза 7 ТЗ user-feedback-with-ai-clustering.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { adminFeedbackApi } from '@/api/admin-feedback.api';
import {
  toFeedbackItemsList,
  toFeedbackTopicDetail,
  type FeedbackWindow,
} from '@/domain/admin-feedback';
import { AdminSection } from '@/ui/components/admin/AdminSection';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { TopicDetail } from '../components/TopicDetail';
import { TopicItemsList } from '../components/TopicItemsList';

const ITEMS_PAGE_SIZE = 50;

export function FeedbackTopicDetailClient({ topicId }: { topicId: string }) {
  const [window, setWindow] = useState<FeedbackWindow>('30');
  const [page, setPage] = useState(1);
  const [groupByUser, setGroupByUser] = useState(false);

  const detailKey = useMemo(
    () => ['admin-feedback-topic', topicId, window] as const,
    [topicId, window],
  );
  const detailSwr = useSWR(detailKey, async () =>
    adminFeedbackApi.getTopic(topicId, { window }),
  );

  const itemsKey = useMemo(
    () => ['admin-feedback-topic-items', topicId, page, groupByUser] as const,
    [topicId, page, groupByUser],
  );
  const itemsSwr = useSWR(itemsKey, async () =>
    adminFeedbackApi.listItems(topicId, {
      page,
      pageSize: ITEMS_PAGE_SIZE,
      groupByUser,
    }),
  );

  const isForbidden =
    (detailSwr.error instanceof ApiError && detailSwr.error.code === 'forbidden') ||
    (itemsSwr.error instanceof ApiError && itemsSwr.error.code === 'forbidden');

  const detail = detailSwr.data ? toFeedbackTopicDetail(detailSwr.data) : null;
  const itemsList = itemsSwr.data ? toFeedbackItemsList(itemsSwr.data) : null;

  const detailError =
    detailSwr.error && !isForbidden
      ? detailSwr.error instanceof ApiError
        ? detailSwr.error.message
        : 'Не удалось загрузить блок'
      : null;

  function handleAction(action: 'rename' | 'merge' | 'archive') {
    const labels: Record<typeof action, string> = {
      rename: 'Переименование',
      merge: 'Объединение',
      archive: 'Архивация / восстановление',
    };
    alert(`${labels[action]} — Фаза 8. ID блока: ${topicId}`);
  }

  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Обратная связь', href: '/admin/feedback' },
        { label: detail ? detail.title : 'Блок' },
      ]}
      title={detail ? detail.title : 'Блок обратной связи'}
      description={detail?.description ?? undefined}
    >
      {detailSwr.isLoading && <AdminLoading rows={3} />}
      {!detailSwr.isLoading && isForbidden && <AdminForbidden />}
      {!detailSwr.isLoading && detailError && (
        <AdminError
          message={detailError}
          onRetry={() => void detailSwr.mutate()}
        />
      )}

      {detail && !isForbidden && (
        <TopicDetail
          topic={detail}
          window={window}
          onWindowChange={(w) => {
            setWindow(w);
          }}
          groupByUser={groupByUser}
          onGroupByUserChange={(v) => {
            setGroupByUser(v);
            setPage(1);
          }}
          onAction={handleAction}
        />
      )}

      {detail && !isForbidden && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-medium text-fg-primary">
            Сообщения в блоке
          </h2>

          {itemsSwr.isLoading && <AdminLoading rows={6} />}

          {!itemsSwr.isLoading &&
            itemsList &&
            itemsList.items.length === 0 && (
              <AdminEmpty
                title="В этом блоке пока нет items"
                description="Item появится после следующего прогона AI-кластеризации."
              />
            )}

          {!itemsSwr.isLoading && itemsList && itemsList.items.length > 0 && (
            <TopicItemsList
              topicId={topicId}
              items={itemsList.items}
              total={itemsList.total}
              page={itemsList.page}
              pageSize={itemsList.pageSize}
              onPageChange={setPage}
              groupByUser={groupByUser}
            />
          )}
        </div>
      )}
    </AdminSection>
  );
}
