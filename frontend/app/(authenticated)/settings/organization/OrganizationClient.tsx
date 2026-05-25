'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw, Trash2, UserPlus, X } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  type MembershipApi,
  type OrgApi,
  type OrgInvitationApi,
  orgsApi,
} from '@/api/orgs.api';
import { useAuth } from '@/contexts/auth-context';
import {
  describeInvitationStatus,
  mapOrgInvitationCreateResultDtoToDomain,
  mapOrgInvitationDtoToDomain,
  type OrgInvitationCreateResultDomain,
  type OrgInvitationDomain,
} from '@/domain/org-invitations';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import { InviteCreatedDialog } from './InviteCreatedDialog';
import { InviteEmployeeDialog } from './InviteEmployeeDialog';

/**
 * Страница /settings/organization — управление Org текущего юзера.
 *
 * Состоит из трёх секций:
 *   - Информация об Org: name + visibilityMode (open/strict). Редактирует только owner.
 *   - Участники: таблица email/role/joinedAt + actions (изменить роль / удалить).
 *   - Приглашения: форма создания инвайта + список pending с кнопкой отзыва.
 *
 * Архитектура (frontend-rules):
 *   - Single client-side component (Org-страница чисто-форма, без SSR-нужд).
 *   - Все запросы через единый orgsApi.
 *   - Состояние локально в useState, без Redux/Query.
 */
export function OrganizationClient() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgApi[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<MembershipApi[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitationDomain[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const [editVisibility, setEditVisibility] = useState<'open' | 'strict'>('open');
  const [savingOrg, setSavingOrg] = useState(false);

  // β-9 — состояние новых модалов «Пригласить сотрудника» и «Скопировать ссылку».
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [lastCreatedInvite, setLastCreatedInvite] =
    useState<OrgInvitationCreateResultDomain | null>(null);
  const [createdDialogOpen, setCreatedDialogOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resettingTelegramUserId, setResettingTelegramUserId] = useState<
    string | null
  >(null);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const isOwner = activeOrg && user ? activeOrg.ownerId === user.id : false;
  const myRole: MembershipApi['role'] | null = (() => {
    if (!user) return null;
    return members.find((m) => m.userId === user.id)?.role ?? null;
  })();
  const canManageMembers = isOwner || myRole === 'admin';

  // β-9 — показываем только активные/незавершённые приглашения сверху;
  // accepted и revoked прячем (пользователь уже принял или сам отменил).
  // expired оставляем, чтобы директор мог нажать «Перевыпустить».
  const pendingInvitations = useMemo(
    () => invitations.filter((i) => i.status === 'pending' || i.status === 'expired'),
    [invitations],
  );

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orgsApi.listMine();
      setOrgs(res.orgs);
      if (!activeOrgId && res.orgs.length > 0) {
        setActiveOrgId(res.orgs[0]!.id);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить организации');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  const loadMembersAndInvitations = useCallback(async (orgId: string) => {
    try {
      const [membersRes, invitationsRes] = await Promise.all([
        orgsApi.listMembers(orgId),
        // listInvitations может вернуть 403 если юзер manager — обрабатываем тихо.
        orgsApi
          .listInvitations(orgId)
          .catch((): { invitations: OrgInvitationApi[] } => ({ invitations: [] })),
      ]);
      setMembers(membersRes.members);
      setInvitations(invitationsRes.invitations.map(mapOrgInvitationDtoToDomain));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить участников');
    }
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    if (!activeOrg) return;
    setEditName(activeOrg.name);
    setEditVisibility(activeOrg.visibilityMode);
    void loadMembersAndInvitations(activeOrg.id);
  }, [activeOrg, loadMembersAndInvitations]);

  const handleSaveOrg = async () => {
    if (!activeOrg) return;
    setSavingOrg(true);
    try {
      const res = await orgsApi.update(activeOrg.id, {
        name: editName.trim(),
        visibilityMode: editVisibility,
      });
      setOrgs((prev) => prev.map((o) => (o.id === res.org.id ? res.org : o)));
      toast.success('Настройки организации сохранены');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить');
    } finally {
      setSavingOrg(false);
    }
  };

  // β-9 — callback из InviteEmployeeDialog: добавляем pending в список и
  // открываем модал «Скопировать ссылку» с manualShareUrl + QR + linkCode.
  const handleInviteCreated = (created: OrgInvitationCreateResultDomain) => {
    setInvitations((prev) => [
      // Удаляем возможный дубль (если бэк уже включил его в список) — на случай
      // повторного открытия диалога.
      created,
      ...prev.filter((i) => i.id !== created.id),
    ]);
    setLastCreatedInvite(created);
    setCreatedDialogOpen(true);
  };

  const handleRevoke = async (invitationId: string) => {
    if (!activeOrg) return;
    const ok = await ask({
      title: 'Отозвать приглашение?',
      confirmLabel: 'Отозвать',
      destructive: true,
    });
    if (!ok) return;
    try {
      await orgsApi.revokeInvitation(activeOrg.id, invitationId);
      setInvitations((prev) =>
        prev.map((i) =>
          i.id === invitationId ? { ...i, status: 'revoked' as const } : i,
        ),
      );
      toast.success('Приглашение отозвано');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось отозвать');
    }
  };

  // β-9 — перевыпуск приглашения: новый magic-token + linkCode, открываем
  // тот же модал с новыми ссылками для копирования.
  const handleResend = async (invitationId: string) => {
    if (!activeOrg) return;
    setResendingId(invitationId);
    try {
      const res = await orgsApi.resendInvitation(activeOrg.id, invitationId);
      const created = mapOrgInvitationCreateResultDtoToDomain(res.invitation);
      setInvitations((prev) =>
        prev.map((i) => (i.id === invitationId ? created : i)),
      );
      setLastCreatedInvite(created);
      setCreatedDialogOpen(true);
      toast.success('Приглашение перевыпущено — обновите ссылку у сотрудника');
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось перевыпустить приглашение',
      );
    } finally {
      setResendingId(null);
    }
  };

  // β-9 — сброс привязки Telegram сотрудника (например при смене телефона).
  const handleResetTelegram = async (targetUserId: string, memberName: string) => {
    if (!activeOrg) return;
    const ok = await ask({
      title: 'Сбросить привязку Telegram?',
      description: `${memberName} потеряет доступ к боту до повторного подключения через приглашение.`,
      confirmLabel: 'Сбросить',
      destructive: true,
    });
    if (!ok) return;
    setResettingTelegramUserId(targetUserId);
    try {
      const res = await orgsApi.resetMemberTelegramBinding(
        activeOrg.id,
        targetUserId,
      );
      toast.success(
        res.removed > 0
          ? `Привязка Telegram сброшена (удалено: ${res.removed})`
          : 'У сотрудника не было активных привязок Telegram',
      );
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось сбросить привязку',
      );
    } finally {
      setResettingTelegramUserId(null);
    }
  };

  const handleChangeRole = async (
    targetUserId: string,
    role: MembershipApi['role'],
  ) => {
    if (!activeOrg) return;
    try {
      const res = await orgsApi.updateMember(activeOrg.id, targetUserId, { role });
      setMembers((prev) =>
        prev.map((m) => (m.userId === targetUserId ? res.member : m)),
      );
      toast.success('Роль обновлена');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось изменить роль');
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!activeOrg) return;
    const ok = await ask({
      title: 'Удалить участника из организации?',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await orgsApi.removeMember(activeOrg.id, targetUserId);
      setMembers((prev) => prev.filter((m) => m.userId !== targetUserId));
      toast.success('Участник удалён');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-status-danger">{error}</div>;
  }
  if (!activeOrg) {
    return (
      <div className="text-sm text-fg-secondary">
        У вас пока нет организаций.
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Организация</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Настройки {activeOrg.name}
          </p>
        </div>
        {orgs.length > 1 ? (
          <Select value={activeOrgId ?? ''} onValueChange={(v) => setActiveOrgId(v)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </header>

      {/* Информация */}
      <section className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="text-base font-medium">Информация</h2>
        <div className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Название</Label>
            <Input
              id="org-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={!isOwner}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-visibility">Режим видимости</Label>
            <Select
              value={editVisibility}
              onValueChange={(v) => setEditVisibility(v as 'open' | 'strict')}
              disabled={!isOwner}
            >
              <SelectTrigger id="org-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  Open — менеджеры видят все ресурсы Org
                </SelectItem>
                <SelectItem value="strict">
                  Strict — менеджеры видят только свои ресурсы
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-fg-secondary">
              {editVisibility === 'open'
                ? 'Менеджеры могут читать встречи, карточки и задачи коллег. Писать — только свои.'
                : 'Каждый менеджер видит только свои встречи, карточки, задачи. Owner и admin видят всё.'}
            </p>
          </div>
        </div>
        {isOwner ? (
          <Button onClick={handleSaveOrg} disabled={savingOrg}>
            {savingOrg ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        ) : (
          <p className="text-xs text-fg-secondary">
            Только владелец организации может менять эти настройки.
          </p>
        )}
      </section>

      {/* Участники */}
      <section className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="text-base font-medium">
          Участники ({members.length})
        </h2>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-fg-secondary">
            <tr className="border-b border-border-subtle">
              <th className="py-2 text-left font-normal">Email</th>
              <th className="py-2 text-left font-normal">Имя</th>
              <th className="py-2 text-left font-normal">Роль</th>
              <th className="py-2 text-left font-normal">Дата</th>
              {canManageMembers ? <th className="py-2 text-left font-normal">Действия</th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-border-subtle">
                <td className="py-2.5">{m.email}</td>
                <td className="py-2.5">{m.name}</td>
                <td className="py-2.5">
                  {canManageMembers && m.userId !== user?.id ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        handleChangeRole(m.userId, v as MembershipApi['role'])
                      }
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {isOwner ? <SelectItem value="owner">owner</SelectItem> : null}
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="manager">manager</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-fg-secondary">{m.role}</span>
                  )}
                </td>
                <td className="py-2.5 text-fg-secondary">
                  {new Date(m.joinedAt).toLocaleDateString('ru-RU')}
                </td>
                {canManageMembers ? (
                  <td className="py-2.5">
                    <div className="flex items-center gap-1">
                      {/* β-9 — сброс привязки Telegram (директор за сотрудника, если тот сменил телефон / потерял доступ). */}
                      {m.userId !== user?.id ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Сбросить привязку Telegram у сотрудника"
                          onClick={() => handleResetTelegram(m.userId, m.name)}
                          disabled={resettingTelegramUserId === m.userId}
                        >
                          <X className="h-3.5 w-3.5" />
                          <span className="ml-1 hidden lg:inline">Telegram</span>
                        </Button>
                      ) : null}
                      {m.userId !== user?.id && m.role !== 'owner' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Удалить сотрудника"
                          onClick={() => handleRemoveMember(m.userId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* β-9 — Приглашения: GitHub-style flow.
          Кнопка «Пригласить сотрудника» открывает диалог с полями
          имя/роль/email(опц.). После создания — модал «Скопировать ссылку». */}
      {canManageMembers ? (
        <section className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">Приглашения</h2>
            <Button size="sm" onClick={() => setInviteDialogOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Пригласить сотрудника
            </Button>
          </div>

          {pendingInvitations.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-fg-secondary">
                <tr className="border-b border-border-subtle">
                  <th className="py-2 text-left font-normal">Email</th>
                  <th className="py-2 text-left font-normal">Роль</th>
                  <th className="py-2 text-left font-normal">Создано</th>
                  <th className="py-2 text-left font-normal">Истекает</th>
                  <th className="py-2 text-left font-normal">Статус</th>
                  <th className="py-2 text-left font-normal">Действия</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvitations.map((inv) => {
                  const statusDescr = describeInvitationStatus(
                    inv.status,
                    inv.expiresAt,
                  );
                  return (
                    <tr key={inv.id} className="border-b border-border-subtle">
                      <td className="py-2.5">
                        {inv.email ?? (
                          <span className="text-fg-tertiary">
                            без e-mail (ручная ссылка)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-fg-secondary">
                        {inv.role === 'admin'
                          ? 'Администратор'
                          : inv.role === 'manager'
                            ? 'Сотрудник'
                            : 'Владелец'}
                      </td>
                      <td className="py-2.5 text-fg-secondary">
                        {inv.createdAt.toLocaleDateString('ru-RU')}
                      </td>
                      <td className="py-2.5 text-fg-secondary">
                        {inv.expiresAt.toLocaleDateString('ru-RU')}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={
                            statusDescr.tone === 'success'
                              ? 'text-status-success'
                              : statusDescr.tone === 'warning'
                                ? 'text-status-warning'
                                : statusDescr.tone === 'pending'
                                  ? 'text-status-info'
                                  : 'text-fg-tertiary'
                          }
                        >
                          {statusDescr.label}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {inv.status === 'pending' ||
                        inv.status === 'expired' ? (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResend(inv.id)}
                              disabled={resendingId === inv.id}
                            >
                              <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                              {resendingId === inv.id
                                ? 'Перевыпускаем…'
                                : 'Перевыпустить'}
                            </Button>
                            {inv.status === 'pending' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRevoke(inv.id)}
                              >
                                <X className="mr-1 h-3.5 w-3.5" /> Отозвать
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-fg-secondary">
              Активных приглашений нет. Нажмите «Пригласить сотрудника», чтобы
              отправить ссылку для входа и подключения Telegram-бота.
            </p>
          )}
        </section>
      ) : null}
      {confirmDialog}

      {/* β-9 — модал создания приглашения. */}
      <InviteEmployeeDialog
        open={inviteDialogOpen}
        orgId={activeOrg.id}
        onOpenChange={setInviteDialogOpen}
        onCreated={handleInviteCreated}
      />
      {/* β-9 — модал «скопировать ссылку» после создания/перевыпуска. */}
      <InviteCreatedDialog
        open={createdDialogOpen}
        result={lastCreatedInvite}
        onOpenChange={(next) => {
          setCreatedDialogOpen(next);
          if (!next) setLastCreatedInvite(null);
        }}
      />
    </div>
  );
}
