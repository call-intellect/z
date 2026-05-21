'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CloudUpload, Loader2, Plus } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  documentsApi,
  type DocumentApi,
  type DocumentStatusApi,
} from '@/api/documents.api';
import { rolesDomainApi, type RoleDomainApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
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
} from '../admin/AdminStateViews';

const NO_ROLE_VALUE = '__none__';

const STATUS_LABELS: Record<DocumentStatusApi, string> = {
  uploaded: 'загружен',
  parsing: 'обрабатывается',
  parsed: 'готов',
  failed: 'ошибка',
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
  const { addToast } = useToast();
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
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            setUploadOpen(false);
            void swr.mutate();
            addToast({ type: 'success', message: 'Документ загружен.' });
          }}
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
  onClose,
  onDone,
}: {
  orgId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { addToast } = useToast();
  const rolesSwr = useSWR(['upload-roles', orgId], () =>
    rolesDomainApi.list(orgId),
  );
  const [file, setFile] = useState<File | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const roles: RoleDomainApi[] = useMemo(
    () => rolesSwr.data?.items ?? [],
    [rolesSwr.data],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Загрузить документ</DialogTitle>
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
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-sm transition-colors ${
            dragOver
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary'
          }`}
        >
          <CloudUpload size={16} />
          {file
            ? `Выбран файл: ${file.name}`
            : 'Перетащите файл или нажмите, чтобы выбрать'}
          <input
            id="doc-upload"
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.md,.rtf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="space-y-1.5">
          <Label>Привязать к должности (опционально)</Label>
          <Select
            value={roleId ?? NO_ROLE_VALUE}
            onValueChange={(v) => setRoleId(v === NO_ROLE_VALUE ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Не привязывать" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ROLE_VALUE}>Не привязывать</SelectItem>
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
            Отмена
          </Button>
          <Button
            disabled={!file || busy}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              try {
                await documentsApi.upload(orgId, {
                  file,
                  attachedRoleId: roleId,
                });
                onDone();
              } catch (e) {
                addToast({
                  type: 'error',
                  message:
                    e instanceof ApiError ? e.message : 'Не удалось загрузить.',
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
            Загрузить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function documentKindLabel(kind: DocumentApi['kind']): string {
  switch (kind) {
    case 'job_description':
      return 'должностная инструкция';
    case 'regulation':
      return 'регламент';
    case 'policy':
      return 'политика';
    case 'process':
      return 'процесс';
    case 'metric':
      return 'метрика';
    case 'other':
    default:
      return 'другое';
  }
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
