'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  personsDomainApi,
  type DepartmentApi,
  type PersonDomainApi,
  type RoleDomainApi,
} from '@/api/structure.api';
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

const NO_VALUE = '__none__';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Prefill = { fullName?: string; email?: string; linkUserId?: string };

export function PersonEditDialog({
  orgId,
  person,
  departments,
  roles,
  prefill,
  onClose,
  onDone,
}: {
  orgId: string;
  person?: PersonDomainApi;
  departments: DepartmentApi[];
  roles: RoleDomainApi[];
  prefill?: Prefill;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState(
    person?.fullName ?? prefill?.fullName ?? '',
  );
  const [email, setEmail] = useState(person?.email ?? prefill?.email ?? '');
  const [roleId, setRoleId] = useState<string | null>(person?.roleId ?? null);
  const [departmentId, setDepartmentId] = useState<string | null>(
    person?.departmentId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(person);
  const isCreateCard = Boolean(prefill?.linkUserId);

  const emailOk = !email.trim() || EMAIL_RE.test(email.trim());
  const canSubmit = fullName.trim().length > 0 && emailOk && !busy;

  const title = isEdit
    ? 'Изменить сотрудника'
    : isCreateCard
      ? 'Создать карточку сотрудника'
      : 'Новый сотрудник';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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
                    ...(prefill?.linkUserId
                      ? { linkUserId: prefill.linkUserId }
                      : {}),
                  });
                }
                onDone();
              } catch (e) {
                toast.error(
                  humanizeApiError(e, 'Не удалось сохранить.'),
                );
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

export function RemovePersonDialog({
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
                toast.error(
                  humanizeApiError(e, 'Не удалось удалить.'),
                );
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
