'use client';

/**
 * MergeTopicDialog — диалог объединения смыслового блока с другим (target).
 *
 * Источник target — `GET /admin/feedback/topics?window=all&pageSize=200&includeArchived=false`,
 * фильтруем сам source и любые статусы кроме ACTIVE. Дополнительно фильтруем
 * MERGED по статусу (на бэке `includeArchived=false` исключает и архив, и merged).
 *
 * Действие необратимо: на бэке source помечается MERGED, items переезжают
 * через FeedbackItem.feedbackTopicId.
 *
 * Фаза 8 ТЗ user-feedback-with-ai-clustering.
 */

import { useEffect, useMemo, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { adminFeedbackApi } from '@/api/admin-feedback.api';
import { toFeedbackTopicsList } from '@/domain/admin-feedback';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

interface MergeTopicDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  sourceId: string;
  sourceTitle: string;
  sourceItemsCount: number;
  onSaved: () => void;
}

export function MergeTopicDialog({
  open,
  onOpenChange,
  sourceId,
  sourceTitle,
  sourceItemsCount,
  onSaved,
}: MergeTopicDialogProps) {
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setTargetId(null);
    setError(null);
  }, [open]);

  const swr = useSWR(
    open ? ['admin-feedback-merge-targets', sourceId] : null,
    async () =>
      adminFeedbackApi.listTopics({
        window: 'all',
        includeArchived: false,
        pageSize: 200,
        page: 1,
        sort: 'recent',
      }),
    { revalidateOnFocus: false },
  );

  const candidates = useMemo(() => {
    if (!swr.data) return [];
    const list = toFeedbackTopicsList(swr.data).items;
    return list.filter(
      (t) => t.id !== sourceId && t.status === 'active',
    );
  }, [swr.data, sourceId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [candidates, search]);

  const target = candidates.find((t) => t.id === targetId) ?? null;

  async function handleMerge() {
    if (!targetId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await adminFeedbackApi.mergeTopics(sourceId, {
        targetId,
      });
      toast.success(
        `Готово: перенесено items — ${result.movedItems}`,
      );
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось объединить блоки';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Объединить блок с другим</DialogTitle>
          <DialogDescription>
            Items текущего блока «{sourceTitle}» переедут в выбранный целевой
            блок. Текущий блок будет помечен как объединённый. Действие
            необратимо.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="merge-search">Найти блок</Label>
            <Input
              id="merge-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию или описанию"
              disabled={saving}
            />
          </div>

          <div
            className="max-h-72 overflow-y-auto rounded-md border border-border-subtle"
            role="listbox"
            aria-label="Список целевых блоков"
          >
            {swr.isLoading && (
              <div className="p-3 text-xs text-fg-tertiary">
                Загружаем список блоков…
              </div>
            )}
            {!swr.isLoading && swr.error && (
              <div className="p-3 text-xs text-danger">
                Не удалось загрузить список блоков.
              </div>
            )}
            {!swr.isLoading && !swr.error && filtered.length === 0 && (
              <div className="p-3 text-xs text-fg-tertiary">
                {candidates.length === 0
                  ? 'Нет других активных блоков — объединять не с чем.'
                  : 'Ничего не найдено по этому запросу.'}
              </div>
            )}
            {!swr.isLoading &&
              !swr.error &&
              filtered.map((t) => {
                const selected = t.id === targetId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setTargetId(t.id)}
                    disabled={saving}
                    className={`flex w-full items-start gap-3 border-b border-border-subtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-bg-subtle ${
                      selected ? 'bg-bg-subtle' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-fg-primary">
                        {t.title}
                      </div>
                      <div className="line-clamp-2 text-xs text-fg-secondary">
                        {t.description}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums text-fg-tertiary">
                      <div>{t.itemsCount} items</div>
                      <div>{t.uniqueUsersCount} юзеров</div>
                    </div>
                  </button>
                );
              })}
          </div>

          {target && (
            <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-fg-secondary">
              <strong className="text-fg-primary">{sourceItemsCount}</strong>{' '}
              items будут перенесены в «
              <strong className="text-fg-primary">{target.title}</strong>».
              Этот блок будет помечен как объединённый. Действие необратимо.
            </p>
          )}

          {error && (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!targetId || saving}
            onClick={() => void handleMerge()}
          >
            <Shuffle size={14} />
            {saving ? 'Объединяем…' : 'Объединить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
