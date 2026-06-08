'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CloudUpload, Loader2, Plus, X } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  ACCEPTED_DOCUMENT_ACCEPT,
  documentKindLabel,
  documentTypeLabel,
  documentsApi,
  type DocumentApi,
  type DocumentStatusApi,
  type DocumentTypeApi,
  type UploadDocumentItemApi,
} from '@/api/documents.api';
import { rolesDomainApi, type RoleDomainApi } from '@/api/structure.api';
import { themesApi } from '@/api/themes.api';
import { projectsApi } from '@/api/tracker/projects.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '@app/(admin)/admin/AdminStateViews';

const NO_VALUE = '__none__';

const STATUS_LABELS: Record<DocumentStatusApi, string> = {
  uploaded: 'загружен',
  parsing: 'обрабатывается',
  parsed: 'готов',
  failed: 'ошибка',
};

/** Смысловые типы документа для селекта «Тип документа» (ТЗ-4 Ф5). */
const DOC_TYPE_OPTIONS: ReadonlyArray<{ value: DocumentTypeApi; label: string }> =
  [
    { value: 'regulation', label: documentTypeLabel('regulation') },
    { value: 'policy', label: documentTypeLabel('policy') },
    { value: 'instruction', label: documentTypeLabel('instruction') },
    { value: 'process', label: documentTypeLabel('process') },
    { value: 'job_description', label: documentTypeLabel('job_description') },
    { value: 'other', label: documentTypeLabel('other') },
  ];

/** Статус файла в очереди загрузки (ТЗ-4 Ф5). */
type QueueStatus = 'pending' | 'uploading' | 'done' | 'deduped' | 'error';

interface QueueItem {
  file: File;
  status: QueueStatus;
}

const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  pending: 'ожидание',
  uploading: 'загрузка',
  done: 'готово',
  deduped: 'дубликат',
  error: 'ошибка',
};

/**
 * `/documents` — список документов. Polling раз в 2 сек включается
 * автоматически, если есть документы в статусе `uploaded`/`parsing`
 * (через SWR refreshInterval с условием).
 */
export function DocumentsListClient() {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках Org."
      />
    );
  }
  return <Content orgId={currentOrgId} />;
}

function Content({ orgId }: { orgId: string }) {
  const [uploadOpen, setUploadOpen] = useState(false);

  const swr = useSWR(
    ['documents-list', orgId],
    () => documentsApi.list(orgId),
    {
      revalidateOnFocus: false,
      refreshInterval: (latestData) => {
        const items = latestData?.items ?? [];
        const hasProcessing = items.some(
          (d) => d.status === 'uploaded' || d.status === 'parsing',
        );
        return hasProcessing ? 2000 : 0;
      },
    },
  );

  if (swr.error) {
    if (swr.error instanceof ApiError && swr.error.code === 'http_404') {
      return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <AdminEmpty
            title="Раздел в разработке"
            description="API документов ещё не подключён."
          />
        </div>
      );
    }
    if (swr.error instanceof ApiError && swr.error.code === 'forbidden') {
      return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <AdminForbidden />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <AdminError
          message={swr.error instanceof Error ? swr.error.message : 'Ошибка'}
          onRetry={() => void swr.mutate()}
        />
      </div>
    );
  }

  const items = swr.data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Документы
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Загруженные файлы и их статус парсинга.
          </p>
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Plus size={14} className="mr-1" /> Загрузить документ
        </Button>
      </header>

      {swr.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-10 w-full animate-pulse rounded-md bg-bg-overlay"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <AdminEmpty
          title="Документов пока нет"
          description="Загрузите первый файл кнопкой выше."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay/40 text-xs uppercase tracking-wider text-fg-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">Имя</th>
                <th className="px-4 py-2 text-left">Тип</th>
                <th className="px-4 py-2 text-left">Формат</th>
                <th className="px-4 py-2 text-left">Кем загружен</th>
                <th className="px-4 py-2 text-left">К должности</th>
                <th className="px-4 py-2 text-left">Статус</th>
                <th className="px-4 py-2 text-right">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploadOpen && (
        <UploadDocumentDialog
          orgId={orgId}
          onUploaded={() => void swr.mutate()}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  );
}

function DocumentRow({ doc }: { doc: DocumentApi }) {
  return (
    <tr className="hover:bg-bg-overlay/30">
      <td className="px-4 py-2 font-medium text-fg-primary">
        <Link
          href={`/documents/${encodeURIComponent(doc.id)}`}
          className="hover:text-accent"
        >
          {doc.name}
        </Link>
      </td>
      <td className="px-4 py-2 text-fg-secondary">
        {documentTypeLabel(doc.docType ?? null)}
      </td>
      <td className="px-4 py-2 text-fg-secondary">{documentKindLabel(doc.kind)}</td>
      <td className="px-4 py-2 text-fg-secondary">{doc.uploaderName ?? '—'}</td>
      <td className="px-4 py-2 text-fg-secondary">
        {doc.attachedRoleId ? (
          <Link
            href={`/roles/${encodeURIComponent(doc.attachedRoleId)}`}
            className="hover:text-accent"
          >
            {doc.attachedRoleName ?? 'должность'}
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={doc.status} />
      </td>
      <td className="px-4 py-2 text-right text-xs text-fg-tertiary tabular-nums">
        {formatDate(doc.createdAt)}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: DocumentStatusApi }) {
  const variant =
    status === 'parsed'
      ? 'default'
      : status === 'failed'
        ? 'outline'
        : 'secondary';
  return (
    <Badge
      variant={variant}
      className={`text-[10px] ${status === 'failed' ? 'text-danger' : ''}`}
    >
      {(status === 'parsing' || status === 'uploaded') && (
        <Loader2 size={10} className="mr-1 inline animate-spin" />
      )}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function UploadDocumentDialog({
  orgId,
  onUploaded,
  onClose,
}: {
  orgId: string;
  onUploaded: () => void;
  onClose: () => void;
}) {
  const rolesSwr = useSWR(['upload-roles', orgId], () =>
    rolesDomainApi.list(orgId),
  );
  const themesSwr = useSWR(['upload-themes', orgId], () =>
    themesApi.list({ limit: 100 }),
  );
  const projectsSwr = useSWR(['upload-projects', orgId], () =>
    projectsApi.list(orgId),
  );

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocumentTypeApi | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const roles: RoleDomainApi[] = useMemo(
    () => rolesSwr.data?.items ?? [],
    [rolesSwr.data],
  );
  const themes = useMemo(() => themesSwr.data?.items ?? [], [themesSwr.data]);
  const projects = useMemo(
    () => projectsSwr.data?.items ?? [],
    [projectsSwr.data],
  );

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;
    setQueue((prev) => {
      // Дедуп по имени+размеру, чтобы повторный выбор не плодил строки.
      const seen = new Set(prev.map((q) => `${q.file.name}::${q.file.size}`));
      const next = [...prev];
      for (const f of list) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push({ file: f, status: 'pending' });
        }
      }
      return next;
    });
  };

  const doneCount = queue.filter(
    (q) => q.status === 'done' || q.status === 'deduped',
  ).length;
  const total = queue.length;

  const handleUpload = async () => {
    if (queue.length === 0) return;
    setBusy(true);
    setQueue((prev) =>
      prev.map((q) =>
        q.status === 'pending' || q.status === 'error'
          ? { ...q, status: 'uploading' }
          : q,
      ),
    );
    try {
      const res = await documentsApi.uploadBatch(orgId, {
        files: queue.map((q) => q.file),
        attachedRoleId: roleId,
        attachedThemeId: themeId,
        attachedProjectId: projectId,
        docType,
      });
      // Сопоставляем результат с очередью по имени файла. Backend сохраняет
      // порядок (files[] → items[]), имя — дополнительная страховка.
      setQueue((prev) =>
        prev.map((q, idx) => {
          const item: UploadDocumentItemApi | undefined =
            res.items[idx]?.name === q.file.name
              ? res.items[idx]
              : res.items.find((i) => i.name === q.file.name);
          if (!item) return { ...q, status: 'error' };
          return { ...q, status: item.deduped ? 'deduped' : 'done' };
        }),
      );
      onUploaded();
      const dedupedCount = res.items.filter((i) => i.deduped).length;
      const createdCount = res.items.length - dedupedCount;
      toast.success(
        dedupedCount > 0
          ? `Загружено: ${createdCount}; дубликатов: ${dedupedCount}.`
          : `Загружено документов: ${createdCount}.`,
      );
    } catch (e) {
      setQueue((prev) =>
        prev.map((q) =>
          q.status === 'uploading' ? { ...q, status: 'error' } : q,
        ),
      );
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось загрузить.',
      );
    } finally {
      setBusy(false);
    }
  };

  const allDone =
    total > 0 && queue.every((q) => q.status === 'done' || q.status === 'deduped');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Загрузить документы</DialogTitle>
        </DialogHeader>

        <label
          htmlFor="doc-upload"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-sm transition-colors ${
            dragOver
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary'
          }`}
        >
          <CloudUpload size={18} />
          <span>Перетащите файлы или нажмите, чтобы выбрать</span>
          <span className="text-[11px] text-fg-tertiary">
            PDF, Word, Excel, PowerPoint, Markdown, текст, HTML, RTF, ODT, CSV
          </span>
          <input
            id="doc-upload"
            type="file"
            multiple
            className="hidden"
            accept={ACCEPTED_DOCUMENT_ACCEPT}
            onChange={(e) => {
              addFiles(e.target.files);
              // Сбрасываем, чтобы повторный выбор того же файла снова срабатывал.
              e.target.value = '';
            }}
          />
        </label>

        {queue.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-fg-tertiary">
              <span>Файлы ({total})</span>
              <span>
                Готово {doneCount} из {total}
              </span>
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2">
              {queue.map((q, idx) => (
                <li
                  key={`${q.file.name}-${q.file.size}-${idx}`}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {q.status === 'uploading' && (
                      <Loader2 size={11} className="animate-spin text-fg-tertiary" />
                    )}
                    <span className="truncate text-fg-primary">{q.file.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <QueueStatusBadge status={q.status} />
                    {!busy && (q.status === 'pending' || q.status === 'error') && (
                      <button
                        type="button"
                        className="text-fg-tertiary hover:text-danger"
                        aria-label="Убрать файл"
                        onClick={() =>
                          setQueue((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Тип документа (опционально)</Label>
          <Select
            value={docType ?? NO_VALUE}
            onValueChange={(v) =>
              setDocType(v === NO_VALUE ? null : (v as DocumentTypeApi))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Не указывать" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>Не указывать</SelectItem>
              {DOC_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Тема (опционально)</Label>
          {themes.length === 0 ? (
            <p className="text-xs text-fg-tertiary">
              Темы появятся после первых встреч.
            </p>
          ) : (
            <Select
              value={themeId ?? NO_VALUE}
              onValueChange={(v) => setThemeId(v === NO_VALUE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Не привязывать" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
                {themes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Проект (опционально)</Label>
          {projects.length === 0 ? (
            <p className="text-xs text-fg-tertiary">Проектов пока нет.</p>
          ) : (
            <Select
              value={projectId ?? NO_VALUE}
              onValueChange={(v) => setProjectId(v === NO_VALUE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Не привязывать" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Привязать к должности (опционально)</Label>
          <Select
            value={roleId ?? NO_VALUE}
            onValueChange={(v) => setRoleId(v === NO_VALUE ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Не привязывать" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {allDone ? 'Закрыть' : 'Отмена'}
          </Button>
          <Button disabled={queue.length === 0 || busy || allDone} onClick={handleUpload}>
            {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
            Загрузить{total > 0 ? ` (${total})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueueStatusBadge({ status }: { status: QueueStatus }) {
  const variant =
    status === 'done'
      ? 'default'
      : status === 'error'
        ? 'outline'
        : 'secondary';
  return (
    <Badge
      variant={variant}
      className={`text-[10px] ${status === 'error' ? 'text-danger' : ''}`}
    >
      {QUEUE_STATUS_LABELS[status]}
    </Badge>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
