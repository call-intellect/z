'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import {
  ChevronLeft,
  Hash,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { themesApi } from '@/api/themes.api';
import { ApiError } from '@/api/api-error';
import {
  THEME_BRANCH_LABELS,
  THEME_DYNAMIC_LABELS,
  THEME_STATUS_LABELS,
  type ThemeBlockDomain,
  type ThemeDetailDomain,
  type ThemeEntityDomain,
  themeDetailFromApi,
} from '@/domain/theme';
import { Button } from '@/ui/shadcn/button';
import { Badge } from '@/ui/shadcn/badge';
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

export function ThemeDetailClient({ themeId }: { themeId: string }) {
  const themeSwr = useSWR(['theme', themeId], async () => {
    const api = await themesApi.get(themeId);
    return themeDetailFromApi(api);
  });

  if (themeSwr.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Тема не найдена или у вас нет доступа.
        </div>
        <Button asChild variant="ghost" className="mt-3">
          <Link href="/themes">
            <ChevronLeft size={16} /> Все темы
          </Link>
        </Button>
      </div>
    );
  }

  const detail = themeSwr.data;
  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 text-fg-tertiary">
        Загрузка…
      </div>
    );
  }

  return <ThemeDetail detail={detail} />;
}

function ThemeDetail({ detail }: { detail: ThemeDetailDomain }) {
  const { theme, blocks, entities, mergedIntoId } = detail;
  const [saveOpen, setSaveOpen] = useState(false);

  const branchLabel = theme.branch ? THEME_BRANCH_LABELS[theme.branch] : null;
  const dynamicLabel = THEME_DYNAMIC_LABELS[theme.dynamic];
  const statusLabel = THEME_STATUS_LABELS[theme.status];
  const isMerged = theme.status === 'merged_into' && mergedIntoId;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="gap-1 text-fg-tertiary">
          <Link href="/themes">
            <ChevronLeft size={16} /> Все темы
          </Link>
        </Button>
      </div>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-accent/20 text-accent">
          <Sparkles size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-2xl font-semibold">{theme.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {branchLabel && <Badge variant="default">{branchLabel}</Badge>}
            <Badge variant="secondary">{dynamicLabel}</Badge>
            <Badge
              variant={theme.status === 'active' ? 'success' : 'secondary'}
            >
              {statusLabel}
            </Badge>
            <span className="text-xs text-fg-tertiary">
              {theme.blocksCount} блоков · {theme.entitiesCount} сущностей
            </span>
          </div>
          {theme.description && (
            <p className="mt-3 text-sm text-fg-secondary">
              {theme.description}
            </p>
          )}
        </div>
        {!isMerged && theme.status === 'active' && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              className="gap-2"
              onClick={() => setSaveOpen(true)}
            >
              <Plus size={16} /> Сохранить как карточку
            </Button>
          </div>
        )}
      </header>

      {isMerged && mergedIntoId && (
        <div className="mb-6 rounded-xl border border-border-subtle bg-bg-overlay p-4 text-sm text-fg-secondary">
          Эта тема была объединена с другой.{' '}
          <Link
            href={`/themes/${encodeURIComponent(mergedIntoId)}`}
            className="text-accent hover:underline"
          >
            Перейти к актуальной теме →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Blocks */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
            Идеи в этой теме ({blocks.length})
          </h2>
          {blocks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle p-6 text-center text-sm text-fg-tertiary">
              В теме пока нет канонических блоков.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {blocks.map((b) => (
                <BlockItem key={b.id} block={b} />
              ))}
            </ul>
          )}
        </section>

        {/* Entities */}
        <aside>
          <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
            Упомянутые сущности ({entities.length})
          </h2>
          {entities.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle p-4 text-center text-xs text-fg-tertiary">
              Сущностей нет
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {entities.map((e) => (
                <EntityItem key={e.id} entity={e} />
              ))}
            </ul>
          )}
        </aside>
      </div>

      <SaveAsCardDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        themeId={theme.id}
        defaultName={theme.name}
      />
    </div>
  );
}

function BlockItem({ block }: { block: ThemeBlockDomain }) {
  return (
    <li className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-overlay text-fg-secondary">
          <Hash size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">
              {block.name}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {block.signalType}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-fg-tertiary">
            {block.criticalQuestion}
          </p>
          <p className="mt-1 line-clamp-3 text-xs text-fg-secondary">
            {block.trustedAnswer}
          </p>
        </div>
      </div>
    </li>
  );
}

function EntityItem({ entity }: { entity: ThemeEntityDomain }) {
  return (
    <li className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-overlay text-fg-secondary">
          <Users size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-fg-primary">
            {entity.canonicalName}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
            <span className="rounded-full bg-bg-overlay px-1.5 py-0.5 uppercase tracking-wide text-[10px]">
              {entity.type}
            </span>
            <span>{entity.mentionsCount} упоминаний</span>
          </div>
        </div>
      </div>
    </li>
  );
}

function SaveAsCardDialog({
  open,
  onOpenChange,
  themeId,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  themeId: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [submitting, setSubmitting] = useState(false);

  // Сбрасываем имя на defaultName при каждом открытии диалога.
  function handleOpenChange(v: boolean) {
    if (v) setName(defaultName);
    onOpenChange(v);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      toast.error('Укажите название карточки');
      return;
    }
    setSubmitting(true);
    try {
      const res = await themesApi.saveAsCard(themeId, {
        name: name.trim(),
      });
      toast.success('Карточка создана из темы');
      onOpenChange(false);
      router.push(`/cards/${encodeURIComponent(res.cardId)}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'card_name_taken') {
        toast.error('Карточка с таким названием уже существует');
      } else {
        const msg = err instanceof ApiError ? err.message : 'Не удалось сохранить';
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn('sm:max-w-md')}>
        <DialogHeader>
          <DialogTitle>Сохранить тему как карточку</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="theme-card-name">Название карточки</Label>
            <Input
              id="theme-card-name"
              autoFocus
              required
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-1 text-xs text-fg-tertiary">
              Карточка будет создана как «Тема» (kind=topic) с описанием темы.
              История связи с AI-темой сохранится.
            </p>
          </div>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Сохраняем…' : 'Создать карточку'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
