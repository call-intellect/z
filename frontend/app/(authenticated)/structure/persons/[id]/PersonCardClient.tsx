'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  departmentsApi,
  rolesDomainApi,
  teamRosterApi,
  type RoleDomainApi,
  type TeamRosterItemApi,
} from '@/api/structure.api';
import { orgsApi } from '@/api/orgs.api';
import { adminClonesApi } from '@/api/admin-clones.api';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { PersonEditDialog } from '@/ui/components/team/PersonDialogs';
import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

const SYSTEM_ROLE_LABELS: Record<
  NonNullable<TeamRosterItemApi['systemRole']>,
  string
> = {
  owner: 'Владелец',
  admin: 'Администратор',
  manager: 'Менеджер',
  coo: 'Операционный директор',
  hr_partner: 'HR-партнёр',
  demo_observer: 'Наблюдатель',
};

const CAPABILITY_LABELS: Record<string, string> = {
  'memory:regulations': 'Память: Правила и стандарты',
  'memory:entities': 'Память: Сущности',
  'feature:graph': 'Граф знаний',
  'panel:operations': 'Панель операций',
};

const INVITATION_LABELS: Record<TeamRosterItemApi['invitationStatus'], string> = {
  none: 'не приглашён',
  pending: 'приглашение отправлено',
  accepted: 'активен',
  revoked: 'приглашение отозвано',
  expired: 'приглашение истекло',
};

export function PersonCardClient({ personId }: { personId: string }) {
  const { currentOrgId, currentOrgRole, user } = useAuth();
  const canEdit = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const [editOpen, setEditOpen] = useState(false);

  const rosterSwr = useSWR(
    currentOrgId ? ['team-roster', currentOrgId] : null,
    () => teamRosterApi.list(currentOrgId as string),
    { revalidateOnFocus: false },
  );
  const deptsSwr = useSWR(
    currentOrgId ? ['persons-departments', currentOrgId] : null,
    () => departmentsApi.list(currentOrgId as string),
  );
  const rolesSwr = useSWR(
    currentOrgId ? ['persons-roles', currentOrgId] : null,
    () => rolesDomainApi.list(currentOrgId as string),
  );

  const row = useMemo(
    () =>
      (rosterSwr.data?.roster ?? []).find((r) => r.personId === personId) ??
      null,
    [rosterSwr.data, personId],
  );

  const currentUserIsOwner = (rosterSwr.data?.roster ?? []).some(
    (r) => r.userId === user?.id && r.systemRole === 'owner',
  );

  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только в рамках компании."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <Link
        href="/structure"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft size={14} /> Команда
      </Link>

      {rosterSwr.error ? (
        <AdminError
          message="Не удалось загрузить карточку"
          onRetry={() => void rosterSwr.mutate()}
        />
      ) : rosterSwr.isLoading ? (
        <AdminLoading rows={5} />
      ) : !row ? (
        <AdminEmpty
          title="Сотрудник не найден"
          description="Карточка не найдена в этой компании."
        />
      ) : (
        <>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              {row.fullName}
            </h1>
            <p className="mt-1 text-sm text-fg-secondary">
              {row.roleName ?? 'Должность не задана'}
              {row.departmentName ? ` · ${row.departmentName}` : ''}
            </p>
          </header>

          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile">Профиль</TabsTrigger>
              <TabsTrigger value="access">Доступы</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
                <dl className="grid grid-cols-[180px_1fr] gap-y-3 text-sm">
                  <dt className="text-fg-tertiary">Имя</dt>
                  <dd className="text-fg-primary">{row.fullName}</dd>
                  <dt className="text-fg-tertiary">Эл. почта</dt>
                  <dd className="text-fg-secondary">{row.email ?? '—'}</dd>
                  <dt className="text-fg-tertiary">Должность</dt>
                  <dd className="text-fg-secondary">{row.roleName ?? '—'}</dd>
                  <dt className="text-fg-tertiary">Отдел</dt>
                  <dd className="text-fg-secondary">{row.departmentName ?? '—'}</dd>
                  <dt className="text-fg-tertiary">Статус приглашения</dt>
                  <dd>
                    <Badge
                      variant={
                        row.invitationStatus === 'accepted'
                          ? 'default'
                          : 'secondary'
                      }
                      className="text-[10px]"
                    >
                      {INVITATION_LABELS[row.invitationStatus]}
                    </Badge>
                  </dd>
                  <dt className="text-fg-tertiary">Системная роль</dt>
                  <dd className="text-fg-secondary">
                    {row.systemRole ? SYSTEM_ROLE_LABELS[row.systemRole] : '—'}
                  </dd>
                  <dt className="text-fg-tertiary">Telegram</dt>
                  <dd className="text-fg-secondary">
                    {row.telegramLinked ? 'привязан' : 'не привязан'}
                  </dd>
                </dl>
                {canEdit && (
                  <div className="mt-5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditOpen(true)}
                    >
                      Редактировать профиль
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="access">
              <AccessTab
                row={row}
                orgId={currentOrgId}
                canEdit={canEdit}
                isSelf={row.userId != null && row.userId === user?.id}
                currentUserIsOwner={currentUserIsOwner}
                roles={rolesSwr.data?.items ?? []}
                onChanged={() => void rosterSwr.mutate()}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {editOpen && row && (
        <PersonEditDialog
          orgId={currentOrgId}
          person={{
            id: row.personId ?? '',
            orgId: currentOrgId,
            fullName: row.fullName,
            email: row.email,
            roleId: row.roleId,
            roleName: row.roleName,
            departmentId: row.departmentId,
            departmentName: row.departmentName,
            userId: row.userId,
            invitationStatus: row.invitationStatus,
            createdAt: '',
          }}
          departments={deptsSwr.data?.items ?? []}
          roles={rolesSwr.data?.items ?? []}
          onClose={() => setEditOpen(false)}
          onDone={() => {
            setEditOpen(false);
            void rosterSwr.mutate();
            toast.success('Сохранено.');
          }}
        />
      )}
    </div>
  );
}

function AccessTab({
  row,
  orgId,
  canEdit,
  isSelf,
  currentUserIsOwner,
  roles,
  onChanged,
}: {
  row: TeamRosterItemApi;
  orgId: string;
  canEdit: boolean;
  isSelf: boolean;
  currentUserIsOwner: boolean;
  roles: RoleDomainApi[];
  onChanged: () => void;
}) {
  if (!row.userId) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-card p-5 text-sm text-fg-secondary">
        Сотрудник ещё не вошёл в систему. Системная роль и доступ к клонам
        появятся после того, как он примет приглашение и создаст аккаунт.
      </div>
    );
  }
  const userId = row.userId;
  const roleIsStandard =
    row.systemRole === 'owner' ||
    row.systemRole === 'admin' ||
    row.systemRole === 'manager';

  const handleRole = async (role: 'owner' | 'admin' | 'manager') => {
    try {
      await orgsApi.updateMember(orgId, userId, { role });
      toast.success('Системная роль обновлена.');
      onChanged();
    } catch (e) {
      toast.error(
        humanizeApiError(e, 'Не удалось изменить роль.'),
      );
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="mb-3 text-base font-medium text-fg-primary">
          Системная роль
        </h2>
        <p className="mb-2 text-sm text-fg-secondary">
          Текущая: {row.systemRole ? SYSTEM_ROLE_LABELS[row.systemRole] : '—'}
        </p>
        {canEdit && !isSelf ? (
          <Select
            value={roleIsStandard ? (row.systemRole as string) : undefined}
            onValueChange={(v) =>
              void handleRole(v as 'owner' | 'admin' | 'manager')
            }
          >
            <SelectTrigger className="h-9 w-60">
              <SelectValue placeholder="Сменить роль" />
            </SelectTrigger>
            <SelectContent>
              {currentUserIsOwner && (
                <SelectItem value="owner">Владелец</SelectItem>
              )}
              <SelectItem value="admin">Администратор</SelectItem>
              <SelectItem value="manager">Менеджер</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-fg-tertiary">
            {isSelf
              ? 'Свою роль изменить нельзя.'
              : 'Недостаточно прав для изменения.'}
          </p>
        )}
      </section>

      <CloneGrants orgId={orgId} userId={userId} canEdit={canEdit} roles={roles} />

      {canEdit && <CapabilityControls orgId={orgId} userId={userId} />}
    </div>
  );
}

function CloneGrants({
  orgId,
  userId,
  canEdit,
  roles,
}: {
  orgId: string;
  userId: string;
  canEdit: boolean;
  roles: RoleDomainApi[];
}) {
  const { ask, dialog } = useConfirmDialog();
  const [grantRoleId, setGrantRoleId] = useState<string>('');
  const grantsSwr = useSWR(['clone-grants', orgId, userId], () =>
    adminClonesApi.listAccessGrants(orgId, { grantedToUserId: userId }),
  );
  const grants = grantsSwr.data?.items ?? [];
  const refresh = () => void grantsSwr.mutate();

  const handleGrant = async () => {
    if (!grantRoleId) return;
    try {
      await adminClonesApi.createAccessGrant(orgId, {
        grantedToUserId: userId,
        cloneType: 'role',
        cloneRefId: grantRoleId,
      });
      toast.success('Доступ к клону выдан.');
      setGrantRoleId('');
      refresh();
    } catch (e) {
      toast.error(
        humanizeApiError(e, 'Не удалось выдать доступ.'),
      );
    }
  };

  const handleRevoke = async (id: string) => {
    const ok = await ask({
      title: 'Отозвать доступ к клону?',
      confirmLabel: 'Отозвать',
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminClonesApi.revokeAccessGrant(orgId, id);
      toast.success('Доступ отозван.');
      refresh();
    } catch (e) {
      toast.error(humanizeApiError(e, 'Не удалось отозвать.'));
    }
  };

  const handleExtend = async (id: string, expiresAt: string | null) => {
    try {
      await adminClonesApi.extendAccessGrant(orgId, id, { expiresAt });
      toast.success('Срок обновлён.');
      refresh();
    } catch (e) {
      toast.error(
        humanizeApiError(e, 'Не удалось обновить срок.'),
      );
    }
  };

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mb-3 text-base font-medium text-fg-primary">
        Доступ к клонам должностей
      </h2>
      {grantsSwr.isLoading ? (
        <p className="text-sm text-fg-secondary">Загрузка…</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-fg-secondary">Доступов к клонам пока нет.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-fg-tertiary">
            <tr>
              <th className="py-2 text-left">Клон</th>
              <th className="py-2 text-left">Статус</th>
              <th className="py-2 text-left">Срок</th>
              {canEdit && <th className="py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {grants.map((g) => (
              <tr key={g.id}>
                <td className="py-2 text-fg-primary">{g.cloneLabel}</td>
                <td className="py-2">
                  {g.isActive ? (
                    <span className="text-success">активен</span>
                  ) : (
                    <span className="text-fg-tertiary">
                      {g.inactiveReason === 'expired' ? 'истёк' : 'отозван'}
                    </span>
                  )}
                </td>
                <td className="py-2 text-fg-secondary">
                  {g.expiresAt
                    ? new Date(g.expiresAt).toLocaleDateString('ru-RU')
                    : 'бессрочно'}
                </td>
                {canEdit && (
                  <td className="py-2 text-right">
                    {g.isActive && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void handleExtend(
                              g.id,
                              new Date(
                                Date.now() + 30 * 86400000,
                              ).toISOString(),
                            )
                          }
                        >
                          +30 дней
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleExtend(g.id, null)}
                        >
                          Бессрочно
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          onClick={() => void handleRevoke(g.id)}
                        >
                          Отозвать
                        </Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="mt-4 flex items-center gap-2">
          <Select value={grantRoleId} onValueChange={setGrantRoleId}>
            <SelectTrigger className="h-9 w-64">
              <SelectValue placeholder="Выбрать клон должности" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!grantRoleId} onClick={() => void handleGrant()}>
            Выдать доступ
          </Button>
        </div>
      )}
      {dialog}
    </section>
  );
}

function CapabilityControls({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  const capsSwr = useSWR(['member-capabilities', orgId, userId], () =>
    orgsApi.listMemberCapabilities(orgId, userId),
  );
  const items = capsSwr.data?.capabilities ?? [];

  const handleSet = async (capability: string, value: string) => {
    try {
      if (value === 'default') {
        await orgsApi.removeMemberCapability(orgId, userId, capability);
      } else {
        await orgsApi.upsertMemberCapability(orgId, userId, capability, {
          effect: value as 'allow' | 'deny',
        });
      }
      toast.success('Доступ обновлён.');
      void capsSwr.mutate();
    } catch (e) {
      toast.error(
        humanizeApiError(e, 'Не удалось обновить доступ.'),
      );
    }
  };

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mb-1 text-base font-medium text-fg-primary">
        Память и панели
      </h2>
      <p className="mb-3 text-xs text-fg-tertiary">
        «По умолчанию» — доступ как у роли и тарифа. «Открыть» / «Закрыть» —
        персональное исключение для этого сотрудника.
      </p>
      {capsSwr.isLoading ? (
        <p className="text-sm text-fg-secondary">Загрузка…</p>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div
              key={c.capability}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm text-fg-secondary">
                {CAPABILITY_LABELS[c.capability] ?? c.capability}
              </span>
              <Select
                value={c.effect ?? 'default'}
                onValueChange={(v) => void handleSet(c.capability, v)}
              >
                <SelectTrigger className="h-8 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">По умолчанию</SelectItem>
                  <SelectItem value="allow">Открыть</SelectItem>
                  <SelectItem value="deny">Закрыть</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
