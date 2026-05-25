'use client';

/**
 * `/admin/skill-trait-concepts` — клиентский компонент: master-detail управление
 * «Смысловыми блоками навыка». Все тексты — на русском
 * (memory `feedback_admin_ui_russian_only`).
 *
 * Контракт API — `backend/src/modules/admin/skill-trait-concepts/`.
 * RBAC owner/admin Org.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Archive, Search, Shuffle } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  adminSkillTraitConceptsApi,
  type SkillTraitConceptDetail,
  type SkillTraitConceptListItem,
  type SkillTraitConceptStatus,
} from '@/api/admin-skill-trait-concepts.api';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../AdminStateViews';

type StatusFilter = 'all' | SkillTraitConceptStatus;

const STATUS_LABEL: Record<SkillTraitConceptStatus, string> = {
  active: 'Активный',
  merged_into: 'Слит в другой',
  archived: 'Архивный',
};

function statusBadgeVariant(
  status: SkillTraitConceptStatus,
): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'merged_into') return 'secondary';
  return 'outline';
}

export function SkillTraitConceptsClient() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listKey = useMemo(
    () => ['admin-skill-trait-concepts', statusFilter, search, page] as const,
    [statusFilter, search, page],
  );
  const listSwr = useSWR(listKey, async () =>
    adminSkillTraitConceptsApi.list({
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      page,
      pageSize: 50,
      ...(search.trim() ? { q: search.trim() } : {}),
    }),
  );
  const detailSwr = useSWR(
    selectedId ? ['admin-skill-trait-concept-detail', selectedId] : null,
    selectedId
      ? () => adminSkillTraitConceptsApi.detail(selectedId)
      : null,
  );

  const isForbidden = listSwr.error instanceof ApiError && listSwr.error.code === 'forbidden';
  const errorMessage =
    listSwr.error && !isForbidden
      ? listSwr.error instanceof ApiError
        ? listSwr.error.message
        : 'Не удалось загрузить список'
      : null;

  const items = listSwr.data?.items ?? [];
  const total = listSwr.data?.total ?? 0;
  const pageSize = listSwr.data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'AI и модели' },
        { label: 'Смысловые блоки навыка' },
      ]}
      title="Смысловые блоки навыка"
      description="Канонизация одинаковых по смыслу черт сотрудников. Когда LLM придумывает разные названия для одной и той же черты (например, «осторожен с оценками» / «не любит давать сроки без данных» / «откладывает оценку») — система автоматически сводит их в один смысловой блок."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <input
            type="text"
            placeholder="Поиск по названию и вариантам"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-9 w-72 rounded-md border border-border-subtle bg-white pl-7 pr-3 text-sm"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-56 bg-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Только активные</SelectItem>
            <SelectItem value="merged_into">Слитые в другой блок</SelectItem>
            <SelectItem value="archived">Архивные</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-fg-tertiary">
          Найдено: {total}
        </div>
      </div>

      {listSwr.isLoading && <AdminLoading rows={8} />}
      {!listSwr.isLoading && isForbidden && <AdminForbidden />}
      {!listSwr.isLoading && errorMessage && (
        <AdminError message={errorMessage} onRetry={() => void listSwr.mutate()} />
      )}

      {!listSwr.isLoading && !isForbidden && !errorMessage && items.length === 0 && (
        <AdminEmpty
          title="Смысловых блоков нет"
          description="Они появляются автоматически по мере анализа речи сотрудников. Если у вас уже есть SkillTrait'ы — запустите бэкфилл: `bun run scripts/skill-trait-concepts-backfill.ts`."
        />
      )}

      {!listSwr.isLoading && !isForbidden && !errorMessage && items.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {/* Левая колонка — список */}
          <div className="col-span-12 md:col-span-5">
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-white">
              <ul className="divide-y divide-border-subtle">
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(it.id)}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-bg-subtle ${
                        selectedId === it.id ? 'bg-bg-subtle' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-fg-primary">
                          {it.canonicalName}
                        </span>
                        <Badge variant={statusBadgeVariant(it.status)}>
                          {STATUS_LABEL[it.status]}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-fg-tertiary">
                        <span>Наблюдений: {it.traitCount}</span>
                        {it.variants.length > 1 && (
                          <span>Вариантов: {it.variants.length}</span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2">
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
          </div>

          {/* Правая колонка — карточка */}
          <div className="col-span-12 md:col-span-7">
            {!selectedId && (
              <div className="rounded-lg border border-dashed border-border-subtle p-8 text-center text-sm text-fg-tertiary">
                Выберите смысловой блок слева, чтобы посмотреть подробности.
              </div>
            )}
            {selectedId && detailSwr.isLoading && <AdminLoading rows={4} />}
            {selectedId &&
              detailSwr.data &&
              (() => {
                const detail = detailSwr.data;
                return (
                  <ConceptDetailCard
                    concept={detail}
                    allActive={items.filter(
                      (it) => it.status === 'active' && it.id !== detail.id,
                    )}
                    onChanged={async () => {
                      await Promise.all([listSwr.mutate(), detailSwr.mutate()]);
                    }}
                  />
                );
              })()}
          </div>
        </div>
      )}
    </AdminSection>
  );
}

function ConceptDetailCard({
  concept,
  allActive,
  onChanged,
}: {
  concept: SkillTraitConceptDetail;
  allActive: SkillTraitConceptListItem[];
  onChanged: () => Promise<void>;
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border-subtle bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-fg-primary">
            {concept.canonicalName}
          </h3>
          <div className="mt-1 text-xs text-fg-tertiary">
            Статус: {STATUS_LABEL[concept.status]} · Наблюдений:{' '}
            {concept.traitCount} · Первое появление:{' '}
            {new Date(concept.firstSeenAt).toLocaleDateString('ru-RU')}
          </div>
        </div>
        {concept.status === 'active' && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMergeOpen(true)}
            >
              <Shuffle size={14} className="mr-1" />
              Слить с другим
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveOpen(true)}
            >
              <Archive size={14} className="mr-1" />
              Архивировать
            </Button>
          </div>
        )}
      </div>

      {concept.description && (
        <p className="mt-3 text-sm text-fg-secondary">{concept.description}</p>
      )}

      {concept.variants.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium uppercase text-fg-tertiary">
            Варианты названия ({concept.variants.length})
          </div>
          <ul className="mt-1 flex flex-wrap gap-1">
            {concept.variants.map((v) => (
              <li key={v}>
                <Badge variant="outline" className="text-xs">
                  {v}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {concept.recentTraits.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium uppercase text-fg-tertiary">
            Последние черты ({concept.recentTraits.length})
          </div>
          <ul className="mt-1 space-y-2">
            {concept.recentTraits.map((t) => (
              <li
                key={t.id}
                className="rounded border border-border-subtle p-2 text-xs"
              >
                <div className="flex items-center justify-between text-fg-tertiary">
                  <span>
                    {t.personName ?? 'Без имени'} · {t.category}
                  </span>
                  <span>
                    {new Date(t.lastConfirmedAt).toLocaleDateString('ru-RU')}
                  </span>
                </div>
                <div className="mt-1 text-fg-primary">«{t.statement}»</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mergeOpen && (
        <MergeDialog
          concept={concept}
          options={allActive}
          onClose={() => setMergeOpen(false)}
          onDone={async () => {
            setMergeOpen(false);
            await onChanged();
          }}
        />
      )}
      {archiveOpen && (
        <ArchiveDialog
          concept={concept}
          onClose={() => setArchiveOpen(false)}
          onDone={async () => {
            setArchiveOpen(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function MergeDialog({
  concept,
  options,
  onClose,
  onDone,
}: {
  concept: SkillTraitConceptDetail;
  options: SkillTraitConceptListItem[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [targetId, setTargetId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    targetId && targetId !== concept.id && reason.trim().length >= 3 && !submitting;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await adminSkillTraitConceptsApi.merge(concept.id, {
        targetId,
        reason: reason.trim(),
      });
      await onDone();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Не удалось слить смысловые блоки');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Слить с другим смысловым блоком</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            Текущий блок:{' '}
            <span className="font-medium text-fg-primary">
              {concept.canonicalName}
            </span>{' '}
            будет помечен «слит в другой», а все его {concept.traitCount} наблюдений
            перейдут к выбранному.
          </div>
          <div>
            <label className="text-xs text-fg-secondary">Целевой смысловой блок</label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger className="mt-1 bg-white text-sm">
                <SelectValue placeholder="Выберите блок-цель…" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.canonicalName} ({o.traitCount} набл.)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-fg-secondary">Причина (обязательно)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-border-subtle bg-white p-2 text-sm"
              rows={3}
              placeholder="Почему сливаете?"
            />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? 'Слияние…' : 'Слить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({
  concept,
  onClose,
  onDone,
}: {
  concept: SkillTraitConceptDetail;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = reason.trim().length >= 3 && !submitting;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await adminSkillTraitConceptsApi.archive(concept.id, {
        reason: reason.trim(),
      });
      await onDone();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Не удалось архивировать смысловой блок');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Архивировать смысловой блок</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            «{concept.canonicalName}» больше не будет использоваться для новых
            наблюдений. Существующие черты останутся связаны с этим блоком, но
            новые попадут в другие концепты.
          </div>
          <div>
            <label className="text-xs text-fg-secondary">Причина (обязательно)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-border-subtle bg-white p-2 text-sm"
              rows={3}
              placeholder="Почему архивируете?"
            />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? 'Архивация…' : 'Архивировать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
