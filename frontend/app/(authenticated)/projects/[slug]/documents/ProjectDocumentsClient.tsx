'use client';

/**
 * `/projects/[slug]/documents` — список документов проекта + блок «Связанные карточки».
 *
 * Поведение по ТЗ plans/tz/2026-05-27-tracker-project-documents.md:
 *   - pinned документы — сверху, иконка пина
 *   - inline-создание: заголовок → Enter → переход в редактор `/documents/[docId]`
 *   - контекстное меню Pin/Удалить/Дублировать
 *   - блок «Связанные карточки» — collapsed по умолчанию
 *
 * Drag-n-drop сортировки в MVP-волне не реализован — sortOrder обновляется
 * через PATCH (см. TODO ниже), но UI делает только pin/unpin.
 */

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useProjectDocuments } from '@/hooks/tracker/useProjectDocuments';
import { useProjectLinkedCards } from '@/hooks/tracker/useProjectLinkedCards';
import { projectDocumentsApi } from '@/api/tracker/project-documents.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  type LinkedCard,
  linkedCardKindLabel,
  type ProjectDocumentSummary,
} from '@/domain/tracker';
import { Button } from '@/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { cn } from '@/ui/shadcn/lib/utils';

const RELATIVE_DAY_MS = 1000 * 60 * 60 * 24;
function formatRelative(d: Date): string {
  const diffDays = Math.floor((Date.now() - d.getTime()) / RELATIVE_DAY_MS);
  if (diffDays < 1) return 'сегодня';
  if (diffDays < 2) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн. назад`;
  return d.toLocaleDateString('ru-RU');
}

export function ProjectDocumentsClient({ slug }: { slug: string }) {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const { project, isLoading: projectLoading } = useProjectBySlug(
    currentOrgId,
    slug,
  );
  const {
    documents,
    isLoading: docsLoading,
    error: docsError,
    mutate: mutateDocs,
  } = useProjectDocuments(currentOrgId, project?.id);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkedExpanded, setLinkedExpanded] = useState(false);

  if (projectLoading || docsLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        Проект не найден.
      </div>
    );
  }

  if (docsError) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        Не удалось загрузить документы.
      </div>
    );
  }

  const handleCreate = async () => {
    if (!currentOrgId || !project) return;
    const title = newTitle.trim();
    if (!title) {
      toast.error('Введите название документа');
      return;
    }
    setBusy(true);
    try {
      const created = await projectDocumentsApi.create(currentOrgId, project.id, {
        title,
      });
      setNewTitle('');
      setCreating(false);
      await mutateDocs();
      router.push(`/projects/${slug}/documents/${created.id}`);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Не удалось создать документ';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePin = async (doc: ProjectDocumentSummary) => {
    if (!currentOrgId) return;
    try {
      await projectDocumentsApi.update(currentOrgId, doc.id, {
        pinned: !doc.pinned,
      });
      await mutateDocs();
    } catch (err) {
      const msg =
        humanizeApiError(err, 'Не удалось закрепить документ');
      toast.error(msg);
    }
  };

  const handleDelete = async (doc: ProjectDocumentSummary) => {
    if (!currentOrgId) return;
    const ok = window.confirm(`Удалить документ «${doc.title}»?`);
    if (!ok) return;
    try {
      await projectDocumentsApi.remove(currentOrgId, doc.id);
      await mutateDocs();
      toast.success('Документ удалён');
    } catch (err) {
      const msg =
        humanizeApiError(err, 'Не удалось удалить документ');
      toast.error(msg);
    }
  };

  const handleDuplicate = async (doc: ProjectDocumentSummary) => {
    if (!currentOrgId) return;
    try {
      const copy = await projectDocumentsApi.duplicate(currentOrgId, doc.id);
      await mutateDocs();
      toast.success(`Создана копия «${copy.title}»`);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Не удалось дублировать документ';
      toast.error(msg);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-fg-primary">
          Документы проекта
        </h2>
        {!creating ? (
          <Button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Документ
          </Button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            className="flex w-full max-w-md items-center gap-2"
          >
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Название документа"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setNewTitle('');
                  setCreating(false);
                }
              }}
            />
            <Button type="submit" disabled={busy}>
              Создать
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setNewTitle('');
                setCreating(false);
              }}
              disabled={busy}
            >
              Отмена
            </Button>
          </form>
        )}
      </header>

      {documents.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
          В проекте пока нет документов. Создайте первый — например, бриф или
          ТЗ.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li key={doc.id}>
              <div
                className={cn(
                  'group flex items-start gap-3 rounded-md border border-border-subtle bg-bg-elevated px-4 py-3 transition-colors',
                  doc.pinned && 'border-accent/60',
                )}
              >
                <Link
                  href={`/projects/${slug}/documents/${doc.id}`}
                  className="flex flex-1 items-start gap-3"
                >
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-fg-tertiary" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg-primary">
                        {doc.title}
                      </span>
                      {doc.pinned && (
                        <Pin className="h-3.5 w-3.5 shrink-0 text-accent" />
                      )}
                    </div>
                    {doc.preview && (
                      <p className="line-clamp-2 text-xs text-fg-tertiary">
                        {doc.preview}
                      </p>
                    )}
                    <span className="text-[11px] text-fg-tertiary">
                      Обновлён {formatRelative(doc.updatedAt)}
                    </span>
                  </div>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-fg-tertiary opacity-0 transition-opacity hover:bg-bg-overlay hover:text-fg-primary group-hover:opacity-100 focus:opacity-100"
                      aria-label="Меню документа"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void handleTogglePin(doc)}>
                      {doc.pinned ? (
                        <>
                          <PinOff className="mr-2 h-4 w-4" />
                          Открепить
                        </>
                      ) : (
                        <>
                          <Pin className="mr-2 h-4 w-4" />
                          Закрепить
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleDuplicate(doc)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Дублировать
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void handleDelete(doc)}
                      className="text-danger focus:text-danger"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-md border border-border-subtle bg-bg-elevated">
        <button
          type="button"
          onClick={() => setLinkedExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          aria-expanded={linkedExpanded}
        >
          <span className="text-sm font-medium text-fg-primary">
            Связанные карточки
          </span>
          {linkedExpanded ? (
            <ChevronDown className="h-4 w-4 text-fg-tertiary" />
          ) : (
            <ChevronRight className="h-4 w-4 text-fg-tertiary" />
          )}
        </button>
        {linkedExpanded && (
          <LinkedCardsBlock
            orgId={currentOrgId}
            projectId={project.id}
            enabled={linkedExpanded}
          />
        )}
      </section>
    </div>
  );
}

function LinkedCardsBlock({
  orgId,
  projectId,
  enabled,
}: {
  orgId: string | null | undefined;
  projectId: string;
  enabled: boolean;
}) {
  const { cards, isLoading, error } = useProjectLinkedCards(
    orgId,
    projectId,
    enabled,
  );

  if (isLoading) {
    return (
      <div className="border-t border-border-subtle p-4">
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-md bg-bg-overlay"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-border-subtle p-4 text-sm text-danger">
        Не удалось загрузить связанные карточки.
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="border-t border-border-subtle p-4 text-sm text-fg-tertiary">
        У задач этого проекта пока нет привязанных карточек CRM.
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
      {cards.map((card) => (
        <li key={card.id}>
          <LinkedCardRow card={card} />
        </li>
      ))}
    </ul>
  );
}

function LinkedCardRow({ card }: { card: LinkedCard }) {
  return (
    <Link
      href={`/cards/${card.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-bg-overlay"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: card.color }}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-fg-primary">{card.name}</span>
        <span className="text-xs text-fg-tertiary">
          {linkedCardKindLabel(card.kind)}
          {card.contactName ? ` · ${card.contactName}` : ''}
          {' · '}
          {card.meetingCount} встреч
        </span>
      </div>
      {card.lastMeetingAt && (
        <span className="text-xs text-fg-tertiary">
          {formatRelative(card.lastMeetingAt)}
        </span>
      )}
    </Link>
  );
}
