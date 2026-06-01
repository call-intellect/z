'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  appointmentsApi,
  type AppointmentTimelineItemApi,
} from '@/api/appointments.api';
import { commitmentsApi } from '@/api/commitments.api';
import type { CommitmentApi, CommitmentStatusApi } from '@/api/promises.api';
import {
  personsApi,
  type EraseReportApi,
  type PersonDetailApi,
} from '@/api/persons.api';
import type { CurrentOrgRole } from '@/domain/account';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
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
import { Textarea } from '@/ui/shadcn/textarea';

import { PersonSubpagesNav } from '@/ui/components/persons/PersonSubpagesNav';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

const ERASED_NAME = '[удалено по запросу]';

/**
 * `/persons/[id]` — карточка персоны (минимальная) + блок «Удалить все
 * данные о персоне» (152-ФЗ, owner-only).
 *
 * Шаг 13 Фазы 11. Бэкэнд:
 *   - GET    /api/v1/knowledge/entities/:id          — данные сущности.
 *   - DELETE /api/v1/persons/:entityId/data          — стирание.
 *
 * UX-состояния (frontend-rules):
 *   loading / forbidden / not-found / data + диалоговое подтверждение в
 *   две стадии (сравнение ФИО + причина).
 */
export function PersonDetailClient({ entityId }: { entityId: string }) {
  const {
    currentOrgId,
    currentOrgRole,
    user,
    isLoading: authLoading,
  } = useAuth();

  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной Org. Попросите владельца пригласить вас."
      />
    );
  }

  return (
    <PersonDetailContent
      entityId={entityId}
      orgId={currentOrgId}
      isOwner={currentOrgRole === 'owner'}
      orgRole={currentOrgRole}
      isSuperAdmin={user?.isSuperAdmin === true}
    />
  );
}

function PersonDetailContent({
  entityId,
  orgId,
  isOwner,
  orgRole,
  isSuperAdmin,
}: {
  entityId: string;
  orgId: string;
  isOwner: boolean;
  orgRole: CurrentOrgRole;
  isSuperAdmin: boolean;
}) {
  const [data, setData] = useState<PersonDetailApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    setNotFound(false);
    try {
      const dto = await personsApi.getEntity(orgId, entityId);
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'forbidden') setForbidden(true);
        else if (e.code === 'entity_not_found' || e.code === 'http_404') {
          setNotFound(true);
        } else {
          setError(e.message);
        }
      } else {
        setError('Ошибка загрузки');
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) return <AdminLoading rows={6} />;
  if (forbidden) {
    return (
      <AdminForbidden
        title="Нет прав на просмотр"
        description="Этот раздел доступен авторизованным сотрудникам Org."
      />
    );
  }
  if (notFound) {
    return (
      <AdminForbidden
        title="Персона не найдена"
        description="Сущность не существует или не принадлежит вашей Org."
      />
    );
  }
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  const { entity, blocks } = data;
  const isAlreadyErased = entity.canonicalName === ERASED_NAME;
  const isPerson = entity.type === 'person';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-fg-tertiary">
          Персона
        </p>
        <h1 className="text-2xl font-semibold">{entity.canonicalName}</h1>
        <p className="text-sm text-fg-secondary">
          Тип: <code className="font-mono text-xs">{entity.type}</code>
          {' · '}
          Упоминаний: {entity.mentionsCount}
          {entity.aliases.length > 0 && (
            <>
              {' · '}
              Алиасы: {entity.aliases.join(', ')}
            </>
          )}
        </p>
      </header>

      <PersonSubpagesNav entityId={entityId} />

      <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="mb-3 text-base font-medium">Связанные блоки знаний</h2>
        {blocks.length === 0 ? (
          <p className="text-sm text-fg-tertiary">
            Нет canonical-блоков, в которых упомянута персона.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {blocks.map((b) => (
              <li key={b.id} className="py-2.5">
                <div className="text-sm font-medium">{b.name}</div>
                <p className="mt-0.5 text-xs text-fg-tertiary">
                  {b.criticalQuestion}
                </p>
                <p className="mt-1 text-xs text-fg-secondary">
                  {b.trustedAnswer}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isPerson && (
        <AppointmentsTimelineSection orgId={orgId} entityId={entityId} />
      )}

      {isPerson && canSeePersonCommitments(orgRole, isSuperAdmin) && (
        <PersonCommitmentsSection entityId={entityId} />
      )}

      {isOwner && isPerson && !isAlreadyErased && (
        <section className="space-y-3 rounded-lg border border-danger/40 bg-danger/5 p-5">
          <div className="flex gap-3">
            <AlertTriangle
              size={20}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-danger"
            />
            <div className="space-y-1">
              <h2 className="text-base font-medium text-danger">
                Удаление личных данных (152-ФЗ)
              </h2>
              <p className="text-sm text-fg-secondary">
                Необратимая операция. Будут стёрты все RawEvent-источники с
                упоминанием персоны, удалены связанные evidence и связи между
                сущностями. Блоки без оставшихся источников переведутся в
                архив. Сама сущность будет обезличена. Действие фиксируется в
                AuditLog.
              </p>
            </div>
          </div>
          <Button
            variant="destructive"
            onClick={() => setDialogOpen(true)}
            className="bg-danger text-danger-fg hover:bg-danger/90"
          >
            <Trash2 size={14} className="mr-1.5" />
            Удалить все данные о персоне
          </Button>
        </section>
      )}

      {isAlreadyErased && (
        <section className="rounded-lg border border-border-subtle bg-bg-overlay p-5 text-sm text-fg-secondary">
          Эта персона уже обезличена. Все личные данные были удалены.
        </section>
      )}

      {!isOwner && isPerson && (
        <section className="rounded-lg border border-border-subtle bg-bg-overlay p-5 text-sm text-fg-tertiary">
          Удаление личных данных доступно только владельцу Org.
        </section>
      )}

      {dialogOpen && (
        <ErasePersonDialog
          orgId={orgId}
          entityId={entityId}
          canonicalName={entity.canonicalName}
          onClose={() => setDialogOpen(false)}
          onSuccess={() => {
            // Заметка: backend может отдать alreadyErased — toast уже показан.
            setDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Двухстадийный диалог подтверждения ─────────────────────────────────

type Stage = 'confirm-name' | 'confirm-reason';

function ErasePersonDialog({
  orgId,
  entityId,
  canonicalName,
  onClose,
  onSuccess,
}: {
  orgId: string;
  entityId: string;
  canonicalName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('confirm-name');
  const [typedName, setTypedName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const nameMatches = typedName.trim() === canonicalName.trim();
  const reasonValid = reason.trim().length >= 3 && reason.length <= 2000;

  const handleErase = async () => {
    if (!reasonValid) return;
    setSubmitting(true);
    try {
      const report = await personsApi.eraseData(
        orgId,
        entityId,
        reason.trim(),
      );
      showEraseToast(report);
      onSuccess();
      router.push('/persons');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить данные');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent>
        {stage === 'confirm-name' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-danger">
                Удаление необратимо
              </DialogTitle>
              <DialogDescription>
                Будут стёрты RawEvent-источники с упоминанием персоны,
                обезличена сама сущность, заархивированы блоки без других
                evidence, удалены связи между сущностями. Восстановление
                невозможно.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <Label htmlFor="confirm-name-input">
                Введите ФИО персоны для подтверждения
              </Label>
              <Input
                id="confirm-name-input"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={canonicalName}
                autoFocus
              />
              <p className="text-xs text-fg-tertiary">
                Должно точно совпасть с «{canonicalName}».
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button
                onClick={() => setStage('confirm-reason')}
                disabled={!nameMatches}
              >
                Далее
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-danger">Причина удаления</DialogTitle>
              <DialogDescription>
                Поле обязательно для compliance. Будет записано в AuditLog
                вместе с user_id, инициировавшим удаление.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <Label htmlFor="erase-reason">Причина (3..2000 символов)</Label>
              <Textarea
                id="erase-reason"
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Запрос субъекта персональных данных по 152-ФЗ от 2026-05-10. Тикет CRM #123."
                autoFocus
              />
              <p className="text-xs text-fg-tertiary">
                Минимум 3 символа. {reason.length} / 2000.
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStage('confirm-name')}
                disabled={submitting}
              >
                Назад
              </Button>
              <Button
                onClick={() => void handleErase()}
                disabled={!reasonValid || submitting}
                className="bg-danger text-danger-fg hover:bg-danger/90"
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                    Удаляем…
                  </>
                ) : (
                  'Удалить навсегда'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function showEraseToast(report: EraseReportApi): void {
  if (report.alreadyErased) {
    toast('Эта персона уже была обезличена ранее.');
    return;
  }
  toast.success(`Удалено: ${report.erasedRawEvents} RawEvent, ${report.deletedEvidences} evidence, ${report.archivedBlocks} ${pluralizeBlocks(report.archivedBlocks)} в архив.`);
}

function pluralizeBlocks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'блок';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'блока';
  return 'блоков';
}

// ─── SBA α-8 wave 3 — Appointments timeline ─────────────────────────────

/**
 * Минимальная вкладка «Назначения» — список Appointment'ов для Person,
 * привязанного к Entity{type=person} через `Person.entityId`. На бэке
 * резолв идёт автоматически (если связи нет — возвращается пустой список).
 *
 * Полноценный UI для Appointment'ов (создание, редактирование, фильтры
 * по статусу) — в SBA α-8 wave 4 (role-map UI).
 */
function AppointmentsTimelineSection({
  orgId,
  entityId,
}: {
  orgId: string;
  entityId: string;
}) {
  const [items, setItems] = useState<AppointmentTimelineItemApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await appointmentsApi.entityTimeline(orgId, entityId);
        if (!cancelled) setItems(res.items);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof ApiError ? e.message : 'Не удалось загрузить назначения',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [orgId, entityId]);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mb-3 text-base font-medium">Назначения</h2>
      {loading && (
        <p className="text-sm text-fg-tertiary">Загрузка истории назначений…</p>
      )}
      {!loading && error && (
        <p className="text-sm text-danger">{error}</p>
      )}
      {!loading && !error && items !== null && items.length === 0 && (
        <p className="text-sm text-fg-tertiary">
          У этого сотрудника пока нет назначений. Создайте их через раздел
          «Должности» или /api/v1/appointments.
        </p>
      )}
      {!loading && !error && items !== null && items.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {items.map((a) => (
            <li key={a.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-medium">
                  {a.roleName ?? '(должность удалена)'}
                </div>
                <span className="text-xs text-fg-tertiary">
                  {renderStatus(a.status)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-fg-tertiary">
                {a.departmentName
                  ? `Отдел: ${a.departmentName}`
                  : 'Отдел: —'}{' '}
                · Ставка: {a.loadPercent}%
              </p>
              <p className="mt-0.5 text-xs text-fg-secondary">
                {formatPeriod(a.validFrom, a.validTo)}
                {a.durationDays !== null && (
                  <> · {a.durationDays} {pluralizeDays(a.durationDays)}</>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function renderStatus(s: AppointmentTimelineItemApi['status']): string {
  if (s === 'active') return 'действующее';
  if (s === 'acting') return 'и.о.';
  return 'архив';
}

function formatPeriod(validFrom: string, validTo: string | null): string {
  const from = new Date(validFrom).toLocaleDateString('ru-RU');
  const to = validTo ? new Date(validTo).toLocaleDateString('ru-RU') : 'сейчас';
  return `${from} — ${to}`;
}

function pluralizeDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

// ─── SBA β-8.2 — Обещания человека ──────────────────────────────────────

const COMMITMENT_ADMIN_ROLES: ReadonlySet<NonNullable<CurrentOrgRole>> = new Set([
  'owner',
  'admin',
  'coo',
]);

function canSeePersonCommitments(
  role: CurrentOrgRole,
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  if (!role) return false;
  return COMMITMENT_ADMIN_ROLES.has(role);
}

/**
 * Вкладка «Обещания» — исходящие (что человек обещал) и входящие
 * (что обещали ему). Доступна только админ-ролям (owner/admin/coo/
 * super_admin). Сам сотрудник видит свои обещания в `/me/promises`.
 *
 * Запрос идёт по `entityId` — на бэке `personal-relations/commitments`
 * сам резолвит `Person.id` через `Person.entityId`. Если Person не
 * привязан к Entity — отдаётся пустой результат, тогда секция показывает
 * empty state.
 */
function PersonCommitmentsSection({ entityId }: { entityId: string }) {
  const [outgoing, setOutgoing] = useState<CommitmentApi[] | null>(null);
  const [incoming, setIncoming] = useState<CommitmentApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await commitmentsApi.listForEntity(entityId);
        if (!cancelled) {
          setOutgoing(res.outgoing);
          setIncoming(res.incoming);
        }
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && e.code === 'forbidden') {
            // Тихо скрываем секцию — у роли нет прав на чтение обещаний.
            setOutgoing([]);
            setIncoming([]);
          } else {
            setError(
              e instanceof ApiError ? e.message : 'Не удалось загрузить обещания',
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  if (loading) {
    return (
      <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="mb-3 text-base font-medium">Обещания</h2>
        <p className="text-sm text-fg-tertiary">Загрузка обещаний…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="mb-3 text-base font-medium">Обещания</h2>
        <p className="text-sm text-danger">{error}</p>
      </section>
    );
  }

  const hasAny = (outgoing?.length ?? 0) + (incoming?.length ?? 0) > 0;

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mb-3 text-base font-medium">Обещания</h2>
      {!hasAny && (
        <p className="text-sm text-fg-tertiary">
          У человека нет открытых или закрытых обещаний в графе знаний. Они
          появляются автоматически из встреч и чек-инов.
        </p>
      )}
      {(outgoing?.length ?? 0) > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-medium text-fg-secondary">
            Что обещал ({outgoing!.length})
          </h3>
          <CommitmentsList items={outgoing!} showRecipient />
        </div>
      )}
      {(incoming?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-fg-secondary">
            Что обещали ему ({incoming!.length})
          </h3>
          <CommitmentsList items={incoming!} showAuthor />
        </div>
      )}
    </section>
  );
}

function CommitmentsList({
  items,
  showRecipient = false,
  showAuthor = false,
}: {
  items: CommitmentApi[];
  showRecipient?: boolean;
  showAuthor?: boolean;
}) {
  return (
    <ul className="divide-y divide-border-subtle">
      {items.map((c) => (
        <li key={c.id} className="py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-fg-primary">{c.text}</p>
            <span className="shrink-0 text-xs text-fg-tertiary">
              {renderCommitmentStatus(c.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-fg-tertiary">
            {c.dueDate ? (
              <>Срок: {new Date(c.dueDate).toLocaleDateString('ru-RU')}</>
            ) : (
              <>Срок не указан</>
            )}
            {showRecipient && c.recipientPersonName && (
              <> · Кому: {c.recipientPersonName}</>
            )}
            {showAuthor && c.authorPersonName && (
              <> · От: {c.authorPersonName}</>
            )}
            {c.escalatedAt && <> · эскалировано</>}
            {!c.escalatedAt && c.askedAt && <> · уточнение отправлено</>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function renderCommitmentStatus(status: CommitmentStatusApi | null): string {
  if (status === 'open') return 'открыто';
  if (status === 'asked') return 'ждём ответа';
  if (status === 'fulfilled') return 'выполнено';
  if (status === 'missed') return 'не выполнено';
  if (status === 'cancelled') return 'отменено';
  if (status === 'superseded') return 'заменено';
  return '—';
}
