"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  IdCard,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  departmentsApi,
  personsDomainApi,
  rolesDomainApi,
  teamRosterApi,
  type PersonDomainApi,
  type TeamRosterItemApi,
} from "@/api/structure.api";
import { orgsApi } from "@/api/orgs.api";
import {
  mapOrgInvitationCreateResultDtoToDomain,
  type OrgInvitationCreateResultDomain,
} from "@/domain/org-invitations";
import { useAuth } from "@/contexts/auth-context";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import { InviteEmployeeDialog } from "@/ui/components/team/InviteEmployeeDialog";
import { InviteCreatedDialog } from "@/ui/components/team/InviteCreatedDialog";
import {
  PersonEditDialog,
  RemovePersonDialog,
} from "@/ui/components/team/PersonDialogs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

import {
  AdminEmpty,
  AdminError,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

const ALL_VALUE = "__all__";
const NO_VALUE = "__none__";

const INVITATION_LABELS: Record<TeamRosterItemApi["invitationStatus"], string> =
  {
    none: "не приглашён",
    pending: "приглашение отправлено",
    accepted: "активен",
    revoked: "приглашение отозвано",
    expired: "приглашение истекло",
  };

const SYSTEM_ROLE_LABELS: Record<
  NonNullable<TeamRosterItemApi["systemRole"]>,
  string
> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  coo: "Операционный директор",
  hr_partner: "HR-партнёр",
  demo_observer: "Наблюдатель",
};

function rosterToPerson(r: TeamRosterItemApi, orgId: string): PersonDomainApi {
  return {
    id: r.personId ?? "",
    orgId,
    fullName: r.fullName,
    email: r.email,
    roleId: r.roleId,
    roleName: r.roleName,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    userId: r.userId,
    invitationStatus: r.invitationStatus,
    createdAt: "",
  };
}

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "createCard"; member: TeamRosterItemApi }
  | { kind: "edit"; person: PersonDomainApi }
  | { kind: "remove"; person: PersonDomainApi };

export function PersonsTab({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}) {
  const { user } = useAuth();
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const [deptFilter, setDeptFilter] = useState<string>(ALL_VALUE);
  const [roleFilter, setRoleFilter] = useState<string>(ALL_VALUE);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE);
  const [relationshipFilter, setRelationshipFilter] =
    useState<string>(ALL_VALUE);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [createdInvite, setCreatedInvite] =
    useState<OrgInvitationCreateResultDomain | null>(null);
  const [createdDialogOpen, setCreatedDialogOpen] = useState(false);

  const deptsSwr = useSWR(["persons-departments", orgId], () =>
    departmentsApi.list(orgId),
  );
  const rolesSwr = useSWR(["persons-roles", orgId], () =>
    rolesDomainApi.list(orgId),
  );
  const rosterSwr = useSWR(
    ["team-roster", orgId],
    () => teamRosterApi.list(orgId),
    { revalidateOnFocus: false },
  );

  const departments = deptsSwr.data?.items ?? [];
  const roles = rolesSwr.data?.items ?? [];

  const items = useMemo(() => {
    let list = rosterSwr.data?.roster ?? [];
    if (deptFilter === NO_VALUE) list = list.filter((p) => !p.departmentId);
    else if (deptFilter !== ALL_VALUE)
      list = list.filter((p) => p.departmentId === deptFilter);
    if (roleFilter === NO_VALUE) list = list.filter((p) => !p.roleId);
    else if (roleFilter !== ALL_VALUE)
      list = list.filter((p) => p.roleId === roleFilter);
    if (statusFilter !== ALL_VALUE)
      list = list.filter((p) => p.invitationStatus === statusFilter);
    if (relationshipFilter !== ALL_VALUE)
      list = list.filter((p) => p.relationship === relationshipFilter);
    return list;
  }, [rosterSwr.data, deptFilter, roleFilter, statusFilter, relationshipFilter]);

  const currentUserIsOwner = useMemo(
    () =>
      (rosterSwr.data?.roster ?? []).some(
        (r) => r.userId === user?.id && r.systemRole === "owner",
      ),
    [rosterSwr.data, user?.id],
  );

  const refresh = () => void rosterSwr.mutate();

  const handleInvitePerson = async (personId: string) => {
    try {
      await personsDomainApi.invite(orgId, personId);
      toast.success("Приглашение отправлено.");
      refresh();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось пригласить."));
    }
  };

  const handleChangeRole = async (
    targetUserId: string,
    role: "owner" | "admin" | "manager",
  ) => {
    try {
      await orgsApi.updateMember(orgId, targetUserId, { role });
      toast.success("Системная роль обновлена.");
      refresh();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось изменить роль."));
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    const ok = await ask({
      title: "Удалить участника из компании?",
      description:
        "Аккаунт потеряет доступ к компании. Карточка сотрудника (если есть) сохранится.",
      confirmLabel: "Удалить",
      destructive: true,
    });
    if (!ok) return;
    try {
      await orgsApi.removeMember(orgId, targetUserId);
      toast.success("Участник удалён из компании.");
      refresh();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось удалить."));
    }
  };

  const handleResetTelegram = async (targetUserId: string, name: string) => {
    const ok = await ask({
      title: "Сбросить привязку Telegram?",
      description: `${name} потеряет доступ к боту до повторного подключения.`,
      confirmLabel: "Сбросить",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await orgsApi.resetMemberTelegramBinding(orgId, targetUserId);
      toast.success(
        res.removed > 0
          ? `Привязка Telegram сброшена (удалено: ${res.removed}).`
          : "Активных привязок Telegram не было.",
      );
      refresh();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось сбросить привязку."));
    }
  };

  const handleResend = async (invitationId: string) => {
    try {
      const res = await orgsApi.resendInvitation(orgId, invitationId);
      const created = mapOrgInvitationCreateResultDtoToDomain(res.invitation);
      setCreatedInvite(created);
      setCreatedDialogOpen(true);
      toast.success("Приглашение перевыпущено — обновите ссылку у сотрудника.");
      refresh();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось перевыпустить."));
    }
  };

  const handleRevoke = async (invitationId: string) => {
    const ok = await ask({
      title: "Отозвать приглашение?",
      confirmLabel: "Отозвать",
      destructive: true,
    });
    if (!ok) return;
    try {
      await orgsApi.revokeInvitation(orgId, invitationId);
      toast.success("Приглашение отозвано.");
      refresh();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось отозвать."));
    }
  };

  const handleInviteCreated = (created: OrgInvitationCreateResultDomain) => {
    setCreatedInvite(created);
    setCreatedDialogOpen(true);
    refresh();
  };

  const error = rosterSwr.error;
  if (error) {
    if (error instanceof ApiError && error.code === "http_404") {
      return (
        <AdminEmpty
          title="Раздел в разработке"
          description="API команды ещё не подключён к backend."
        />
      );
    }
    if (error instanceof ApiError && error.code === "forbidden") {
      return (
        <AdminEmpty
          title="Недостаточно прав"
          description="Запрос списка команды отклонён сервером."
        />
      );
    }
    return (
      <AdminError
        message={error instanceof Error ? error.message : "Ошибка загрузки"}
        onRetry={() => void rosterSwr.mutate()}
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
          <Select
            value={relationshipFilter}
            onValueChange={setRelationshipFilter}
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue placeholder="Все" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Сотрудники и клиенты</SelectItem>
              <SelectItem value="employee">Только сотрудники</SelectItem>
              <SelectItem value="external">Только клиенты</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteDialogOpen(true)}
            >
              <UserPlus size={14} className="mr-1" /> Пригласить
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
              <Plus size={14} className="mr-1" /> Добавить сотрудника
            </Button>
          </div>
        )}
      </div>

      {rosterSwr.isLoading ? (
        <AdminLoading rows={6} />
      ) : items.length === 0 ? (
        <AdminEmpty
          title="Никого не найдено"
          description={
            canEdit
              ? "Добавьте первого сотрудника кнопкой выше."
              : "Список пуст."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay/40 text-xs uppercase tracking-wider text-fg-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">Имя</th>
                <th className="px-4 py-2 text-left">Эл. почта</th>
                <th className="px-4 py-2 text-left">Должность</th>
                <th className="px-4 py-2 text-left">Отдел</th>
                <th className="px-4 py-2 text-left">Статус</th>
                <th className="px-4 py-2 text-left">Системная роль</th>
                {canEdit && <th className="w-40 px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((p) => (
                <tr
                  key={p.personId ?? `member-${p.userId}`}
                  className="hover:bg-bg-overlay/30"
                >
                  <td className="px-4 py-2 font-medium text-fg-primary">
                    {p.hasPersonCard && p.personId ? (
                      <Link
                        href={`/structure/persons/${p.personId}`}
                        className="hover:underline"
                      >
                        {p.fullName}
                      </Link>
                    ) : (
                      p.fullName
                    )}
                    {!p.hasPersonCard && (
                      <span className="ml-2 text-xs font-normal text-fg-tertiary">
                        нет карточки сотрудника
                      </span>
                    )}
                    {p.relationship === "external" && (
                      <span className="ml-2 rounded-full bg-bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-tertiary">
                        Клиент
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {p.email ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {p.roleName ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {p.departmentName ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <InvitationBadge status={p.invitationStatus} />
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {p.systemRole ? SYSTEM_ROLE_LABELS[p.systemRole] : "—"}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Действия"
                          >
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {p.hasPersonCard && p.personId ? (
                            <>
                              <DropdownMenuItem
                                onSelect={() =>
                                  setDialog({
                                    kind: "edit",
                                    person: rosterToPerson(p, orgId),
                                  })
                                }
                              >
                                <Pencil size={14} className="mr-2" />{" "}
                                Редактировать карточку
                              </DropdownMenuItem>
                              {p.invitationStatus !== "accepted" &&
                                p.email &&
                                !p.userId && (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void handleInvitePerson(
                                        p.personId as string,
                                      )
                                    }
                                  >
                                    <Mail size={14} className="mr-2" />{" "}
                                    Пригласить
                                  </DropdownMenuItem>
                                )}
                              {(p.invitationStatus === "pending" ||
                                p.invitationStatus === "expired") &&
                                p.invitationId && (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void handleResend(
                                        p.invitationId as string,
                                      )
                                    }
                                  >
                                    Перевыпустить приглашение
                                  </DropdownMenuItem>
                                )}
                              {p.invitationStatus === "pending" &&
                                p.invitationId && (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void handleRevoke(
                                        p.invitationId as string,
                                      )
                                    }
                                  >
                                    Отозвать приглашение
                                  </DropdownMenuItem>
                                )}
                            </>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() =>
                                setDialog({ kind: "createCard", member: p })
                              }
                            >
                              <IdCard size={14} className="mr-2" /> Создать
                              карточку
                            </DropdownMenuItem>
                          )}

                          {p.userId &&
                            p.userId !== user?.id &&
                            p.systemRole && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger>
                                    Системная роль
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    {currentUserIsOwner && (
                                      <DropdownMenuItem
                                        onSelect={() =>
                                          void handleChangeRole(
                                            p.userId as string,
                                            "owner",
                                          )
                                        }
                                      >
                                        Владелец
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        void handleChangeRole(
                                          p.userId as string,
                                          "admin",
                                        )
                                      }
                                    >
                                      Администратор
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        void handleChangeRole(
                                          p.userId as string,
                                          "manager",
                                        )
                                      }
                                    >
                                      Менеджер
                                    </DropdownMenuItem>
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void handleResetTelegram(
                                      p.userId as string,
                                      p.fullName,
                                    )
                                  }
                                >
                                  Сбросить Telegram
                                </DropdownMenuItem>
                                {p.systemRole !== "owner" && (
                                  <DropdownMenuItem
                                    className="text-danger focus:text-danger"
                                    onSelect={() =>
                                      void handleRemoveMember(
                                        p.userId as string,
                                      )
                                    }
                                  >
                                    Удалить из компании
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}

                          {p.hasPersonCard && p.personId && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-danger focus:text-danger"
                                onSelect={() =>
                                  setDialog({
                                    kind: "remove",
                                    person: rosterToPerson(p, orgId),
                                  })
                                }
                              >
                                <Trash2 size={14} className="mr-2" /> Удалить
                                карточку
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog.kind === "create" && (
        <PersonEditDialog
          orgId={orgId}
          departments={departments}
          roles={roles}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void rosterSwr.mutate();
            toast.success("Сотрудник добавлен.");
          }}
        />
      )}
      {dialog.kind === "createCard" && (
        <PersonEditDialog
          orgId={orgId}
          departments={departments}
          roles={roles}
          prefill={{
            fullName: dialog.member.fullName,
            email: dialog.member.email ?? undefined,
            linkUserId: dialog.member.userId ?? undefined,
          }}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void rosterSwr.mutate();
            toast.success("Карточка сотрудника создана.");
          }}
        />
      )}
      {dialog.kind === "edit" && (
        <PersonEditDialog
          orgId={orgId}
          person={dialog.person}
          departments={departments}
          roles={roles}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void rosterSwr.mutate();
            toast.success("Сотрудник обновлён.");
          }}
        />
      )}
      {dialog.kind === "remove" && (
        <RemovePersonDialog
          orgId={orgId}
          person={dialog.person}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void rosterSwr.mutate();
            toast.success("Сотрудник удалён.");
          }}
        />
      )}

      {confirmDialog}
      <InviteEmployeeDialog
        open={inviteDialogOpen}
        orgId={orgId}
        onOpenChange={setInviteDialogOpen}
        onCreated={handleInviteCreated}
      />
      <InviteCreatedDialog
        open={createdDialogOpen}
        result={createdInvite}
        onOpenChange={(next) => {
          setCreatedDialogOpen(next);
          if (!next) setCreatedInvite(null);
        }}
      />
    </div>
  );
}

function InvitationBadge({
  status,
}: {
  status: TeamRosterItemApi["invitationStatus"];
}) {
  const variant: "default" | "secondary" | "outline" =
    status === "accepted" ? "default" : "secondary";
  return (
    <Badge variant={variant} className="text-[10px]">
      {INVITATION_LABELS[status]}
    </Badge>
  );
}
