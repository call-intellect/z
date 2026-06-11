'use client';

/**
 * Контрол «Кому видно» для встречи (ТЗ Ф4 «Кому видно»).
 *
 * Слои: ApiDto (`meetingsApi.getVisibility`) → DomainModel
 * (`meetingVisibilityFromApi`) → UiModel (русские лейблы `VISIBILITY_SCOPE_OPTIONS`).
 *
 * 4 пресета: «Только мне» / «Участникам» (дефолт) / «Выбрать людей и группы» /
 * «Всей компании». При выборе «Выбрать людей и группы» раскрывается:
 *   - пикер людей (поиск по имени/почте через ParticipantPicker → personId);
 *   - список групп доступа компании (чекбоксы) из knowledge-access.
 *
 * Доступ host-only: backend отдаёт 403 не-хосту на GET/PATCH. При 403 на
 * загрузке — компонент показывает read-only текущий режим без редактирования.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Users } from 'lucide-react';

import { meetingsApi } from '@/api/meetings.api';
import { knowledgeAccessApi } from '@/api/knowledge-access.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  meetingVisibilityFromApi,
  normalizeVisibilityScope,
  visibilityScopeLabel,
  VISIBILITY_SCOPE_OPTIONS,
  type GranteeType,
  type VisibilityScope,
} from '@/domain/meeting';
import {
  toKnowledgeGroup,
  type KnowledgeGroupDomain,
} from '@/domain/knowledge-access';

import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Label } from '@/ui/shadcn/label';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { toast } from '@/ui/shadcn/toast';
import { cn } from '@/ui/shadcn/lib/utils';
import {
  ParticipantPicker,
  type ParticipantPickerValue,
} from '@/ui/shared/ParticipantPicker';

export type VisibilityControlProps = {
  meetingId: string;
  /**
   * Может ли текущий пользователь управлять видимостью (host). Если явно
   * `false` — рендерим только read-only режим, не дёргая host-only эндпоинт.
   * Если не передан — пробуем загрузить; при 403 переключаемся в read-only.
   */
  canManage?: boolean;
  /** Колбэк после успешного сохранения (например, для mutate карточки встречи). */
  onSaved?: (scope: VisibilityScope) => void;
};

/** Выбранный человек для custom-режима → грант `{granteeType:'person', granteeId}`. */
type SelectedGroup = { id: string; name: string };

export function VisibilityControl({
  meetingId,
  canManage,
  onSaved,
}: VisibilityControlProps) {
  const [loading, setLoading] = useState(true);
  const [readOnly, setReadOnly] = useState(canManage === false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scope, setScope] = useState<VisibilityScope>('participants');
  // Люди для custom-режима — переиспользуем ParticipantPicker (поиск + чипы).
  const [people, setPeople] = useState<ParticipantPickerValue[]>([]);
  // Выбранные группы доступа (id).
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  );

  const [groups, setGroups] = useState<KnowledgeGroupDomain[]>([]);
  const [saving, setSaving] = useState(false);

  // ─── Загрузка текущей видимости ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const dto = await meetingsApi.getVisibility(meetingId);
        if (cancelled) return;
        const domain = meetingVisibilityFromApi(dto);
        setScope(domain.scope);
        setPeople(
          domain.grants
            .filter((g) => g.granteeType === 'person')
            .map((g) => ({
              type: 'person' as const,
              personId: g.granteeId,
              name: g.name,
            })),
        );
        setSelectedGroupIds(
          new Set(
            domain.grants
              .filter((g) => g.granteeType === 'group')
              .map((g) => g.granteeId),
          ),
        );
        setReadOnly(false);
      } catch (e) {
        if (cancelled) return;
        // 403 = не-хост: показываем read-only текущий режим.
        if (e instanceof ApiError && e.code === 'http_403') {
          setReadOnly(true);
        } else {
          setLoadError(humanizeApiError(e, 'Не удалось загрузить доступ.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // ─── Загрузка групп доступа (только когда нужен custom и можем редактировать) ─
  useEffect(() => {
    if (readOnly || scope !== 'custom' || groups.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await knowledgeAccessApi.listGroups();
        if (!cancelled) setGroups(res.items.map(toKnowledgeGroup));
      } catch {
        // Группы недоступны — пикер групп просто не покажется, люди остаются.
        if (!cancelled) setGroups([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readOnly, scope, groups.length]);

  // ─── Сбор грантов для отправки ────────────────────────────────────────────
  const selectedGroups: SelectedGroup[] = useMemo(
    () =>
      groups
        .filter((g) => selectedGroupIds.has(g.id))
        .map((g) => ({ id: g.id, name: g.name })),
    [groups, selectedGroupIds],
  );

  const grants = useMemo(
    () => [
      ...people
        .filter((p) => p.type === 'person')
        .map((p) => ({
          granteeType: 'person' as GranteeType,
          granteeId: p.type === 'person' ? p.personId : '',
        })),
      ...Array.from(selectedGroupIds).map((id) => ({
        granteeType: 'group' as GranteeType,
        granteeId: id,
      })),
    ],
    [people, selectedGroupIds],
  );

  const customEmpty = scope === 'custom' && grants.length === 0;

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSave = async () => {
    if (customEmpty) return;
    setSaving(true);
    try {
      await meetingsApi.setVisibility(meetingId, {
        scope,
        ...(scope === 'custom' ? { grants } : {}),
      });
      toast.success('Доступ к встрече сохранён');
      onSaved?.(scope);
    } catch (e) {
      toast.error(humanizeApiError(e, 'Не удалось сохранить доступ.'));
    } finally {
      setSaving(false);
    }
  };

  // ─── Состояния загрузки / ошибки / read-only ──────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg px-3 py-2.5 text-sm text-chip-danger-fg">
        {loadError}
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2.5 text-sm text-fg-secondary">
        <Lock size={14} className="shrink-0 text-fg-tertiary" />
        <span>
          Кому видно:{' '}
          <span className="font-medium text-fg-primary">
            {visibilityScopeLabel(scope)}
          </span>
        </span>
      </div>
    );
  }

  // ─── Редактор (host) ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Кому видно</legend>
        {VISIBILITY_SCOPE_OPTIONS.map((opt) => (
          <PresetRow
            key={opt.value}
            label={opt.label}
            hint={opt.hint}
            checked={scope === opt.value}
            onSelect={() => setScope(opt.value)}
          />
        ))}
      </fieldset>

      {scope === 'custom' && (
        <div className="flex flex-col gap-4 rounded-md border border-border-subtle bg-bg-overlay p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visibility-people">Люди</Label>
            <ParticipantPicker
              value={people}
              onChange={setPeople}
              placeholder="Найти человека по имени или почте"
            />
            <p className="text-xs text-fg-tertiary">
              Доступ получат выбранные люди.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-1.5">
              <Users size={13} className="text-fg-tertiary" />
              Группы доступа
            </Label>
            {groups.length === 0 ? (
              <p className="text-xs text-fg-tertiary">
                Групп доступа в компании пока нет.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-2.5 rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedGroupIds.has(g.id)}
                      onCheckedChange={() => toggleGroup(g.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-fg-primary">
                        {g.name}
                      </span>
                      <span className="ml-2 text-xs text-fg-tertiary">
                        {g.kindLabel}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {customEmpty && (
            <p className="text-xs text-chip-warning-fg">
              Выберите хотя бы одного человека или группу.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || customEmpty}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Сохранить
        </Button>
      </div>
    </div>
  );
}

/** Один пресет-радиокнопка с подписью и пояснением. */
function PresetRow({
  label,
  hint,
  checked,
  onSelect,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
        checked
          ? 'border-accent-border bg-accent-muted'
          : 'border-border-subtle bg-bg-overlay hover:border-accent-border',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
          checked ? 'border-accent' : 'border-border',
        )}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-medium',
            checked ? 'text-accent' : 'text-fg-primary',
          )}
        >
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-fg-tertiary">{hint}</span>
      </span>
    </button>
  );
}
