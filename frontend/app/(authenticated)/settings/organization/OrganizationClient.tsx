'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Trash2, UserPlus } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  type MembershipApi,
  type OrgApi,
  type OrgInvitationApi,
  orgsApi,
} from '@/api/orgs.api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
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
  const { addToast } = useToast();

  const [orgs, setOrgs] = useState<OrgApi[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<MembershipApi[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitationApi[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editVisibility, setEditVisibility] = useState<'open' | 'strict'>('open');
  const [savingOrg, setSavingOrg] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager'>('manager');
  const [inviting, setInviting] = useState(false);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const isOwner = activeOrg && user ? activeOrg.ownerId === user.id : false;
  const myRole: MembershipApi['role'] | null = (() => {
    if (!user) return null;
    return members.find((m) => m.userId === user.id)?.role ?? null;
  })();
  const canManageMembers = isOwner || myRole === 'admin';

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
        orgsApi.listInvitations(orgId).catch(() => ({ invitations: [] })),
      ]);
      setMembers(membersRes.members);
      setInvitations(invitationsRes.invitations);
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
      addToast({ type: 'success', message: 'Настройки организации сохранены' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    } finally {
      setSavingOrg(false);
    }
  };

  const handleInvite = async () => {
    if (!activeOrg) return;
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await orgsApi.invite(activeOrg.id, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInvitations((prev) => [res.invitation, ...prev]);
      setInviteEmail('');
      addToast({ type: 'success', message: 'Приглашение отправлено' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось пригласить',
      });
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    if (!activeOrg) return;
    if (!confirm('Отозвать приглашение?')) return;
    try {
      await orgsApi.revokeInvitation(activeOrg.id, invitationId);
      setInvitations((prev) =>
        prev.map((i) =>
          i.id === invitationId ? { ...i, status: 'revoked' as const } : i,
        ),
      );
      addToast({ type: 'success', message: 'Приглашение отозвано' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось отозвать',
      });
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
      addToast({ type: 'success', message: 'Роль обновлена' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось изменить роль',
      });
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!activeOrg) return;
    if (!confirm('Удалить участника из организации?')) return;
    try {
      await orgsApi.removeMember(activeOrg.id, targetUserId);
      setMembers((prev) => prev.filter((m) => m.userId !== targetUserId));
      addToast({ type: 'success', message: 'Участник удалён' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось удалить',
      });
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
                    {m.userId !== user?.id && m.role !== 'owner' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveMember(m.userId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Приглашения */}
      {canManageMembers ? (
        <section className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-5">
          <h2 className="text-base font-medium">Приглашения</h2>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px] space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@company.ru"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Роль</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as 'admin' | 'manager')}
              >
                <SelectTrigger id="invite-role" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">manager</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
              <UserPlus className="mr-2 h-4 w-4" />
              {inviting ? 'Отправляем…' : 'Пригласить'}
            </Button>
          </div>

          {invitations.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-fg-secondary">
                <tr className="border-b border-border-subtle">
                  <th className="py-2 text-left font-normal">Email</th>
                  <th className="py-2 text-left font-normal">Роль</th>
                  <th className="py-2 text-left font-normal">Статус</th>
                  <th className="py-2 text-left font-normal">До</th>
                  <th className="py-2 text-left font-normal">Действия</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-border-subtle">
                    <td className="py-2.5">{inv.email}</td>
                    <td className="py-2.5 text-fg-secondary">{inv.role}</td>
                    <td className="py-2.5">
                      <span
                        className={
                          inv.status === 'pending'
                            ? 'text-status-warning'
                            : inv.status === 'accepted'
                              ? 'text-status-success'
                              : 'text-fg-secondary'
                        }
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-fg-secondary">
                      {new Date(inv.expiresAt).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="py-2.5">
                      {inv.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(inv.id)}
                        >
                          <Mail className="mr-1 h-3.5 w-3.5" /> Отозвать
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-fg-secondary">Активных приглашений нет.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
