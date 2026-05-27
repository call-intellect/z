'use client';

/**
 * SprintCreateWizard — расширенный мастер создания спринта (ТЗ 2026-05-28).
 *
 * Два шага:
 *   1) 'scope'      — выбор привязки спринта (6 вариантов: компания / отдел /
 *                     клиент / поставщик / сотрудник / проект). Для каждого
 *                     варианта (кроме «компания») — combobox существующей
 *                     сущности с поддержкой inline-create новой.
 *   2) 'parameters' — название, длительность, дата начала.
 *
 * Сабмит — атомарный `POST /api/v1/sprints/quick-create`: backend в одной
 * transaction создаёт Project (если нужно) + Cycle + Board + State'ы.
 *
 * Inline-create: combobox показывает кнопку «+ Создать “<query>”» поверх
 * списка, при клике разворачивается мини-форма; на успех новый объект
 * выбирается автоматически.
 *
 * A11y: radio-группа с `role="radiogroup"`, combobox с `aria-expanded`,
 * клавиатурная навигация по Command (cmdk).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Briefcase,
  Check,
  ChevronDown,
  FolderKanban,
  Loader2,
  Plus,
  Rocket,
  User,
  UserCircle2,
  Users,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/shadcn/command';
import { cn } from '@/ui/shadcn/lib/utils';
import { useAuth } from '@/contexts/auth-context';

import { useProjects } from '@/hooks/tracker/useProjects';
import { useVendors } from '@/hooks/useVendors';
import { useCards } from '@/hooks/useCards';
import { useDepartments } from '@/hooks/useDepartments';
import { useRoles } from '@/hooks/useRoles';
import { usePersons } from '@/hooks/usePersons';

import { vendorsApi } from '@/api/vendors.api';
import { cardsApi } from '@/api/cards.api';
import {
  departmentsApi,
  personsDomainApi,
} from '@/api/structure.api';
import {
  sprintsListApi,
  type QuickCreateSprintRequest,
} from '@/api/sprints.api';
import type { SprintScopeKindApi } from '@/domain/sprint';

// ─── Константы ──────────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { value: 7, label: '1 неделя' },
  { value: 14, label: '2 недели' },
  { value: 21, label: '3 недели' },
  { value: 28, label: '4 недели' },
] as const;

type ScopeKind = SprintScopeKindApi;

interface ScopeOption {
  kind: ScopeKind;
  title: string;
  description: string;
  icon: typeof Building2;
}

const SCOPE_OPTIONS: ScopeOption[] = [
  {
    kind: 'org',
    title: 'Компания',
    description: 'Общий спринт всей организации',
    icon: Building2,
  },
  {
    kind: 'department',
    title: 'Отдел',
    description: 'Спринт одного отдела',
    icon: Users,
  },
  {
    kind: 'customer',
    title: 'Клиент',
    description: 'Спринт по конкретному клиенту',
    icon: Briefcase,
  },
  {
    kind: 'vendor',
    title: 'Поставщик',
    description: 'Спринт по поставщику',
    icon: UserCircle2,
  },
  {
    kind: 'person',
    title: 'Сотрудник',
    description: 'Спринт для одной должности и сотрудника',
    icon: User,
  },
  {
    kind: 'project',
    title: 'Проект',
    description: 'Цикл внутри существующего проекта',
    icon: FolderKanban,
  },
];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Универсальный combobox с inline-create ─────────────────────────────────

interface ComboItem {
  id: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  items: ComboItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  isLoading?: boolean;
  /** Если задано — рендерим кнопку «+ Создать “<query>”». */
  onInlineCreate?: (query: string) => Promise<void> | void;
  inlineCreateBusy?: boolean;
  /** Доп. сообщение об ошибке inline-create. */
  inlineCreateError?: string | null;
  /** label для aria. */
  ariaLabel: string;
}

function Combobox({
  items,
  selectedId,
  onSelect,
  placeholder,
  searchPlaceholder,
  emptyText,
  isLoading = false,
  onInlineCreate,
  inlineCreateBusy = false,
  inlineCreateError = null,
  ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.hint ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  // Возможность создать = есть колбэк, query не пустой, и точного совпадения
  // в списке нет.
  const canCreate =
    typeof onInlineCreate === 'function' &&
    query.trim().length > 0 &&
    !filtered.some(
      (it) => it.label.trim().toLowerCase() === query.trim().toLowerCase(),
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-border-subtle bg-bg-elevated px-3 text-left text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            selected ? 'text-fg-primary' : 'text-fg-tertiary',
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown size={14} className="ml-2 shrink-0 text-fg-tertiary" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
          />
          <CommandList>
            {canCreate ? (
              <CommandGroup>
                <button
                  type="button"
                  aria-label={`Создать «${query}»`}
                  disabled={inlineCreateBusy}
                  onClick={() => {
                    if (!onInlineCreate) return;
                    void Promise.resolve(onInlineCreate(query.trim())).then(
                      () => setOpen(true),
                    );
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm text-accent-fg',
                    'bg-accent/10 hover:bg-accent/20',
                    inlineCreateBusy && 'opacity-60',
                  )}
                >
                  {inlineCreateBusy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span className="truncate">Создать «{query.trim()}»</span>
                </button>
                {inlineCreateError ? (
                  <p
                    className="px-3 pb-2 text-xs text-danger"
                    role="alert"
                  >
                    {inlineCreateError}
                  </p>
                ) : null}
              </CommandGroup>
            ) : null}

            {isLoading ? (
              <div className="px-3 py-6 text-center text-sm text-fg-tertiary">
                Загружаем…
              </div>
            ) : filtered.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map((it) => {
                  const isActive = it.id === selectedId;
                  return (
                    <CommandItem
                      key={it.id}
                      value={`${it.label} ${it.hint ?? ''} ${it.id}`}
                      onSelect={() => {
                        onSelect(it.id);
                        setOpen(false);
                      }}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-fg-primary">
                          {it.label}
                        </span>
                        {it.hint ? (
                          <span className="truncate text-xs text-fg-tertiary">
                            {it.hint}
                          </span>
                        ) : null}
                      </div>
                      {isActive ? (
                        <Check size={14} className="text-accent" />
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Wizard ─────────────────────────────────────────────────────────────────

export function SprintCreateWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (cycleId: string) => void;
}) {
  const { currentOrgId } = useAuth();
  const router = useRouter();

  const today = useMemo(() => toIsoDate(new Date()), []);
  const [step, setStep] = useState<'scope' | 'parameters'>('scope');
  const [scope, setScope] = useState<ScopeKind>('org');

  // refId — для customer/vendor/person/department. existingProjectId — для project.
  const [refId, setRefId] = useState<string | null>(null);
  const [existingProjectId, setExistingProjectId] = useState<string | null>(
    null,
  );
  // Для scope='person' — выбранная должность (двухступенчатый picker).
  const [roleId, setRoleId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [durationDays, setDurationDays] = useState<number>(14);
  const [startDate, setStartDate] = useState<string>(today);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineBusy, setInlineBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // ── Источники данных combobox'ов ──
  const { projects, isLoading: projectsLoading, mutate: mutateProjects } =
    useProjects(currentOrgId);
  const { vendors, isLoading: vendorsLoading, mutate: mutateVendors } =
    useVendors(currentOrgId);
  const { cards, isLoading: cardsLoading, mutate: mutateCards } = useCards(
    currentOrgId,
    { kind: 'client', limit: 50 },
  );
  const {
    departments,
    isLoading: departmentsLoading,
    mutate: mutateDepartments,
  } = useDepartments(currentOrgId);
  const { roles, isLoading: rolesLoading } = useRoles(currentOrgId);
  const { persons, isLoading: personsLoading, mutate: mutatePersons } =
    usePersons(currentOrgId, roleId ? { roleId } : {});

  // Сбрасываем выбор сущности при смене scope.
  useEffect(() => {
    setRefId(null);
    setExistingProjectId(null);
    setRoleId(null);
    setInlineError(null);
  }, [scope]);

  const reset = () => {
    setStep('scope');
    setScope('org');
    setRefId(null);
    setExistingProjectId(null);
    setRoleId(null);
    setName('');
    setDurationDays(14);
    setStartDate(today);
    setError(null);
    setInlineError(null);
    setInlineBusy(false);
    setPending(false);
  };

  const handleClose = () => {
    if (pending) return;
    reset();
    onClose();
  };

  // ── Валидация ──
  const scopeIsValid = useMemo(() => {
    if (scope === 'org') return true;
    if (scope === 'project') return Boolean(existingProjectId);
    if (scope === 'person') return Boolean(refId);
    return Boolean(refId);
  }, [scope, refId, existingProjectId]);

  const handleNext = () => {
    if (!scopeIsValid) {
      setError('Выберите привязку спринта.');
      return;
    }
    setError(null);
    setStep('parameters');
  };

  const handleBack = () => {
    setStep('scope');
    setError(null);
  };

  // ── Inline-create handlers ──
  const handleCreateVendor = async (query: string) => {
    if (!currentOrgId) return;
    setInlineBusy(true);
    setInlineError(null);
    try {
      const v = await vendorsApi.create(currentOrgId, { name: query });
      await mutateVendors();
      setRefId(v.id);
    } catch (e) {
      setInlineError(
        e instanceof Error ? e.message : 'Не удалось создать поставщика.',
      );
    } finally {
      setInlineBusy(false);
    }
  };

  const handleCreateCustomer = async (query: string) => {
    setInlineBusy(true);
    setInlineError(null);
    try {
      const c = await cardsApi.create({ name: query, kind: 'client' });
      await mutateCards();
      setRefId(c.id);
    } catch (e) {
      setInlineError(
        e instanceof Error ? e.message : 'Не удалось создать клиента.',
      );
    } finally {
      setInlineBusy(false);
    }
  };

  const handleCreateDepartment = async (query: string) => {
    if (!currentOrgId) return;
    setInlineBusy(true);
    setInlineError(null);
    try {
      const res = await departmentsApi.create(currentOrgId, { name: query });
      await mutateDepartments();
      setRefId(res.department.id);
    } catch (e) {
      setInlineError(
        e instanceof Error ? e.message : 'Не удалось создать отдел.',
      );
    } finally {
      setInlineBusy(false);
    }
  };

  const handleCreatePerson = async (query: string) => {
    if (!currentOrgId || !roleId) return;
    setInlineBusy(true);
    setInlineError(null);
    try {
      const res = await personsDomainApi.create(currentOrgId, {
        fullName: query,
        roleId,
      });
      await mutatePersons();
      setRefId(res.person.id);
    } catch (e) {
      setInlineError(
        e instanceof Error ? e.message : 'Не удалось создать сотрудника.',
      );
    } finally {
      setInlineBusy(false);
    }
  };

  // ── Submit ──
  const handleSubmit = async () => {
    if (!currentOrgId) return;
    if (!name.trim()) {
      setError('Укажите название спринта.');
      return;
    }
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      setError('Некорректная дата начала.');
      return;
    }

    const body: QuickCreateSprintRequest = {
      scope,
      sprintName: name.trim(),
      durationDays: durationDays as 7 | 14 | 21 | 28,
      startDate: toIsoDate(start),
    };
    if (scope === 'project') {
      body.existingProjectId = existingProjectId;
    } else if (scope !== 'org') {
      body.refId = refId;
    }

    setPending(true);
    setError(null);
    try {
      const res = await sprintsListApi.quickCreate(currentOrgId, body);
      // Подсасываем актуальный список проектов (новый, если создался).
      if (scope !== 'project') {
        void mutateProjects();
      }
      onCreated?.(res.cycleId);
      reset();
      onClose();
      router.push(`/sprints/${encodeURIComponent(res.cycleId)}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось создать спринт.',
      );
      setPending(false);
    }
  };

  // ── Рендер ──
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket size={18} className="text-accent" />
            Новый спринт
          </DialogTitle>
          <DialogDescription>
            {step === 'scope'
              ? 'Шаг 1 из 2. Выберите, к кому или к чему привязан спринт.'
              : 'Шаг 2 из 2. Название, длительность и дата начала.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'scope' ? (
          <ScopeStep
            scope={scope}
            onScopeChange={setScope}
            // entity selectors
            departments={departments}
            departmentsLoading={departmentsLoading}
            cards={cards}
            cardsLoading={cardsLoading}
            vendors={vendors}
            vendorsLoading={vendorsLoading}
            roles={roles}
            rolesLoading={rolesLoading}
            persons={persons}
            personsLoading={personsLoading}
            projects={projects}
            projectsLoading={projectsLoading}
            refId={refId}
            onRefIdChange={setRefId}
            existingProjectId={existingProjectId}
            onExistingProjectIdChange={setExistingProjectId}
            roleId={roleId}
            onRoleIdChange={(id) => {
              setRoleId(id);
              setRefId(null);
            }}
            // inline-create
            inlineBusy={inlineBusy}
            inlineError={inlineError}
            onCreateVendor={handleCreateVendor}
            onCreateCustomer={handleCreateCustomer}
            onCreateDepartment={handleCreateDepartment}
            onCreatePerson={handleCreatePerson}
          />
        ) : (
          <ParametersStep
            name={name}
            onNameChange={setName}
            durationDays={durationDays}
            onDurationChange={setDurationDays}
            startDate={startDate}
            onStartDateChange={setStartDate}
          />
        )}

        {error ? (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          {step === 'scope' ? (
            <>
              <Button variant="ghost" onClick={handleClose} disabled={pending}>
                Отмена
              </Button>
              <Button
                onClick={handleNext}
                disabled={!scopeIsValid || !currentOrgId}
                className="gap-2"
              >
                Далее
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={pending}
                className="gap-2"
              >
                <ArrowLeft size={14} /> Назад
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                disabled={pending || !currentOrgId}
                className="gap-2"
              >
                {pending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                Создать спринт
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Шаг 1 (scope) ──────────────────────────────────────────────────────────

interface ScopeStepProps {
  scope: ScopeKind;
  onScopeChange: (kind: ScopeKind) => void;
  departments: Array<{ id: string; name: string }>;
  departmentsLoading: boolean;
  cards: Array<{ id: string; name: string }>;
  cardsLoading: boolean;
  vendors: Array<{ id: string; name: string; inn: string | null }>;
  vendorsLoading: boolean;
  roles: Array<{ id: string; name: string; departmentName?: string | null }>;
  rolesLoading: boolean;
  persons: Array<{ id: string; fullName: string; email: string | null }>;
  personsLoading: boolean;
  projects: Array<{ id: string; name: string; identifier: string }>;
  projectsLoading: boolean;
  refId: string | null;
  onRefIdChange: (id: string | null) => void;
  existingProjectId: string | null;
  onExistingProjectIdChange: (id: string | null) => void;
  roleId: string | null;
  onRoleIdChange: (id: string | null) => void;
  inlineBusy: boolean;
  inlineError: string | null;
  onCreateVendor: (q: string) => Promise<void>;
  onCreateCustomer: (q: string) => Promise<void>;
  onCreateDepartment: (q: string) => Promise<void>;
  onCreatePerson: (q: string) => Promise<void>;
}

function ScopeStep(props: ScopeStepProps) {
  const {
    scope,
    onScopeChange,
    departments,
    departmentsLoading,
    cards,
    cardsLoading,
    vendors,
    vendorsLoading,
    roles,
    rolesLoading,
    persons,
    personsLoading,
    projects,
    projectsLoading,
    refId,
    onRefIdChange,
    existingProjectId,
    onExistingProjectIdChange,
    roleId,
    onRoleIdChange,
    inlineBusy,
    inlineError,
    onCreateVendor,
    onCreateCustomer,
    onCreateDepartment,
    onCreatePerson,
  } = props;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Привязка спринта"
        className="grid grid-cols-2 gap-2"
      >
        {SCOPE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = scope === opt.kind;
          return (
            <button
              key={opt.kind}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onScopeChange(opt.kind)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isActive
                  ? 'border-accent bg-accent/10'
                  : 'border-border-subtle bg-bg-elevated hover:bg-bg-overlay',
              )}
            >
              <div className="flex items-center gap-2">
                <Icon
                  size={14}
                  className={isActive ? 'text-accent' : 'text-fg-tertiary'}
                />
                <span
                  className={cn(
                    'text-sm font-medium',
                    isActive ? 'text-fg-primary' : 'text-fg-secondary',
                  )}
                >
                  {opt.title}
                </span>
              </div>
              <span className="text-xs text-fg-tertiary">{opt.description}</span>
            </button>
          );
        })}
      </div>

      {/* Combobox под radio (если требуется) */}
      {scope === 'department' ? (
        <div className="flex flex-col gap-1.5">
          <Label>Отдел</Label>
          <Combobox
            ariaLabel="Выбрать отдел"
            items={departments.map((d) => ({ id: d.id, label: d.name }))}
            isLoading={departmentsLoading}
            selectedId={refId}
            onSelect={onRefIdChange}
            placeholder="Выберите отдел"
            searchPlaceholder="Поиск отдела…"
            emptyText="Отделы не найдены"
            onInlineCreate={onCreateDepartment}
            inlineCreateBusy={inlineBusy}
            inlineCreateError={inlineError}
          />
        </div>
      ) : null}

      {scope === 'customer' ? (
        <div className="flex flex-col gap-1.5">
          <Label>Клиент</Label>
          <Combobox
            ariaLabel="Выбрать клиента"
            items={cards.map((c) => ({ id: c.id, label: c.name }))}
            isLoading={cardsLoading}
            selectedId={refId}
            onSelect={onRefIdChange}
            placeholder="Выберите клиента"
            searchPlaceholder="Поиск клиента…"
            emptyText="Клиенты не найдены"
            onInlineCreate={onCreateCustomer}
            inlineCreateBusy={inlineBusy}
            inlineCreateError={inlineError}
          />
        </div>
      ) : null}

      {scope === 'vendor' ? (
        <div className="flex flex-col gap-1.5">
          <Label>Поставщик</Label>
          <Combobox
            ariaLabel="Выбрать поставщика"
            items={vendors.map((v) => ({
              id: v.id,
              label: v.name,
              hint: v.inn ?? undefined,
            }))}
            isLoading={vendorsLoading}
            selectedId={refId}
            onSelect={onRefIdChange}
            placeholder="Выберите поставщика"
            searchPlaceholder="Поиск поставщика…"
            emptyText="Поставщики не найдены"
            onInlineCreate={onCreateVendor}
            inlineCreateBusy={inlineBusy}
            inlineCreateError={inlineError}
          />
        </div>
      ) : null}

      {scope === 'person' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Должность</Label>
            <Combobox
              ariaLabel="Выбрать должность"
              items={roles.map((r) => ({
                id: r.id,
                label: r.name,
                hint: r.departmentName ?? undefined,
              }))}
              isLoading={rolesLoading}
              selectedId={roleId}
              onSelect={(id) => onRoleIdChange(id)}
              placeholder="Сначала выберите должность"
              searchPlaceholder="Поиск должности…"
              emptyText="Должности не найдены"
            />
          </div>
          {roleId ? (
            <div className="flex flex-col gap-1.5">
              <Label>Сотрудник</Label>
              <Combobox
                ariaLabel="Выбрать сотрудника"
                items={persons.map((p) => ({
                  id: p.id,
                  label: p.fullName,
                  hint: p.email ?? undefined,
                }))}
                isLoading={personsLoading}
                selectedId={refId}
                onSelect={onRefIdChange}
                placeholder="Выберите сотрудника"
                searchPlaceholder="Поиск сотрудника…"
                emptyText="Сотрудники не найдены"
                onInlineCreate={onCreatePerson}
                inlineCreateBusy={inlineBusy}
                inlineCreateError={inlineError}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {scope === 'project' ? (
        <div className="flex flex-col gap-1.5">
          <Label>Проект</Label>
          <Combobox
            ariaLabel="Выбрать проект"
            items={projects.map((p) => ({
              id: p.id,
              label: p.name,
              hint: p.identifier,
            }))}
            isLoading={projectsLoading}
            selectedId={existingProjectId}
            onSelect={onExistingProjectIdChange}
            placeholder="Выберите проект"
            searchPlaceholder="Поиск проекта…"
            emptyText="Проекты не найдены"
          />
        </div>
      ) : null}

      {scope === 'org' ? (
        <p className="text-xs text-fg-tertiary">
          Будет создан общий спринт компании. Привязка к конкретной сущности не
          требуется.
        </p>
      ) : null}
    </div>
  );
}

// ─── Шаг 2 (parameters) ─────────────────────────────────────────────────────

interface ParametersStepProps {
  name: string;
  onNameChange: (v: string) => void;
  durationDays: number;
  onDurationChange: (v: number) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
}

function ParametersStep(props: ParametersStepProps) {
  const {
    name,
    onNameChange,
    durationDays,
    onDurationChange,
    startDate,
    onStartDateChange,
  } = props;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sprint-name">Название спринта</Label>
        <Input
          id="sprint-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Например: Спринт 12 — релиз 4.2"
          maxLength={120}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Длительность</Label>
        <div className="flex flex-wrap gap-2">
          {DURATION_OPTIONS.map((opt) => {
            const isActive = durationDays === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onDurationChange(opt.value)}
                aria-pressed={isActive}
                className={cn(
                  'inline-flex items-center rounded-md border px-3 py-1.5 text-xs transition-colors',
                  isActive
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border-subtle bg-bg-elevated text-fg-secondary hover:bg-bg-overlay',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sprint-start">Дата начала</Label>
        <Input
          id="sprint-start"
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
        />
      </div>
    </div>
  );
}
