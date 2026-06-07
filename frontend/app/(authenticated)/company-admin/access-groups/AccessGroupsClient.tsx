'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronDown, Loader2, ShieldCheck, UserPlus, X } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { knowledgeAccessApi } from '@/api/knowledge-access.api';
import { personsDomainApi, type PersonDomainApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import {
  buildVisibilityMatrix,
  toGroupMember,
  toKnowledgeGroup,
  type KnowledgeGroupDomain,
} from '@/domain/knowledge-access';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { toast } from '@/ui/shadcn/toast';
import { cn } from '@/ui/shadcn/lib/utils';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * `/company-admin/access-groups` (ТЗ 2026-06-06 knowledge-access-groups, Ф7b).
 *
 * Две секции:
 *   1. Матрица видимости отделов — направленная, несимметричная: «какие отделы
 *      видит выбранный отдел». Для каждого отдела — мультиселект видимых отделов;
 *      сохранение через PUT /matrix/:subjectGroupId.
 *   2. Членство в группах — для закрытых групп «Руководство» / «Совет» (и отделов):
 *      список членов + добавить человека (clearance-override) + убрать.
 *
 * Все тексты — на русском (memory `feedback_admin_ui_russian_only`),
 * цвета — через парные токены.
 */
export function AccessGroupsClient() {
  const { currentOrgRole, isLoading: authLoading } = useAuth();
  const canEdit = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const groupsSwr = useSWR(
    canEdit ? ['knowledge-access-groups'] : null,
    async () => {
      const dto = await knowledgeAccessApi.listGroups();
      return dto.items.map(toKnowledgeGroup);
    },
    { revalidateOnFocus: false },
  );

  if (authLoading) return <AdminLoading rows={4} />;
  if (!canEdit) {
    return (
      <AdminForbidden
        title="Раздел доступен только администраторам"
        description="Доступом к знаниям может управлять только владелец или администратор компании."
      />
    );
  }
  if (groupsSwr.isLoading && !groupsSwr.data) return <AdminLoading rows={6} />;
  if (groupsSwr.error) {
    return (
      <AdminError
        message={
          groupsSwr.error instanceof ApiError
            ? groupsSwr.error.message
            : 'Не удалось загрузить группы доступа'
        }
        onRetry={() => void groupsSwr.mutate()}
      />
    );
  }

  const groups = groupsSwr.data ?? [];

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-fg-primary">
          <ShieldCheck className="h-6 w-6 text-accent" />
          Группы доступа к знаниям
        </h1>
        <p className="text-sm text-fg-secondary">
          Здесь вы решаете, кто внутри компании видит какие знания. По умолчанию
          знание видно всей компании — это и есть ценность памяти. Закрытые группы
          и матрица отделов лишь сужают доступ там, где это действительно нужно.
        </p>
      </header>

      <MatrixSection groups={groups} />
      <MembershipSection groups={groups} onChanged={() => void groupsSwr.mutate()} />
    </section>
  );
}

// ─────────────────────────── Матрица видимости отделов ───────────────────────

function MatrixSection({ groups }: { groups: KnowledgeGroupDomain[] }) {
  const departments = useMemo(
    () => groups.filter((g) => g.kind === 'department'),
    [groups],
  );

  const matrixSwr = useSWR(
    ['knowledge-access-matrix'],
    async () => {
      const dto = await knowledgeAccessApi.getMatrix();
      return buildVisibilityMatrix(dto.items);
    },
    { revalidateOnFocus: false },
  );

  if (departments.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="font-medium text-fg-primary">Матрица видимости отделов</h2>
        <p className="mt-1 text-sm text-fg-tertiary">
          В компании пока нет отделов. Создайте отделы в разделе «Структура» —
          после этого можно будет настроить, какие отделы видят знания друг друга.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-fg-primary">
          Матрица видимости отделов
        </h2>
        <p className="text-sm text-fg-secondary">
          Для каждого отдела отметьте, знания каких <em>других</em> отделов он
          может видеть. Связь направленная: если отдел продаж видит логистику —
          это не значит, что логистика видит продажи. Свой отдел доступен всегда.
        </p>
      </div>

      {matrixSwr.isLoading && !matrixSwr.data ? (
        <AdminLoading rows={departments.length} />
      ) : matrixSwr.error ? (
        <AdminError
          message={
            matrixSwr.error instanceof ApiError
              ? matrixSwr.error.message
              : 'Не удалось загрузить матрицу'
          }
          onRetry={() => void matrixSwr.mutate()}
        />
      ) : (
        <div className="space-y-3">
          {departments.map((subject) => (
            <DepartmentVisibilityRow
              key={subject.id}
              subject={subject}
              departments={departments}
              visible={matrixSwr.data?.get(subject.id) ?? new Set<string>()}
              onSaved={() => void matrixSwr.mutate()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DepartmentVisibilityRow({
  subject,
  departments,
  visible,
  onSaved,
}: {
  subject: KnowledgeGroupDomain;
  departments: KnowledgeGroupDomain[];
  visible: Set<string>;
  onSaved: () => void;
}) {
  const others = useMemo(
    () => departments.filter((d) => d.id !== subject.id),
    [departments, subject.id],
  );

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(visible));
  const [saving, setSaving] = useState(false);

  // Синхронизируем черновик с сервером при сворачивании/первом раскрытии.
  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) setDraft(new Set(visible));
      return next;
    });
  }, [visible]);

  const dirty = useMemo(() => {
    if (draft.size !== visible.size) return true;
    for (const id of draft) if (!visible.has(id)) return true;
    return false;
  }, [draft, visible]);

  const toggle = useCallback((id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await knowledgeAccessApi.setMatrix(subject.id, {
        visibleGroupIds: [...draft],
      });
      toast.success(`Сохранено: «${subject.name}» видит ${draft.size} отделов`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }, [subject.id, subject.name, draft, onSaved]);

  const visibleNames = useMemo(
    () =>
      others
        .filter((d) => visible.has(d.id))
        .map((d) => d.name),
    [others, visible],
  );

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={toggleOpen}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="font-medium text-fg-primary">{subject.name}</div>
          <div className="mt-0.5 text-xs text-fg-tertiary">
            Видит:{' '}
            <span className="text-fg-secondary">
              {visibleNames.length > 0
                ? `свой отдел и ${visibleNames.join(', ')}`
                : 'только свой отдел'}
            </span>
          </div>
        </div>
        <ChevronDown
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 text-fg-tertiary transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border-subtle p-4">
          {others.length === 0 ? (
            <p className="text-sm text-fg-tertiary">
              Других отделов пока нет.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {others.map((d) => {
                  const checked = draft.has(d.id);
                  return (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(d.id)}
                      />
                      <span className="text-sm text-fg-primary">{d.name}</span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                {dirty && (
                  <span className="text-xs text-fg-tertiary">
                    Есть несохранённые изменения
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || !dirty}
                  onClick={() => void save()}
                >
                  {saving && <Loader2 className="animate-spin" size={14} />}
                  Сохранить
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────── Членство в группах ─────────────────────────────

function MembershipSection({
  groups,
  onChanged,
}: {
  groups: KnowledgeGroupDomain[];
  onChanged: () => void;
}) {
  // Закрытые группы (Руководство/Совет) — первыми; затем отделы.
  const closed = useMemo(() => groups.filter((g) => g.isClosed), [groups]);
  const departments = useMemo(
    () => groups.filter((g) => g.kind === 'department'),
    [groups],
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-fg-primary">
          Участники групп
        </h2>
        <p className="text-sm text-fg-secondary">
          Кто входит в каждую группу. Обычно состав берётся из должностей
          автоматически. Здесь можно добавить человека вручную — например,
          поднять сотрудника в «Руководство» без смены должности, или убрать
          лишнего.
        </p>
      </div>

      <div className="space-y-3">
        {closed.map((g) => (
          <GroupMembers key={g.id} group={g} onChanged={onChanged} />
        ))}
        {departments.map((g) => (
          <GroupMembers key={g.id} group={g} onChanged={onChanged} />
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-fg-tertiary">Групп пока нет.</p>
        )}
      </div>
    </div>
  );
}

function GroupMembers({
  group,
  onChanged,
}: {
  group: KnowledgeGroupDomain;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  const membersSwr = useSWR(
    open ? ['knowledge-access-members', group.id] : null,
    async () => {
      const dto = await knowledgeAccessApi.listMembers(group.id);
      return dto.items.map(toGroupMember);
    },
    { revalidateOnFocus: false },
  );

  const [busyPersonId, setBusyPersonId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void membersSwr.mutate();
    onChanged();
  }, [membersSwr, onChanged]);

  const handleAdd = useCallback(
    async (personId: string) => {
      setBusyPersonId(personId);
      try {
        const res = await knowledgeAccessApi.addMember(group.id, { personId });
        toast.success(res.added ? 'Человек добавлен' : 'Уже в группе');
        refresh();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Не удалось добавить');
      } finally {
        setBusyPersonId(null);
      }
    },
    [group.id, refresh],
  );

  const handleRemove = useCallback(
    async (personId: string) => {
      setBusyPersonId(personId);
      try {
        await knowledgeAccessApi.removeMember(group.id, personId);
        toast.success('Человек убран из группы');
        refresh();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Не удалось убрать');
      } finally {
        setBusyPersonId(null);
      }
    },
    [group.id, refresh],
  );

  const members = useMemo(() => membersSwr.data ?? [], [membersSwr.data]);
  const memberIds = useMemo(
    () => new Set(members.map((m) => m.personId)),
    [members],
  );

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg-primary">{group.name}</span>
          <span className="rounded-sm bg-bg-overlay px-2 py-0.5 text-[11px] text-fg-tertiary">
            {group.kindLabel}
            {group.isClosed ? ' · закрытая' : ''}
          </span>
          <span className="text-xs text-fg-tertiary">
            {group.memberCount} участн.
          </span>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-fg-tertiary transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border-subtle p-4">
          {membersSwr.isLoading && !membersSwr.data ? (
            <AdminLoading rows={2} />
          ) : membersSwr.error ? (
            <AdminError
              message={
                membersSwr.error instanceof ApiError
                  ? membersSwr.error.message
                  : 'Не удалось загрузить участников'
              }
              onRetry={() => void membersSwr.mutate()}
            />
          ) : (
            <>
              {members.length === 0 ? (
                <p className="text-sm text-fg-tertiary">
                  В группе пока никого нет.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {members.map((m) => (
                    <li
                      key={m.personId}
                      className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm text-fg-primary">
                          {m.personName}
                        </span>
                        <span className="shrink-0 rounded-sm bg-bg-card px-1.5 py-0.5 text-[10px] text-fg-tertiary">
                          {m.isManual ? 'добавлен вручную' : 'из должности'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRemove(m.personId)}
                        disabled={busyPersonId === m.personId}
                        aria-label={`Убрать ${m.personName}`}
                        className="shrink-0 rounded p-1 text-fg-tertiary hover:bg-bg-card hover:text-danger disabled:opacity-50"
                      >
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <AddMemberPicker
                excludeIds={memberIds}
                busyPersonId={busyPersonId}
                onPick={(personId) => void handleAdd(personId)}
              />
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Поиск сотрудника компании для добавления в группу. Берём людей через
 * `personsDomainApi.list` (у них гарантированно есть `personId`) и фильтруем
 * по введённому имени. Уже состоящих в группе не показываем.
 */
function AddMemberPicker({
  excludeIds,
  busyPersonId,
  onPick,
}: {
  excludeIds: Set<string>;
  busyPersonId: string | null;
  onPick: (personId: string) => void;
}) {
  const { currentOrgId } = useAuth();
  const [query, setQuery] = useState('');

  const personsSwr = useSWR(
    currentOrgId ? ['org-persons-for-membership', currentOrgId] : null,
    async () => {
      const dto = await personsDomainApi.list(currentOrgId as string);
      return dto.items;
    },
    { revalidateOnFocus: false },
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = personsSwr.data ?? [];
    return all
      .filter((p: PersonDomainApi) => !excludeIds.has(p.id))
      .filter((p: PersonDomainApi) =>
        q.length === 0 ? false : p.fullName.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [personsSwr.data, excludeIds, query]);

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border-subtle p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-fg-secondary">
        <UserPlus size={14} className="text-accent" />
        Добавить человека
      </div>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Начните вводить имя сотрудника"
        maxLength={120}
      />
      {query.trim().length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {personsSwr.isLoading ? (
            <p className="px-1 py-1 text-xs text-fg-tertiary">Загрузка…</p>
          ) : matches.length === 0 ? (
            <p className="px-1 py-1 text-xs text-fg-tertiary">
              Никого не найдено. Сотрудники создаются в разделе «Команда».
            </p>
          ) : (
            matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                disabled={busyPersonId === p.id}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-bg-overlay disabled:opacity-50"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-fg-primary">{p.fullName}</span>
                  {(p.departmentName || p.roleName) && (
                    <span className="truncate text-xs text-fg-tertiary">
                      {[p.roleName, p.departmentName]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </span>
                {busyPersonId === p.id ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <UserPlus size={14} className="text-fg-tertiary" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
