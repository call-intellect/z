'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  CloudUpload,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { documentsApi } from '@/api/documents.api';
import {
  departmentsApi,
  rolesDomainApi,
  type DepartmentApi,
  type RoleDomainApi,
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

const ALL_DEPT_VALUE = '__all__';
const NO_DEPT_VALUE = '__none__';

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; role: RoleDomainApi }
  | { kind: 'remove'; role: RoleDomainApi }
  | { kind: 'upload'; role: RoleDomainApi };

export function RolesTab({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<string>(ALL_DEPT_VALUE);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const deptsSwr = useSWR(['structure-departments', orgId], () =>
    departmentsApi.list(orgId),
  );
  const rolesSwr = useSWR(
    ['structure-roles', orgId, filter],
    () =>
      rolesDomainApi.list(orgId, {
        ...(filter !== ALL_DEPT_VALUE && filter !== NO_DEPT_VALUE
          ? { departmentId: filter }
          : {}),
      }),
    { revalidateOnFocus: false },
  );

  const departments = deptsSwr.data?.items ?? [];
  const isLoading = rolesSwr.isLoading;
  const error = rolesSwr.error;
  const items = useMemo(() => {
    let list = rolesSwr.data?.items ?? [];
    if (filter === NO_DEPT_VALUE) {
      list = list.filter((r) => !r.departmentId);
    }
    return list;
  }, [rolesSwr.data, filter]);

  if (error) {
    if (error instanceof ApiError && error.code === 'http_404') {
      return (
        <AdminEmpty
          title="Раздел в разработке"
          description="API должностей ещё не подключён к backend."
        />
      );
    }
    if (error instanceof ApiError && error.code === 'forbidden') {
      return (
        <AdminEmpty
          title="Недостаточно прав"
          description="Запрос списка должностей отклонён сервером."
        />
      );
    }
    return (
      <AdminError
        message={error instanceof Error ? error.message : 'Ошибка загрузки'}
        onRetry={() => void rolesSwr.mutate()}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-tertiary">Отдел:</span>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-56">
              <SelectValue placeholder="Все отделы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DEPT_VALUE}>Все отделы</SelectItem>
              <SelectItem value={NO_DEPT_VALUE}>Без отдела</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setDialog({ kind: 'create' })}>
            <Plus size={14} className="mr-1" /> Добавить должность
          </Button>
        )}
      </div>

      {isLoading ? (
        <AdminLoading rows={5} />
      ) : items.length === 0 ? (
        <AdminEmpty
          title="Должностей пока нет"
          description={
            canEdit ? 'Создайте первую кнопкой выше.' : 'Структура ещё не заполнена.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay/40 text-xs uppercase tracking-wider text-fg-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">Должность</th>
                <th className="px-4 py-2 text-left">Отдел</th>
                <th className="px-4 py-2 text-right">Сотрудников</th>
                <th className="px-4 py-2 text-left">Карта</th>
                {canEdit && <th className="w-40 px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-bg-overlay/30">
                  <td className="px-4 py-2 font-medium text-fg-primary">
                    <Link
                      href={`/roles/${encodeURIComponent(r.id)}`}
                      className="inline-flex items-center gap-1 hover:text-accent"
                    >
                      {r.name}
                      <ExternalLink size={12} className="opacity-60" />
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {r.departmentName ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
                    {r.personsCount ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-fg-secondary">
                    {profileStatusLabel(r.profileStatus)}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Загрузить должностную инструкцию"
                          onClick={() =>
                            setDialog({ kind: 'upload', role: r })
                          }
                        >
                          <CloudUpload size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Редактировать"
                          onClick={() => setDialog({ kind: 'edit', role: r })}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Удалить"
                          onClick={() =>
                            setDialog({ kind: 'remove', role: r })
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
        <RoleEditDialog
          orgId={orgId}
          departments={departments}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void rolesSwr.mutate();
            toast.success('Должность добавлена.');
          }}
        />
      )}
      {dialog.kind === 'edit' && (
        <RoleEditDialog
          orgId={orgId}
          departments={departments}
          role={dialog.role}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void rolesSwr.mutate();
            toast.success('Должность обновлена.');
          }}
        />
      )}
      {dialog.kind === 'remove' && (
        <RemoveRoleDialog
          orgId={orgId}
          role={dialog.role}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void rolesSwr.mutate();
            toast.success('Должность удалена.');
          }}
        />
      )}
      {dialog.kind === 'upload' && (
        <UploadJobDescriptionDialog
          orgId={orgId}
          role={dialog.role}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            void rolesSwr.mutate();
            toast.success('Должностная инструкция загружена.');
          }}
        />
      )}
    </div>
  );
}

function profileStatusLabel(
  status?: RoleDomainApi['profileStatus'],
): React.ReactNode {
  switch (status) {
    case 'ready':
      return <span className="text-success">готова</span>;
    case 'forming':
      return <span className="text-fg-tertiary">формируется</span>;
    case 'stale':
      return <span className="text-warning">требует обновления</span>;
    case 'error':
      return <span className="text-danger">ошибка</span>;
    case 'absent':
    default:
      return <span className="text-fg-tertiary">нет</span>;
  }
}

function RoleEditDialog({
  orgId,
  role,
  departments,
  onClose,
  onDone,
}: {
  orgId: string;
  role?: RoleDomainApi;
  departments: DepartmentApi[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [departmentId, setDepartmentId] = useState<string | null>(
    role?.departmentId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(role);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Изменить должность' : 'Новая должность'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Название</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Отдел</Label>
            <Select
              value={departmentId ?? NO_DEPT_VALUE}
              onValueChange={(v) =>
                setDepartmentId(v === NO_DEPT_VALUE ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Без отдела" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPT_VALUE}>Без отдела</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                if (role) {
                  await rolesDomainApi.update(orgId, role.id, {
                    name: name.trim(),
                    departmentId,
                  });
                } else {
                  await rolesDomainApi.create(orgId, {
                    name: name.trim(),
                    departmentId,
                  });
                }
                onDone();
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить.');
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

function RemoveRoleDialog({
  orgId,
  role,
  onClose,
  onDone,
}: {
  orgId: string;
  role: RoleDomainApi;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить должность «{role.name}»?</DialogTitle>
          <DialogDescription>
            {(role.personsCount ?? 0) > 0
              ? 'На должности есть сотрудники. Сначала переназначьте их на другую должность.'
              : 'Действие необратимо. Карта должности и должностная инструкция тоже будут удалены.'}
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
                await rolesDomainApi.remove(orgId, role.id);
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

function UploadJobDescriptionDialog({
  orgId,
  role,
  onClose,
  onDone,
}: {
  orgId: string;
  role: RoleDomainApi;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Должностная инструкция: «{role.name}»
          </DialogTitle>
          <DialogDescription>
            Файл будет привязан к этой должности и попадёт в карту должности
            после парсинга.
          </DialogDescription>
        </DialogHeader>
        <label
          htmlFor="jd-upload"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-sm transition-colors ${
            dragOver
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary'
          }`}
        >
          <CloudUpload size={16} />
          {file
            ? `Выбран файл: ${file.name}`
            : 'Перетащите файл или нажмите, чтобы выбрать'}
          <input
            id="jd-upload"
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.md,.rtf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            disabled={!file || busy}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              try {
                await documentsApi.upload(orgId, {
                  file,
                  attachedRoleId: role.id,
                });
                onDone();
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Не удалось загрузить.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Загрузить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
