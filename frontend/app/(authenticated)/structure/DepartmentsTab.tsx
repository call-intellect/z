'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { departmentsApi, type DepartmentApi } from '@/api/structure.api';
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
} from '../admin/AdminStateViews';

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; dept: DepartmentApi }
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
                <th className="px-4 py-2 text-right">Должностей</th>
                <th className="px-4 py-2 text-right">Сотрудников</th>
                {canEdit && <th className="w-32 px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((d) => (
                <tr key={d.id} className="hover:bg-bg-overlay/30">
                  <td className="px-4 py-2 font-medium text-fg-primary">
                    {d.name}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
                    {d.rolesCount ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
                    {d.personsCount ?? '—'}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Переименовать"
                          onClick={() =>
                            setDialog({ kind: 'rename', dept: d })
                          }
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Удалить"
                          onClick={() =>
                            setDialog({ kind: 'remove', dept: d })
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
