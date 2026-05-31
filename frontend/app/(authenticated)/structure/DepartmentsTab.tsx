'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, UserCog } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  departmentsApi,
  personsDomainApi,
  type DepartmentApi,
  type PersonDomainApi,
} from '@/api/structure.api';
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

import {
  AdminEmpty,
  AdminError,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; dept: DepartmentApi }
  | { kind: 'setHead'; dept: DepartmentApi }
  | { kind: 'remove'; dept: DepartmentApi };

const swrKey = (orgId: string) => ['departments', orgId];

export function DepartmentsTab({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}) {
  const { data, error, isLoading, mutate } = useSWR(
    swrKey(orgId),
    async () => departmentsApi.list(orgId),
    { revalidateOnFocus: false },
  );

  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  if (isLoading) return <AdminLoading rows={5} />;
  if (error) {
    if (error instanceof ApiError && error.code === 'http_404') {
      return (
        <AdminEmpty
          title="Раздел в разработке"
          description="API отделов ещё не подключён к backend. Загляните позже."
        />
      );
    }
    if (error instanceof ApiError && error.code === 'forbidden') {
      return (
        <AdminEmpty
          title="Недостаточно прав"
          description="Запрос списка отделов отклонён сервером."
        />
      );
    }
    return (
      <AdminError
        message={error instanceof Error ? error.message : 'Ошибка загрузки'}
        onRetry={() => void mutate()}
      />
    );
  }
  const items = data?.items ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-fg-tertiary">
          Всего отделов: {items.length}
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setDialog({ kind: 'create' })}
          >
            <Plus size={14} className="mr-1" /> Добавить отдел
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <AdminEmpty
          title="Отделов пока нет"
          description={
            canEdit
              ? 'Создайте первый отдел кнопкой выше.'
              : 'Структура ещё не заполнена владельцем компании.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay/40 text-xs uppercase tracking-wider text-fg-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">Название</th>
                <th className="px-4 py-2 text-left">Глава отдела</th>
                <th className="px-4 py-2 text-right">Должностей</th>
                <th className="px-4 py-2 text-right">Сотрудников</th>
                {canEdit && <th className="w-40 px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((d) => (
                <DepartmentRow
                  key={d.id}
                  orgId={orgId}
                  dept={d}
                  canEdit={canEdit}
                  onRename={() => setDialog({ kind: 'rename', dept: d })}
                  onSetHead={() => setDialog({ kind: 'setHead', dept: d })}
                  onRemove={() => setDialog({ kind: 'remove', dept: d })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog.kind === 'create' && (
        <CreateDeptDialog
          orgId={orgId}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void mutate();
            toast.success('Отдел добавлен.');
          }}
        />
      )}
      {dialog.kind === 'rename' && (
        <RenameDeptDialog
          orgId={orgId}
          dept={dialog.dept}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void mutate();
            toast.success('Отдел переименован.');
          }}
        />
      )}
      {dialog.kind === 'setHead' && (
        <SetHeadDialog
          orgId={orgId}
          dept={dialog.dept}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void mutate();
            toast.success('Глава отдела сохранён.');
          }}
        />
      )}
      {dialog.kind === 'remove' && (
        <RemoveDeptDialog
          orgId={orgId}
          dept={dialog.dept}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void mutate();
            toast.success('Отдел удалён.');
          }}
        />
      )}
    </div>
  );
}

function CreateDeptDialog({
  orgId,
  onClose,
  onDone,
}: {
  orgId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый отдел</DialogTitle>
          <DialogDescription>
            Например, «Продажи» или «Разработка».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dept-new-name">Название</Label>
          <Input
            id="dept-new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await departmentsApi.create(orgId, { name: name.trim() });
                onDone();
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDeptDialog({
  orgId,
  dept,
  onClose,
  onDone,
}: {
  orgId: string;
  dept: DepartmentApi;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(dept.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(dept.name), [dept]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Переименовать отдел</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dept-name">Название</Label>
          <Input
            id="dept-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            disabled={busy || !name.trim() || name.trim() === dept.name}
            onClick={async () => {
              setBusy(true);
              try {
                await departmentsApi.update(orgId, dept.id, {
                  name: name.trim(),
                });
                onDone();
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ТЗ 2026-05-25 «clone-reliability-hardening» Фаза 3 — ряд таблицы с
 * отображением главы отдела. Имя главы достаётся одним SWR-запросом
 * `personsDomainApi.byId` (когда headPersonId задан); иначе — «Не назначен».
 * Кэширование — стандартное SWR (тот же ключ для одного personId
 * переиспользуется при перерендерах).
 */
function DepartmentRow({
  orgId,
  dept,
  canEdit,
  onRename,
  onSetHead,
  onRemove,
}: {
  orgId: string;
  dept: DepartmentApi;
  canEdit: boolean;
  onRename: () => void;
  onSetHead: () => void;
  onRemove: () => void;
}) {
  const headPersonId = dept.headPersonId ?? null;
  const { data: headData } = useSWR(
    headPersonId ? ['person', orgId, headPersonId] : null,
    async () => personsDomainApi.byId(orgId, headPersonId!),
    { revalidateOnFocus: false },
  );
  const headName = headPersonId
    ? headData?.person.fullName ?? '…'
    : null;
  return (
    <tr className="hover:bg-bg-overlay/30">
      <td className="px-4 py-2 font-medium text-fg-primary">{dept.name}</td>
      <td className="px-4 py-2 text-fg-secondary">
        {headName ? (
          <span>{headName}</span>
        ) : (
          <span className="text-fg-tertiary">Не назначен</span>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
        {dept.rolesCount ?? '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
        {dept.personsCount ?? '—'}
      </td>
      {canEdit && (
        <td className="px-4 py-2 text-right">
          <div className="flex justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Назначить главу отдела"
              title="Назначить главу отдела"
              onClick={onSetHead}
            >
              <UserCog size={14} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Переименовать"
              onClick={onRename}
            >
              <Pencil size={14} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Удалить"
              onClick={onRemove}
            >
              <Trash2 size={14} className="text-danger" />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

/**
 * ТЗ 2026-05-25 Фаза 3 — диалог назначения/снятия главы отдела.
 *
 * Опции — все сотрудники Org (`personsDomainApi.list` без фильтра по отделу:
 * глава отдела может быть руководителем-сотрудником из другого отдела —
 * например, в маленьких компаниях, где один человек ведёт два направления).
 * Backend дополнительно валидирует, что выбранный person — `relationship='employee'`.
 *
 * Кнопка «Снять» отправляет `headPersonId=null` (доступна, если глава назначен).
 */
function SetHeadDialog({
  orgId,
  dept,
  onClose,
  onDone,
}: {
  orgId: string;
  dept: DepartmentApi;
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string>(dept.headPersonId ?? '');
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useSWR(
    ['persons', orgId, 'all'],
    async () => personsDomainApi.list(orgId, {}),
    { revalidateOnFocus: false },
  );
  const persons = useMemo<PersonDomainApi[]>(
    () => data?.items ?? [],
    [data],
  );

  const save = async (headPersonId: string | null) => {
    setBusy(true);
    try {
      await departmentsApi.setHead(orgId, dept.id, { headPersonId });
      onDone();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось сохранить главу отдела.',
      );
    } finally {
      setBusy(false);
    }
  };

  const initial = dept.headPersonId ?? '';
  const changed = selected !== initial;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Глава отдела «{dept.name}»</DialogTitle>
          <DialogDescription>
            Глава отдела первым получает уведомления об аномалиях в профилях
            знаний и навыков своих сотрудников. Если главы нет — уведомления
            идут владельцу и администраторам организации.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="dept-head-select">Сотрудник</Label>
          {isLoading ? (
            <div className="text-sm text-fg-tertiary">Загрузка сотрудников…</div>
          ) : error ? (
            <div className="text-sm text-danger">
              Не удалось загрузить список сотрудников.
            </div>
          ) : (
            <select
              id="dept-head-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-10 w-full rounded-md border border-border-subtle bg-bg-card px-3 text-sm"
              disabled={busy}
            >
              <option value="">Не назначен</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.departmentName ? ` — ${p.departmentName}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {initial && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void save(null)}
            >
              Снять
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            disabled={busy || !changed}
            onClick={() => void save(selected === '' ? null : selected)}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDeptDialog({
  orgId,
  dept,
  onClose,
  onDone,
}: {
  orgId: string;
  dept: DepartmentApi;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const hasContent =
    (dept.rolesCount ?? 0) > 0 || (dept.personsCount ?? 0) > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить отдел «{dept.name}»?</DialogTitle>
          <DialogDescription>
            {hasContent
              ? 'В отделе есть должности или сотрудники. Backend может отклонить операцию — сначала переназначьте их в другой отдел.'
              : 'Действие необратимо.'}
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
                await departmentsApi.remove(orgId, dept.id);
                onDone();
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить.');
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
