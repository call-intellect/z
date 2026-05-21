'use client';

import { useMemo, useState } from 'react';
import { Mail, Pencil, Plus, Trash2 } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  departmentsApi,
  personsDomainApi,
  rolesDomainApi,
  type DepartmentApi,
  type PersonDomainApi,
  type RoleDomainApi,
} from '@/api/structure.api';
import { useToast } from '@/contexts/toast-context';
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
  AdminLoading,
} from '../admin/AdminStateViews';

const ALL_VALUE = '__all__';
const NO_VALUE = '__none__';

const INVITATION_LABELS: Record<PersonDomainApi['invitationStatus'], string> = {
  none: 'не приглашён',
  pending: 'приглашение отправлено',
  accepted: 'активен',
  revoked: 'приглашение отозвано',
  expired: 'приглашение истекло',
};

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; person: PersonDomainApi }
  | { kind: 'remove'; person: PersonDomainApi };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PersonsTab({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}) {
  const { addToast } = useToast();
  const [deptFilter, setDeptFilter] = useState<string>(ALL_VALUE);
  const [roleFilter, setRoleFilter] = useState<string>(ALL_VALUE);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const deptsSwr = useSWR(['persons-departments', orgId], () =>
    departmentsApi.list(orgId),
  );
  const rolesSwr = useSWR(['persons-roles', orgId], () =>
    rolesDomainApi.list(orgId),
  );
  const personsSwr = useSWR(
    ['structure-persons', orgId, deptFilter, roleFilter, statusFilter],
    () =>
      personsDomainApi.list(orgId, {
        ...(deptFilter !== ALL_VALUE && deptFilter !== NO_VALUE
          ? { departmentId: deptFilter }
          : {}),
        ...(roleFilter !== ALL_VALUE && roleFilter !== NO_VALUE
          ? { roleId: roleFilter }
          : {}),
        ...(statusFilter !== ALL_VALUE
          ? { invitationStatus: statusFilter as PersonDomainApi['invitationStatus'] }
          : {}),
      }),
    { revalidateOnFocus: false },
  );

  const departments = deptsSwr.data?.items ?? [];
  const roles = rolesSwr.data?.items ?? [];

  const items = useMemo(() => {
    let list = personsSwr.data?.items ?? [];
    if (deptFilter === NO_VALUE) list = list.filter((p) => !p.departmentId);
    if (roleFilter === NO_VALUE) list = list.filter((p) => !p.roleId);
    return list;
  }, [personsSwr.data, deptFilter, roleFilter]);

  const error = personsSwr.error;
  if (error) {
    if (error instanceof ApiError && error.code === 'http_404') {
      return (
        <AdminEmpty
          title="Раздел в разработке"
          description="API сотрудников ещё не подключён к backend."
        />
      );
    }
    if (error instanceof ApiError && error.code === 'forbidden') {
      return (
        <AdminEmpty
          title="Недостаточно прав"
          description="Запрос списка сотрудников отклонён сервером."
        />
      );
    }
    return (
      <AdminError
        message={error instanceof Error ? error.message : 'Ошибка загрузки'}
        onRetry={() => void personsSwr.mutate()}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue placeholder="Все отделы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все отделы</SelectItem>
              <SelectItem value={NO_VALUE}>Без отдела</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 w-48">
              <SelectValue placeholder="Все должности" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Все должности</SelectItem>
              <SelectItem value={NO_VALUE}>Без должности</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-52">
              <SelectValue placeholder="Любой статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Любой статус</SelectItem>
              <SelectItem value="none">Не приглашён</SelectItem>
              <SelectItem value="pending">Приглашение отправлено</SelectItem>
              <SelectItem value="accepted">Активен</SelectItem>
              <SelectItem value="revoked">Отозвано</SelectItem>
              <SelectItem value="expired">Истекло</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setDialog({ kind: 'create' })}>
            <Plus size={14} className="mr-1" /> Добавить сотрудника
          </Button>
        )}
      </div>

      {personsSwr.isLoading ? (
        <AdminLoading rows={6} />
      ) : items.length === 0 ? (
        <AdminEmpty
          title="Сотрудников не найдено"
          description={
            canEdit ? 'Добавьте первого сотрудника кнопкой выше.' : 'Список пуст.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay/40 text-xs uppercase tracking-wider text-fg-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">Имя</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Должность</th>
                <th className="px-4 py-2 text-left">Отдел</th>
                <th className="px-4 py-2 text-left">Статус</th>
                {canEdit && <th className="w-32 px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-bg-overlay/30">
                  <td className="px-4 py-2 font-medium text-fg-primary">
                    {p.fullName}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {p.email ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {p.roleName ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {p.departmentName ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    <InvitationBadge status={p.invitationStatus} />
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {p.invitationStatus !== 'accepted' && p.email && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Пригласить"
                            title="Пригласить"
                            onClick={async () => {
                              try {
                                await personsDomainApi.invite(orgId, p.id);
                                addToast({
                                  type: 'success',
                                  message: 'Приглашение отправлено.',
                                });
                                void personsSwr.mutate();
                              } catch (e) {
                                addToast({
                                  type: 'error',
                                  message:
                                    e instanceof ApiError
                                      ? e.message
                                      : 'Не удалось пригласить.',
                                });
                              }
                            }}
                          >
                            <Mail size={14} />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Изменить"
                          onClick={() =>
                            setDialog({ kind: 'edit', person: p })
                          }
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Удалить"
                          onClick={() =>
                            setDialog({ kind: 'remove', person: p })
                          }
                        >
                          <Trash2 size={14} className="text-danger" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog.kind === 'create' && (
        <PersonEditDialog
          orgId={orgId}
          departments={departments}
          roles={roles}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void personsSwr.mutate();
            addToast({ type: 'success', message: 'Сотрудник добавлен.' });
          }}
        />
      )}
      {dialog.kind === 'edit' && (
        <PersonEditDialog
          orgId={orgId}
          person={dialog.person}
          departments={departments}
          roles={roles}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void personsSwr.mutate();
            addToast({ type: 'success', message: 'Сотрудник обновлён.' });
          }}
        />
      )}
      {dialog.kind === 'remove' && (
        <RemovePersonDialog
          orgId={orgId}
          person={dialog.person}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void personsSwr.mutate();
            addToast({ type: 'success', message: 'Сотрудник удалён.' });
          }}
        />
      )}
    </div>
  );
}

function InvitationBadge({
  status,
}: {
  status: PersonDomainApi['invitationStatus'];
}) {
  const variant: 'default' | 'secondary' | 'outline' =
    status === 'accepted' ? 'default' : 'secondary';
  return (
    <Badge variant={variant} className="text-[10px]">
      {INVITATION_LABELS[status]}
    </Badge>
  );
}

function PersonEditDialog({
  orgId,
  person,
  departments,
  roles,
  onClose,
  onDone,
}: {
  orgId: string;
  person?: PersonDomainApi;
  departments: DepartmentApi[];
  roles: RoleDomainApi[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { addToast } = useToast();
  const [fullName, setFullName] = useState(person?.fullName ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const [roleId, setRoleId] = useState<string | null>(person?.roleId ?? null);
  const [departmentId, setDepartmentId] = useState<string | null>(
    person?.departmentId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(person);

  const emailOk = !email.trim() || EMAIL_RE.test(email.trim());
  const canSubmit = fullName.trim().length > 0 && emailOk && !busy;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Изменить сотрудника' : 'Новый сотрудник'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Имя</Label>
            <Input
              id="p-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-email">Email</Label>
            <Input
              id="p-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!emailOk}
            />
            {!emailOk && (
              <p className="text-xs text-danger">Некорректный email.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Должность</Label>
              <Select
                value={roleId ?? NO_VALUE}
                onValueChange={(v) => setRoleId(v === NO_VALUE ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Не задана" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>Без должности</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Отдел</Label>
              <Select
                value={departmentId ?? NO_VALUE}
                onValueChange={(v) =>
                  setDepartmentId(v === NO_VALUE ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Не задан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>Без отдела</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              setBusy(true);
              try {
                if (person) {
                  await personsDomainApi.update(orgId, person.id, {
                    fullName: fullName.trim(),
                    email: email.trim() || undefined,
                    roleId,
                    departmentId,
                  });
                } else {
                  await personsDomainApi.create(orgId, {
                    fullName: fullName.trim(),
                    email: email.trim() || undefined,
                    roleId,
                    departmentId,
                  });
                }
                onDone();
              } catch (e) {
                addToast({
                  type: 'error',
                  message:
                    e instanceof ApiError ? e.message : 'Не удалось сохранить.',
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemovePersonDialog({
  orgId,
  person,
  onClose,
  onDone,
}: {
  orgId: string;
  person: PersonDomainApi;
  onClose: () => void;
  onDone: () => void;
}) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить сотрудника «{person.fullName}»?</DialogTitle>
          <DialogDescription>
            Связи с упоминаниями в IdeaBlock/Decision сохраняются — имя
            останется видимым с пометкой «удалён».
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await personsDomainApi.remove(orgId, person.id);
                onDone();
              } catch (e) {
                addToast({
                  type: 'error',
                  message:
                    e instanceof ApiError ? e.message : 'Не удалось удалить.',
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
