'use client';

import { useCallback, useEffect, useState } from 'react';

import { projectsApi, type ProjectEmailInboxApi } from '@/api/tracker/projects.api';
import { useAuth } from '@/contexts/auth-context';
import { PROJECT_MEMBER_ROLE_LABELS } from '@/domain/tracker';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useProjectMembers } from '@/hooks/tracker/useProject';
import { AssigneeAvatar } from '@/ui/tracker';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';

export function ProjectSettingsClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { project, isLoading } = useProjectBySlug(currentOrgId, slug);
  const { members } = useProjectMembers(currentOrgId, project?.id);

  if (isLoading) {
    return (
      <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
    );
  }

  if (!project) {
    return <div className="text-sm text-fg-tertiary">Проект не найден.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-primary">Основное</h2>
        <dl className="grid grid-cols-1 gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm md:grid-cols-2">
          <Field label="Название" value={project.name} />
          <Field label="Slug" value={project.slug} />
          <Field label="Идентификатор" value={project.identifier} />
          <Field label="Таймзона" value={project.timezone} />
          <Field
            label="Циклы"
            value={project.cycleViewEnabled ? 'Вкл' : 'Выкл'}
          />
          <Field
            label="Входящие"
            value={project.intakeViewEnabled ? 'Вкл' : 'Выкл'}
          />
        </dl>
      </section>

      {currentOrgId && project?.id ? (
        <EmailInboxSection orgId={currentOrgId} projectId={project.id} />
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-primary">
          Участники · {members.length}
        </h2>
        {members.length === 0 ? (
          <div className="text-sm text-fg-tertiary">Участников нет.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
              >
                <AssigneeAvatar userId={m.userId} size={28} />
                <span className="flex-1 truncate font-mono text-xs text-fg-secondary">
                  {m.userId}
                </span>
                <span className="text-xs text-fg-tertiary">
                  {PROJECT_MEMBER_ROLE_LABELS[m.role as 5 | 15 | 20] ?? m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-fg-tertiary">
          Добавление/удаление участников появится в Sprint 3.
        </p>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wider text-fg-tertiary">
        {label}
      </dt>
      <dd className="text-sm text-fg-primary">{value}</dd>
    </div>
  );
}

/**
 * Tracker Phase 4 (Email-to-task, T5) — секция управления email-inbox проекта.
 *
 * - Toggle вкл./выкл. (POST enable / POST disable).
 * - Показ полного адреса + кнопка «Скопировать».
 * - «Сгенерировать новый адрес» (с подтверждением — старый сразу перестанет работать).
 * - Лог последних 20 inbound писем (status badge + время + subject + ссылка на Issue).
 */
function EmailInboxSection({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const [data, setData] = useState<ProjectEmailInboxApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'enable' | 'disable' | 'regen' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await projectsApi.getEmailInbox(orgId, projectId);
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить настройки email-inbox');
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleEnable = async () => {
    setBusy('enable');
    setError(null);
    try {
      const fresh = await projectsApi.enableEmailInbox(orgId, projectId);
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось включить email-inbox');
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async () => {
    setBusy('disable');
    setError(null);
    try {
      const fresh = await projectsApi.disableEmailInbox(orgId, projectId);
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выключить email-inbox');
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerate = async () => {
    const ok = await ask({
      title: 'Сгенерировать новый адрес?',
      description: 'Старый адрес сразу перестанет работать — письма на него будут отскакивать.',
      confirmLabel: 'Сгенерировать',
      destructive: true,
    });
    if (!ok) return;
    setBusy('regen');
    setError(null);
    try {
      const fresh = await projectsApi.regenerateEmailInboxAlias(orgId, projectId);
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сгенерировать новый адрес');
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!data?.fullAddress) return;
    try {
      await navigator.clipboard.writeText(data.fullAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Игнорируем — пользователь скопирует вручную.
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-fg-primary">Email-to-task</h2>
      <p className="text-xs text-fg-tertiary">
        Письма на адрес проекта автоматически создают задачи. Вложения сохраняются.
      </p>

      <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-4">
        {loading ? (
          <div className="h-12 animate-pulse rounded-md bg-bg-subtle" />
        ) : !data ? (
          <div className="text-sm text-fg-tertiary">Нет данных.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] uppercase tracking-wider text-fg-tertiary">
                Статус
              </span>
              {data.enabled ? (
                <span className="rounded-full bg-chip-success-bg px-2 py-0.5 text-xs font-medium text-chip-success-fg">
                  Включён
                </span>
              ) : (
                <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-xs text-fg-tertiary">
                  Выключен
                </span>
              )}
              <div className="ml-auto flex gap-2">
                {data.enabled ? (
                  <button
                    type="button"
                    onClick={handleDisable}
                    disabled={busy !== null}
                    className="rounded-md border border-border-subtle px-3 py-1 text-xs hover:bg-bg-subtle disabled:opacity-50"
                  >
                    Выключить
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleEnable}
                    disabled={busy !== null}
                    className="rounded-md bg-accent px-3 py-1 text-xs text-accent-fg hover:opacity-90 disabled:opacity-50"
                  >
                    Включить
                  </button>
                )}
              </div>
            </div>

            {data.fullAddress ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-fg-tertiary">
                  Адрес проекта
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 truncate rounded bg-bg-subtle px-2 py-1.5 font-mono text-xs text-fg-primary">
                    {data.fullAddress}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="rounded-md border border-border-subtle px-3 py-1 text-xs hover:bg-bg-subtle"
                  >
                    {copied ? 'Скопировано' : 'Скопировать'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={busy !== null}
                    className="rounded-md border border-border-subtle px-3 py-1 text-xs hover:bg-bg-subtle disabled:opacity-50"
                  >
                    Сгенерировать новый
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-fg-tertiary">
                Адрес ещё не выдан. Нажмите «Включить» — мы создадим уникальный
                адрес для приёма писем.
              </p>
            )}

            {error ? (
              <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg px-3 py-2 text-xs text-chip-danger-fg">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-wider text-fg-tertiary">
                Последние входящие письма
              </span>
              {data.recentLogs.length === 0 ? (
                <span className="text-xs text-fg-tertiary">
                  Пока ничего не пришло.
                </span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {data.recentLogs.map((log) => (
                    <li
                      key={log.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-bg-subtle px-2 py-1.5 text-xs"
                    >
                      <MailStatusBadge status={log.status} />
                      <span className="text-fg-tertiary">
                        {formatDateTime(log.createdAt)}
                      </span>
                      <span className="truncate text-fg-primary">
                        {log.subject || '(без темы)'}
                      </span>
                      <span className="ml-auto text-fg-tertiary">{log.fromEmail}</span>
                      {log.issueId ? (
                        <a
                          className="text-accent hover:underline"
                          href={`/issues/${log.issueId}`}
                        >
                          Задача
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
      {confirmDialog}
    </section>
  );
}

function MailStatusBadge({
  status,
}: {
  status: 'received' | 'bounced' | 'failed' | 'created';
}) {
  const labels: Record<typeof status, string> = {
    received: 'Получено',
    bounced: 'Отскок',
    failed: 'Ошибка',
    created: 'Задача создана',
  };
  const colors: Record<typeof status, string> = {
    received: 'bg-bg-subtle text-fg-secondary',
    bounced: 'bg-chip-warning-bg text-chip-warning-fg',
    failed: 'bg-chip-danger-bg text-chip-danger-fg',
    created: 'bg-chip-success-bg text-chip-success-fg',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${colors[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
