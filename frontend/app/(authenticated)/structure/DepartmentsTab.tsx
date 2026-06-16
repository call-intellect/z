"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Sparkles, Trash2, UserCog } from "lucide-react";
import useSWR from "swr";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  departmentsApi,
  personsDomainApi,
  type DepartmentApi,
  type PersonDomainApi,
} from "@/api/structure.api";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

import {
  AdminEmpty,
  AdminError,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "rename"; dept: DepartmentApi }
  | { kind: "setHead"; dept: DepartmentApi }
  | { kind: "remove"; dept: DepartmentApi }
  | { kind: "tidy" };

const swrKey = (orgId: string) => ["departments", orgId];

type DuplicateGroup = {
  normalized: string;
  members: DepartmentApi[];
};

function normalizeDeptName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function isEmptyDept(d: DepartmentApi): boolean {
  return (d.rolesCount ?? 0) === 0 && (d.personsCount ?? 0) === 0;
}

function findDuplicateGroups(items: DepartmentApi[]): DuplicateGroup[] {
  const byName = new Map<string, DepartmentApi[]>();
  for (const d of items) {
    const key = normalizeDeptName(d.name);
    if (!key) continue;
    const arr = byName.get(key);
    if (arr) arr.push(d);
    else byName.set(key, [d]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [normalized, members] of byName) {
    if (members.length >= 2) groups.push({ normalized, members });
  }
  return groups;
}

function findEmptyDepts(
  items: DepartmentApi[],
  dupGroups: DuplicateGroup[],
): DepartmentApi[] {
  const inDup = new Set<string>();
  for (const g of dupGroups) for (const m of g.members) inDup.add(m.id);
  return items.filter((d) => isEmptyDept(d) && !inDup.has(d.id));
}

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

  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  if (isLoading) return <AdminLoading rows={5} />;
  if (error) {
    if (error instanceof ApiError && error.code === "http_404") {
      return (
        <AdminEmpty
          title="Раздел в разработке"
          description="API отделов ещё не подключён к backend. Загляните позже."
        />
      );
    }
    if (error instanceof ApiError && error.code === "forbidden") {
      return (
        <AdminEmpty
          title="Недостаточно прав"
          description="Запрос списка отделов отклонён сервером."
        />
      );
    }
    return (
      <AdminError
        message={error instanceof Error ? error.message : "Ошибка загрузки"}
        onRetry={() => void mutate()}
      />
    );
  }
  const items = data?.items ?? [];
  const dupGroups = findDuplicateGroups(items);
  const emptyDepts = findEmptyDepts(items, dupGroups);
  const showTidyWizard =
    canEdit && (dupGroups.length > 0 || emptyDepts.length > 0);

  return (
    <div>
      {showTidyWizard && (
        <TidyWizardCard
          dupGroups={dupGroups}
          emptyDepts={emptyDepts}
          onOpen={() => setDialog({ kind: "tidy" })}
        />
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-fg-tertiary">
          Всего отделов: {items.length}
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
            <Plus size={14} className="mr-1" /> Добавить отдел
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <AdminEmpty
          title="Отделов пока нет"
          description={
            canEdit
              ? "Создайте первый отдел кнопкой выше."
              : "Структура ещё не заполнена владельцем компании."
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
                  onRename={() => setDialog({ kind: "rename", dept: d })}
                  onSetHead={() => setDialog({ kind: "setHead", dept: d })}
                  onRemove={() => setDialog({ kind: "remove", dept: d })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog.kind === "create" && (
        <CreateDeptDialog
          orgId={orgId}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void mutate();
            toast.success("Отдел добавлен.");
          }}
        />
      )}
      {dialog.kind === "rename" && (
        <RenameDeptDialog
          orgId={orgId}
          dept={dialog.dept}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void mutate();
            toast.success("Отдел переименован.");
          }}
        />
      )}
      {dialog.kind === "setHead" && (
        <SetHeadDialog
          orgId={orgId}
          dept={dialog.dept}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void mutate();
            toast.success("Глава отдела сохранён.");
          }}
        />
      )}
      {dialog.kind === "remove" && (
        <RemoveDeptDialog
          orgId={orgId}
          dept={dialog.dept}
          onClose={() => setDialog({ kind: "none" })}
          onDone={() => {
            setDialog({ kind: "none" });
            void mutate();
            toast.success("Отдел удалён.");
          }}
        />
      )}
      {dialog.kind === "tidy" && (
        <TidyWizardDialog
          orgId={orgId}
          dupGroups={dupGroups}
          emptyDepts={emptyDepts}
          onClose={() => setDialog({ kind: "none" })}
          onDone={(summary) => {
            setDialog({ kind: "none" });
            void mutate();
            toast.success(summary);
          }}
        />
      )}
    </div>
  );
}

function TidyWizardCard({
  dupGroups,
  emptyDepts,
  onOpen,
}: {
  dupGroups: DuplicateGroup[];
  emptyDepts: DepartmentApi[];
  onOpen: () => void;
}) {
  const dupCount = dupGroups.length;
  const emptyCount = emptyDepts.length;
  const merged = dupGroups.reduce((acc, g) => acc + (g.members.length - 1), 0);

  return (
    <div className="mb-6 rounded-2xl border border-accent/30 bg-gradient-to-b from-accent/10 to-accent/5 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent/20 text-accent">
          <Sparkles size={16} />
        </span>
        <h3 className="text-[15px] font-semibold text-fg-primary">
          Наведём порядок в отделах
        </h3>
        <span className="ml-auto rounded-full bg-chip-info-bg px-2.5 py-0.5 text-[11px] font-medium text-chip-info-fg">
          предложение Коры
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
        {dupCount > 0 && (
          <>
            Нашёл{" "}
            <b className="text-fg-primary">
              {dupCount}{" "}
              {pluralRu(
                dupCount,
                "похожий отдел",
                "похожих отдела",
                "похожих отделов",
              )}
            </b>
            {emptyCount > 0 ? " и " : ". "}
          </>
        )}
        {emptyCount > 0 && (
          <>
            <b className="text-fg-primary">
              {emptyCount}{" "}
              {pluralRu(
                emptyCount,
                "пустое подразделение",
                "пустых подразделения",
                "пустых подразделений",
              )}
            </b>{" "}
            без единого сотрудника.{" "}
          </>
        )}
        Похоже на следы первичной настройки. Объединить дубли и убрать пустые?
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {dupCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-chip-warning-bg px-2.5 py-0.5 text-[11px] font-medium text-chip-warning-fg">
            {merged} {pluralRu(merged, "дубль", "дубля", "дублей")} → объединить
          </span>
        )}
        {emptyCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-chip-info-bg px-2.5 py-0.5 text-[11px] font-medium text-chip-info-fg">
            {emptyCount} пустых на удаление
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-chip-success-bg px-2.5 py-0.5 text-[11px] font-medium text-chip-success-fg">
          люди не пострадают
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onOpen}>
          Показать предложение
        </Button>
      </div>
    </div>
  );
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function TidyWizardDialog({
  orgId,
  dupGroups,
  emptyDepts,
  onClose,
  onDone,
}: {
  orgId: string;
  dupGroups: DuplicateGroup[];
  emptyDepts: DepartmentApi[];
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of dupGroups) init[g.normalized] = g.members[0]?.id ?? "";
    return init;
  });
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    let mergedCount = 0;
    let removedCount = 0;
    const errors: string[] = [];

    for (const g of dupGroups) {
      const targetId = targets[g.normalized] ?? g.members[0]?.id;
      if (!targetId) continue;
      for (const m of g.members) {
        if (m.id === targetId) continue;
        try {
          await departmentsApi.merge(orgId, m.id, targetId);
          mergedCount += 1;
        } catch (e) {
          errors.push(
            humanizeApiError(e, `Не удалось объединить «${m.name}».`),
          );
        }
      }
    }

    for (const d of emptyDepts) {
      try {
        await departmentsApi.remove(orgId, d.id);
        removedCount += 1;
      } catch (e) {
        errors.push(humanizeApiError(e, `Не удалось удалить «${d.name}».`));
      }
    }

    setBusy(false);

    if (errors.length > 0) {
      toast.error(errors[0]);
    }

    const parts: string[] = [];
    if (mergedCount > 0)
      parts.push(
        `объединено ${mergedCount} ${pluralRu(mergedCount, "отдел", "отдела", "отделов")}`,
      );
    if (removedCount > 0) parts.push(`убрано ${removedCount} пустых`);
    const summary =
      parts.length > 0
        ? `Порядок наведён: ${parts.join(", ")}.`
        : "Изменений не внесено.";
    onDone(summary);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Навести порядок в отделах</DialogTitle>
          <DialogDescription>
            Сотрудники и должности из объединяемых отделов перейдут в выбранный
            — люди не пострадают. Действие применяется сразу.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {dupGroups.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
                Похожие отделы — какой оставить
              </div>
              {dupGroups.map((g) => (
                <div
                  key={g.normalized}
                  className="rounded-lg border border-border-subtle bg-bg-card p-3"
                >
                  <div className="space-y-1.5">
                    {g.members.map((m) => (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <input
                          type="radio"
                          name={`tidy-${g.normalized}`}
                          checked={
                            (targets[g.normalized] ?? g.members[0]?.id) === m.id
                          }
                          onChange={() =>
                            setTargets((prev) => ({
                              ...prev,
                              [g.normalized]: m.id,
                            }))
                          }
                          disabled={busy}
                          className="accent-accent"
                        />
                        <span className="font-medium text-fg-primary">
                          {m.name}
                        </span>
                        <span className="text-xs text-fg-tertiary">
                          {m.rolesCount ?? 0} долж. · {m.personsCount ?? 0} чел.
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {emptyDepts.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
                Пустые подразделения — будут удалены
              </div>
              <ul className="space-y-1 rounded-lg border border-border-subtle bg-bg-card p-3 text-sm text-fg-secondary">
                {emptyDepts.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Trash2 size={13} className="text-fg-tertiary" />
                    {d.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={() => void run()}>
            Объединить и убрать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [name, setName] = useState("");
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
                toast.error(humanizeApiError(e, "Не удалось сохранить."));
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
                toast.error(humanizeApiError(e, "Не удалось сохранить."));
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
    headPersonId ? ["person", orgId, headPersonId] : null,
    async () => personsDomainApi.byId(orgId, headPersonId!),
    { revalidateOnFocus: false },
  );
  const headName = headPersonId ? (headData?.person.fullName ?? "…") : null;
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
        {dept.rolesCount ?? "—"}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
        {dept.personsCount ?? "—"}
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
  const [selected, setSelected] = useState<string>(dept.headPersonId ?? "");
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useSWR(
    ["persons", orgId, "all"],
    async () => personsDomainApi.list(orgId, {}),
    { revalidateOnFocus: false },
  );
  const persons = useMemo<PersonDomainApi[]>(() => data?.items ?? [], [data]);

  const save = async (headPersonId: string | null) => {
    setBusy(true);
    try {
      await departmentsApi.setHead(orgId, dept.id, { headPersonId });
      onDone();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось сохранить главу отдела."));
    } finally {
      setBusy(false);
    }
  };

  const initial = dept.headPersonId ?? "";
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
            <div className="text-sm text-fg-tertiary">
              Загрузка сотрудников…
            </div>
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
                  {p.departmentName ? ` — ${p.departmentName}` : ""}
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
            onClick={() => void save(selected === "" ? null : selected)}
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
  const hasContent = (dept.rolesCount ?? 0) > 0 || (dept.personsCount ?? 0) > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить отдел «{dept.name}»?</DialogTitle>
          <DialogDescription>
            {hasContent
              ? "В отделе есть должности или сотрудники. Backend может отклонить операцию — сначала переназначьте их в другой отдел."
              : "Действие необратимо."}
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
                toast.error(humanizeApiError(e, "Не удалось удалить."));
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
