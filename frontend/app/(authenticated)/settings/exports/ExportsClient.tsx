'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  exportsApi,
  type ExportApi,
  type ExportStatus,
  type ExportType,
} from '@/api/exports.api';
import { toast } from 'sonner';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { QueryGate } from '@/ui/components/shared/QueryGate';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

const TYPE_LABEL: Record<ExportType, string> = {
  meeting_md: 'MD',
  meeting_docx: 'DOCX',
  meeting_pdf: 'PDF',
  bulk_zip: 'Bulk ZIP',
};

const STATUS_VARIANT: Record<
  ExportStatus,
  { variant: 'default' | 'success' | 'warning' | 'danger' | 'secondary'; label: string }
> = {
  queued: { variant: 'secondary', label: 'В очереди' },
  processing: { variant: 'default', label: 'Готовим' },
  ready: { variant: 'success', label: 'Готов' },
  failed: { variant: 'danger', label: 'Ошибка' },
  expired: { variant: 'warning', label: 'Истёк' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ExportsClient() {
  const [items, setItems] = useState<ExportApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await exportsApi.list();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const res = await exportsApi.download(id);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось получить ссылку');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await ask({
      title: 'Удалить экспорт?',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await exportsApi.remove(id);
      setItems((prev) => prev.filter((e) => e.id !== id));
      toast.success('Удалено');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить');
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">Экспорты</h1>
        <p className="text-sm text-fg-secondary">
          Готовые файлы из встреч и bulk-операций.
        </p>
      </header>

      <QueryGate
        isLoading={loading}
        error={error}
        isEmpty={items.length === 0}
        skeleton={
          <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
            <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
          </div>
        }
        empty={
          <EmptyState
            title="Экспортов пока нет"
            description="Здесь будут ваши экспорты. Создайте экспорт со страницы встречи или из журнала."
          />
        }
        onRetry={() => void fetch()}
      >
        <ul className="space-y-2">
          {items.map((e) => {
            const meta = STATUS_VARIANT[e.status];
            return (
              <li
                key={e.id}
                className="flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{TYPE_LABEL[e.type]}</Badge>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="text-xs text-fg-tertiary">
                      {e.meetingIds.length === 1
                        ? `1 встреча`
                        : `${e.meetingIds.length} встречи`}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-fg-tertiary">
                    создан {formatDate(e.createdAt)}
                    {e.expiresAt && ` · истекает ${formatDate(e.expiresAt)}`}
                  </div>
                  {e.error && (
                    <div className="mt-1 text-[11px] text-danger">{e.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {e.status === 'ready' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleDownload(e.id)}
                      disabled={downloadingId === e.id}
                    >
                      {downloadingId === e.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      Скачать
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleDelete(e.id)}
                    className="hover:text-danger"
                    aria-label="Удалить"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </QueryGate>
      {confirmDialog}
    </div>
  );
}
