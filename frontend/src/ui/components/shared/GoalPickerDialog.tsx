'use client';

/**
 * GoalPickerDialog — общий диалог выбора цели Org (Goals OKR v2, Фаза 5 «мост к
 * гипотезам»). Переиспользуется в карточке идеи («двигает цель…») и на дашборде
 * спринта («продвигает цель…»).
 *
 * Слой UI: знает только про выбор. Сам запрос на привязку + toast + refresh —
 * на стороне вызывающего компонента (`onPick`).
 *
 * Паттерн повторяет `ReparentGoalDialog` (goals/[id]/GoalDetailClient.tsx):
 * ленивая загрузка активных целей через SWR + Select с sentinel «без цели».
 */

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { goalsApi } from '@/api/goals.api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Button } from '@/ui/shadcn/button';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

/** Sentinel-значение Select для «без цели» (Radix не допускает value=""). */
const NO_GOAL = '__none__';

export function GoalPickerDialog({
  open,
  onOpenChange,
  orgId,
  currentGoalId,
  onPick,
  title = 'Привязать к цели',
  description = 'Выберите цель компании, которую двигает этот элемент.',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  currentGoalId: string | null;
  /** Возвращает выбранную цель (или null — отвязать). Делает запрос + refresh. */
  onPick: (goalId: string | null) => Promise<void> | void;
  title?: string;
  description?: string;
}) {
  const [goalId, setGoalId] = useState<string>(NO_GOAL);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setGoalId(currentGoalId ?? NO_GOAL);
  }, [open, currentGoalId]);

  const { data: goals, isLoading } = useSWR(
    open ? (['goals-for-picker', orgId] as const) : null,
    async ([, oid]) => {
      const res = await goalsApi.list(oid, { status: 'active', limit: 200 });
      return res.items;
    },
  );

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const next = goalId === NO_GOAL ? null : goalId;
      await onPick(next);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {isLoading ? (
            <p className="text-sm text-fg-tertiary">Загрузка целей…</p>
          ) : (
            <div>
              <Label>Цель компании</Label>
              <Select value={goalId} onValueChange={setGoalId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GOAL}>— без цели —</SelectItem>
                  {(goals ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isLoading && (goals ?? []).length === 0 ? (
                <p className="mt-1 text-[11px] text-fg-tertiary">
                  Активных целей пока нет — создайте цель в разделе «Цели».
                </p>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={submitting || isLoading}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
