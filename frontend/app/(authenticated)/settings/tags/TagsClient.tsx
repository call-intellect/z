'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { tagsApi, type TagApi } from '@/api/tags.api';
import { toast } from 'sonner';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { QueryGate } from '@/ui/components/shared/QueryGate';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { cn } from '@/ui/shadcn/lib/utils';

const COLOR_PALETTE = [
  '#5EEAD4', // mint
  '#34D399',
  '#60A5FA',
  '#A78BFA',
  '#F472B6',
  '#FB923C',
  '#FBBF24',
  '#94A3B8',
];

type DialogState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; tag: TagApi };

export function TagsClient() {
  const [tags, setTags] = useState<TagApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const fetchTags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await tagsApi.list();
      setTags(res.items);
    } catch (e) {
      setError(humanizeApiError(e, 'Не удалось загрузить теги'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTags();
  }, [fetchTags]);

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await ask({
        title: 'Удалить тег?',
        description: 'Он отвяжется от всех встреч.',
        confirmLabel: 'Удалить',
        destructive: true,
      });
      if (!ok) return;
      try {
        await tagsApi.remove(id);
        setTags((prev) => prev.filter((t) => t.id !== id));
        toast.success('Тег удалён');
      } catch (e) {
        toast.error(humanizeApiError(e, 'Не удалось удалить'));
      }
    },
    [ask],
  );

  return (
    <div className="w-full">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">Теги</h1>
          <p className="text-sm text-fg-secondary">
            Метки для группировки встреч и фильтрации.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })} size="sm">
          <Plus size={14} /> Создать тег
        </Button>
      </header>

      <QueryGate
        isLoading={loading}
        error={error}
        isEmpty={tags.length === 0}
        skeleton={
          <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
            <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
          </div>
        }
        empty={
          <EmptyState
            title="Тегов пока нет"
            description="Создайте первый — и он появится при выборе на встречах."
            action={
              <Button onClick={() => setDialog({ mode: 'create' })} size="sm">
                <Plus size={14} /> Создать тег
              </Button>
            }
          />
        }
        onRetry={() => void fetchTags()}
      >
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="group flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-card p-3"
            >
              <span
                className="block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color ?? '#94A3B8' }}
              />
              <span className="flex-1 truncate text-sm font-medium text-fg-primary">
                {tag.name}
              </span>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setDialog({ mode: 'edit', tag })}
                  aria-label="Редактировать"
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void handleDelete(tag.id)}
                  aria-label="Удалить"
                  className="hover:text-danger"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </QueryGate>

      <TagDialog
        state={dialog}
        onClose={() => setDialog({ mode: 'closed' })}
        onSaved={(tag) => {
          setTags((prev) => {
            const idx = prev.findIndex((t) => t.id === tag.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = tag;
              return next;
            }
            return [...prev, tag];
          });
        }}
      />
      {confirmDialog}
    </div>
  );
}

function TagDialog({
  state,
  onClose,
  onSaved,
}: {
  state: DialogState;
  onClose: () => void;
  onSaved: (tag: TagApi) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state.mode === 'edit') {
      setName(state.tag.name);
      setColor(state.tag.color ?? COLOR_PALETTE[0]);
    } else if (state.mode === 'create') {
      setName('');
      setColor(COLOR_PALETTE[0]);
    }
  }, [state]);

  const open = state.mode !== 'closed';
  const isEdit = state.mode === 'edit';

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (isEdit) {
        const tag = await tagsApi.update(state.tag.id, { name: name.trim(), color });
        onSaved(tag);
        toast.success('Тег обновлён');
      } else {
        const tag = await tagsApi.create({ name: name.trim(), color });
        onSaved(tag);
        toast.success('Тег создан');
      }
      onClose();
    } catch (e) {
      toast.error(humanizeApiError(e, 'Не удалось сохранить'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать тег' : 'Новый тег'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Название</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              placeholder="Например: важное"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Цвет</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-7 w-7 rounded-full transition-all',
                    color === c
                      ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card'
                      : 'hover:scale-110',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Цвет ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !name.trim()}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
