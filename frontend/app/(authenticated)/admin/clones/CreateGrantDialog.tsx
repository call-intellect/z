'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import {
  adminClonesApi,
  type CloneTypeApi,
} from '@/api/admin-clones.api';
import { clonesApi, type CloneListItemApi } from '@/api/clones.api';
import {
  orgMembersApi,
  type OrgMemberSearchItemApi,
} from '@/api/org-members.api';
import { CLONE_TYPE_LABELS } from '@/domain/admin-clone-access-grant';
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

/**
 * Модал «Выдать грант».
 *
 * Поля:
 *   - Получатель (User Org) — поиск через `orgMembersApi.search`, выбор
 *     отображает имя + email. На бэке `grantedToUserId` — UserId, поэтому
 *     из результата используем только записи `type === 'user'`.
 *   - Тип клона — Должность (role) / Сотрудник (person).
 *   - Клон:
 *       · role → Select из `clonesApi.listClones()` (есть на бэке).
 *       · person → текстовое поле с personId (UI для персон-клонов не
 *         реализован — backend поддерживает, оставляем как admin-инструмент).
 *   - Опционально — `expiresAt` (datetime-local, по умолчанию скрыто за
 *     «Дополнительно»; пустое = бессрочно).
 *
 * Обработка ошибок:
 *   - 400 user_not_in_org / role_not_found / person_not_found / 403 forbidden —
 *     показываем читаемое сообщение в модале. Backend уже возвращает русские
 *     тексты в `error.message`.
 */
export function CreateGrantDialog({
  orgId,
  onClose,
  onCreated,
}: {
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  // ───── получатель ─────
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<OrgMemberSearchItemApi[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    userId: string;
    name: string;
    email: string;
  } | null>(null);

  // ───── клон ─────
  const [cloneType, setCloneType] = useState<CloneTypeApi>('role');
  const [roleClones, setRoleClones] = useState<CloneListItemApi[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [personRefIdInput, setPersonRefIdInput] = useState('');

  // ───── срок ─────
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expiresAtInput, setExpiresAtInput] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Загрузка role-клонов при открытии (один раз — список небольшой).
  useEffect(() => {
    let cancelled = false;
    setRolesLoading(true);
    clonesApi
      .listClones(orgId, { pageSize: 200 })
      .then((res) => {
        if (cancelled) return;
        setRoleClones(res.items);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(
          e instanceof ApiError ? e.message : 'Не удалось загрузить клонов',
        );
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Поиск пользователей с debounce 250мс.
  useEffect(() => {
    const trimmed = userQuery.trim();
    if (trimmed.length < 2) {
      setUserResults([]);
      return;
    }
    let cancelled = false;
    setUserSearchLoading(true);
    const t = setTimeout(() => {
      orgMembersApi
        .search(trimmed, 10)
        .then((res) => {
          if (cancelled) return;
          // Гранты выдаются только User'ам (User.id), а не Person'ам.
          setUserResults(res.items.filter((it) => it.type === 'user'));
        })
        .catch((e) => {
          if (cancelled) return;
          toast.error(
            e instanceof ApiError ? e.message : 'Не удалось искать пользователей',
          );
        })
        .finally(() => {
          if (!cancelled) setUserSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [userQuery]);

  const selectedRoleLabel = useMemo(() => {
    const item = roleClones.find((c) => c.roleId === selectedRoleId);
    if (!item) return null;
    return `${item.publicName} · ${item.roleName}`;
  }, [roleClones, selectedRoleId]);

  const handleSubmit = async () => {
    setFormError(null);

    if (!selectedUser) {
      setFormError('Выберите получателя гранта');
      return;
    }
    const cloneRefId =
      cloneType === 'role' ? selectedRoleId : personRefIdInput.trim();
    if (!cloneRefId) {
      setFormError(
        cloneType === 'role'
          ? 'Выберите клон должности'
          : 'Укажите идентификатор сотрудника',
      );
      return;
    }

    // datetime-local → ISO с локальной зоной. new Date(str).toISOString().
    let expiresAt: string | null = null;
    if (expiresAtInput.trim()) {
      const parsed = new Date(expiresAtInput);
      if (Number.isNaN(parsed.getTime())) {
        setFormError('Неверный формат даты истечения');
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        setFormError('Дата истечения должна быть в будущем');
        return;
      }
      expiresAt = parsed.toISOString();
    }

    setSubmitting(true);
    try {
      await adminClonesApi.createAccessGrant(orgId, {
        grantedToUserId: selectedUser.userId,
        cloneType,
        cloneRefId,
        expiresAt,
      });
      toast.success('Грант выдан');
      onCreated();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось выдать грант';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => (!o && !submitting ? onClose() : undefined)}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Выдать грант доступа</DialogTitle>
          <DialogDescription>
            Откройте сотруднику доступ к выбранному клону. Сотрудник сразу
            сможет задавать клону вопросы.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ─────────── Получатель ─────────── */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Получатель</Label>
            {selectedUser ? (
              <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-subtle px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{selectedUser.name}</div>
                  <div className="text-xs text-fg-tertiary">
                    {selectedUser.email}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedUser(null)}
                  disabled={submitting}
                >
                  Изменить
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
                  />
                  <Input
                    className="pl-8"
                    placeholder="Имя или email сотрудника (≥ 2 символа)"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {userSearchLoading && (
                  <div className="flex items-center gap-2 text-xs text-fg-tertiary">
                    <Loader2 size={12} className="animate-spin" /> Поиск…
                  </div>
                )}
                {!userSearchLoading &&
                  userQuery.trim().length >= 2 &&
                  userResults.length === 0 && (
                    <div className="text-xs text-fg-tertiary">
                      Никого не найдено. Пользователь должен быть участником
                      организации.
                    </div>
                  )}
                {userResults.length > 0 && (
                  <ul className="max-h-48 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
                    {userResults.map((it) =>
                      it.type === 'user' ? (
                        <li key={it.userId}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-bg-overlay"
                            onClick={() =>
                              setSelectedUser({
                                userId: it.userId,
                                name: it.name,
                                email: it.email,
                              })
                            }
                          >
                            <div className="font-medium">{it.name}</div>
                            <div className="text-[11px] text-fg-tertiary">
                              {it.email}
                            </div>
                          </button>
                        </li>
                      ) : null,
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ─────────── Тип клона ─────────── */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Тип клона</Label>
            <Select
              value={cloneType}
              onValueChange={(v) => {
                setCloneType(v as CloneTypeApi);
                setSelectedRoleId('');
                setPersonRefIdInput('');
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="role">{CLONE_TYPE_LABELS.role}</SelectItem>
                <SelectItem value="person">
                  {CLONE_TYPE_LABELS.person}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ─────────── Выбор клона ─────────── */}
          {cloneType === 'role' ? (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Клон должности</Label>
              {rolesLoading ? (
                <div className="flex items-center gap-2 text-xs text-fg-tertiary">
                  <Loader2 size={12} className="animate-spin" /> Загружаем
                  список клонов…
                </div>
              ) : roleClones.length === 0 ? (
                <div className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-2 text-xs text-fg-tertiary">
                  В организации пока нет ни одного клона должности.
                </div>
              ) : (
                <>
                  <Select
                    value={selectedRoleId}
                    onValueChange={setSelectedRoleId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите клона…" />
                    </SelectTrigger>
                    <SelectContent>
                      {roleClones.map((c) => (
                        <SelectItem key={c.roleId} value={c.roleId}>
                          {c.publicName} · {c.roleName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedRoleLabel && (
                    <div className="text-[11px] text-fg-tertiary">
                      Выбран: {selectedRoleLabel}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Идентификатор сотрудника
              </Label>
              <Input
                value={personRefIdInput}
                onChange={(e) => setPersonRefIdInput(e.target.value)}
                placeholder="personId"
              />
              <div className="text-[11px] text-fg-tertiary">
                UI выбора сотрудников пока не реализован — введите personId
                вручную (обычно берётся со страницы сотрудника).
              </div>
            </div>
          )}

          {/* ─────────── Доп. параметры ─────────── */}
          <div className="space-y-1.5 rounded-md border border-border-subtle p-3">
            <button
              type="button"
              className="text-xs font-medium text-fg-secondary hover:text-fg-primary"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? 'Скрыть дополнительные' : 'Дополнительно'}
            </button>
            {showAdvanced && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Срок действия</Label>
                <Input
                  type="datetime-local"
                  value={expiresAtInput}
                  onChange={(e) => setExpiresAtInput(e.target.value)}
                />
                <div className="text-[11px] text-fg-tertiary">
                  Оставьте пустым для бессрочного доступа. После истечения
                  доступ автоматически перестанет действовать.
                </div>
              </div>
            )}
          </div>

          {formError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {formError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" /> Выдаём…
              </>
            ) : (
              'Выдать грант'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
