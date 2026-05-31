'use client';

/**
 * `/admin/media/retention` — настройки сроков хранения. Фаза 7 редизайна.
 *
 * Контракт UI:
 *   - AdminSection + таблица: тип / дни / описание / автор / время / действия.
 *   - Кнопка «Изменить» открывает диалог: input дней + textarea reason ≥ 10
 *     (severity='high'). Перед сохранением — кнопка «Предпросмотр», которая
 *     зовёт GET /preview?days=Y и показывает количество затронутых объектов
 *     + сэмпл идентификаторов.
 *   - Save → PATCH /admin/media/retention/:type { days, reason }.
 *
 * Все строки на русском. При отсутствии бэкенда (404) — AdminEmpty.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { adminRetentionApi } from '@/api/admin-retention.api';
import { ApiError } from '@/api/api-error';
import {
  retentionPolicyFromApi,
  retentionPreviewFromApi,
  RETENTION_TYPE_LABELS,
  type RetentionPolicyDomain,
  type RetentionPreviewDomain,
} from '@/domain/admin-retention';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { Badge } from '@/ui/shadcn/badge';
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
import { Textarea } from '@/ui/shadcn/textarea';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const MIN_REASON_LENGTH = 10;

export function RetentionClient() {
  const q = useAdminQuery('admin-retention-list', async () => {
    const res = await adminRetentionApi.list();
    return res.map(retentionPolicyFromApi);
  });

  const [editing, setEditing] = useState<RetentionPolicyDomain | null>(null);

  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Записи и медиа' },
        { label: 'Сроки хранения' },
      ]}
      title="Сроки хранения"
      description="Сколько дней хранить записи встреч, журналы доступа и доставки webhook. Изменение фиксируется в журнале super_admin (требуется причина не короче 10 символов)."
    >
      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.error && !q.isForbidden && !q.data ? (
        <AdminEmpty
          title="Сроки хранения недоступны"
          description="Backend-эндпоинт /api/v1/admin/media/retention ещё не реализован. Управление перейдёт сюда после Фазы 7 (backend)."
        />
      ) : null}
      {!q.isLoading && q.data && q.data.length === 0 ? (
        <AdminEmpty
          title="Политики хранения не настроены"
          description="Засейте таблицу RetentionPolicy дефолтными значениями (см. backend/scripts)."
        />
      ) : null}
      {!q.isLoading && q.data && q.data.length > 0 ? (
        <RetentionTable
          policies={q.data}
          onEdit={(p) => setEditing(p)}
        />
      ) : null}

      <EditDialog
        policy={editing}
        onClose={(saved) => {
          setEditing(null);
          if (saved) q.refetch();
        }}
      />
    </AdminSection>
  );
}

// ─────────────────────────── Таблица ───────────────────────────

function RetentionTable({
  policies,
  onEdit,
}: {
  policies: RetentionPolicyDomain[];
  onEdit: (p: RetentionPolicyDomain) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Тип</th>
            <th className="px-3 py-2 text-left">Срок (дней)</th>
            <th className="px-3 py-2 text-left">Описание</th>
            <th className="px-3 py-2 text-left">Кто изменил</th>
            <th className="px-3 py-2 text-left">Когда</th>
            <th className="px-3 py-2 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) => (
            <tr
              key={p.type}
              className="border-t border-border-subtle align-top hover:bg-bg-overlay"
            >
              <td className="px-3 py-2">
                <div className="flex flex-col">
                  <span className="font-medium text-fg-primary">
                    {p.displayName}
                  </span>
                  <span className="font-mono text-[10px] text-fg-tertiary">
                    {p.type}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 text-sm font-semibold">
                {p.days}
              </td>
              <td className="px-3 py-2 text-xs text-fg-secondary">
                {p.description ?? '—'}
              </td>
              <td className="px-3 py-2 text-xs">{p.updatedBy ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-fg-tertiary">
                {p.updatedAt.toLocaleString('ru-RU')}
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(p)}
                  aria-label={`Изменить срок для ${p.displayName}`}
                >
                  <Pencil size={13} aria-hidden />
                  <span className="ml-1">Изменить</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────── Диалог редактирования ───────────────────────────

function EditDialog({
  policy,
  onClose,
}: {
  policy: RetentionPolicyDomain | null;
  onClose: (saved: boolean) => void;
}) {
  const [days, setDays] = useState<number>(policy?.days ?? 0);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RetentionPreviewDomain | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const open = policy !== null;

  const reset = useCallback(() => {
    setReason('');
    setError(null);
    setPreview(null);
    setPreviewLoading(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (saving) return;
      if (!next) {
        reset();
        onClose(false);
      }
    },
    [saving, reset, onClose],
  );

  // При открытии диалога — синхронизируем days с текущим значением policy,
  // чтобы поле всегда отражало серверное значение (а не залипшее с прошлого
  // редактирования).
  useEffect(() => {
    if (policy) {
      setDays(policy.days);
      setReason('');
      setError(null);
      setPreview(null);
    }
  }, [policy]);

  const handlePreview = useCallback(async () => {
    if (!policy) return;
    setPreviewLoading(true);
    setPreview(null);
    setError(null);
    try {
      const res = await adminRetentionApi.preview(policy.type, days);
      setPreview(retentionPreviewFromApi(res));
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось получить предпросмотр';
      setError(msg);
    } finally {
      setPreviewLoading(false);
    }
  }, [policy, days]);

  const handleSave = useCallback(async () => {
    if (!policy) return;
    setError(null);
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setError(
        `Опишите причину минимум в ${MIN_REASON_LENGTH} символов — это требование журнала super_admin.`,
      );
      return;
    }
    if (!Number.isFinite(days) || days < 1) {
      setError('Срок должен быть положительным целым числом дней.');
      return;
    }
    setSaving(true);
    try {
      await adminRetentionApi.update(policy.type, days, trimmed);
      toast.success(`Срок хранения для «${policy.displayName}» обновлён.`);
      reset();
      onClose(true);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось сохранить';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [policy, days, reason, reset, onClose]);

  if (!policy) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Изменить срок хранения: {policy.displayName}
          </DialogTitle>
          <DialogDescription>
            Текущий срок — {policy.days} дн. Нажмите «Предпросмотр», чтобы
            увидеть количество объектов, которые будут удалены при сокращении
            срока. Сохранение требует причины.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="retention-days"
              className="text-xs font-medium text-fg-secondary"
            >
              Срок хранения (дней)
            </label>
            <Input
              id="retention-days"
              type="number"
              min={1}
              max={3650}
              value={days}
              disabled={saving}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setDays(n);
                setPreview(null);
              }}
            />
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handlePreview()}
              disabled={previewLoading || saving || days === policy.days}
            >
              {previewLoading ? (
                <Loader2 size={13} className="mr-1 animate-spin" aria-hidden />
              ) : (
                <Eye size={13} className="mr-1" aria-hidden />
              )}
              Предпросмотр
            </Button>
          </div>

          {preview ? <PreviewBlock preview={preview} /> : null}

          <div className="flex flex-col gap-1">
            <label
              htmlFor="retention-reason"
              className="text-xs font-medium text-fg-secondary"
            >
              Причина изменения
              <span className="ml-1 text-danger">*</span>
            </label>
            <Textarea
              id="retention-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Минимум ${MIN_REASON_LENGTH} символов. Будет сохранено в журнале super_admin.`}
              rows={3}
              disabled={saving}
            />
            <p className="text-[11px] text-fg-tertiary">
              {reason.trim().length}/{MIN_REASON_LENGTH}
            </p>
          </div>

          {error ? (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="sm:gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={saving}
            onClick={() => handleOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 size={13} className="mr-1 animate-spin" aria-hidden />
            ) : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBlock({ preview }: { preview: RetentionPreviewDomain }) {
  const isShrinking = preview.newDays < preview.currentDays;
  return (
    <div
      className={
        isShrinking
          ? 'rounded-md border border-warning/40 bg-warning/5 p-3 text-xs'
          : 'rounded-md border border-border-subtle bg-bg-overlay p-3 text-xs'
      }
    >
      <p className="text-fg-primary">
        При изменении с <span className="font-semibold">{preview.currentDays}</span>{' '}
        дней на <span className="font-semibold">{preview.newDays}</span> дней
        будет удалено{' '}
        <Badge variant={isShrinking ? 'danger' : 'secondary'}>
          {preview.affectedCount}
        </Badge>{' '}
        объектов.
      </p>
      {preview.warning ? (
        <p className="mt-1 text-warning">{preview.warning}</p>
      ) : null}
      {preview.sampleIds.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-fg-secondary">
            Примеры идентификаторов ({preview.sampleIds.length})
          </summary>
          <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-[10px] text-fg-tertiary">
            {preview.sampleIds.map((id) => (
              <li key={id} className="truncate" title={id}>
                {id}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// Сохраняем для возможного использования снаружи.
export { RETENTION_TYPE_LABELS };
