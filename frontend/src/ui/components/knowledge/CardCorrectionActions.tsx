'use client';

import { useState } from 'react';
import { Flag, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';

import {
  correctConfirmLabel,
  correctSuccessMessage,
  pickChangedFields,
} from './card-correction.helpers';

/** Одно редактируемое поле карточки в форме «Исправить». */
export type CorrectionField = {
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
};

export type CardCorrectionActionsProps = {
  /** Поля для формы «Исправить», предзаполнены текущими значениями. */
  fields: CorrectionField[];
  /** owner/admin → подпись «Сохранить как проверенную версию»; иначе «Предложить правку». */
  canApplyDirectly: boolean;
  /** Текущая метка доверия — для подсказки в диалоге (опц.). */
  trustTier?: 'auto' | 'provisional' | 'human';
  /** Применить правку. Возвращает applied (true=применено сразу, false=ушло предложением). */
  onCorrect: (
    values: Record<string, string>,
    reason: string | undefined,
  ) => Promise<{ applied: boolean }>;
  /** Оспорить («это неверно»). */
  onDispute: (reason: string | undefined) => Promise<void>;
  /** Перезагрузка карточки/списка после успеха. */
  onDone?: () => void;
};

/**
 * CardCorrectionActions — две кнопки + два диалога (Фаза E2, лестница доверия).
 *
 * Общий для карточек регуляций и решений компонент:
 *   - «Исправить» — форма с предзаполненными полями; owner/admin применяют
 *     сразу (карточка становится человеко-проверенной), остальные шлют правку
 *     куратору.
 *   - «Это неверно» — оспаривание с опц. причиной (всегда уходит куратору).
 *
 * Сетевые ошибки ловятся как ApiError → toast.error + throw, чтобы
 * ConfirmDialog не закрывался (см. RegulationsListClient.handleSupersede).
 */
export function CardCorrectionActions({
  fields,
  canApplyDirectly,
  trustTier,
  onCorrect,
  onDispute,
  onDone,
}: CardCorrectionActionsProps) {
  const [correctOpen, setCorrectOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);

  // Значения формы «Исправить» — инициализируются из fields при открытии.
  const [values, setValues] = useState<Record<string, string>>({});
  const [correctReason, setCorrectReason] = useState('');
  const [disputeReason, setDisputeReason] = useState('');

  function openCorrect() {
    const initial: Record<string, string> = {};
    for (const f of fields) initial[f.key] = f.value;
    setValues(initial);
    setCorrectReason('');
    setCorrectOpen(true);
  }

  function openDispute() {
    setDisputeReason('');
    setDisputeOpen(true);
  }

  async function handleCorrect() {
    const changed = pickChangedFields(fields, values);
    if (Object.keys(changed).length === 0) {
      // Ничего не изменено — оставляем диалог открытым.
      toast.error('Вы ничего не изменили');
      throw new Error('no-changes');
    }
    const reason = correctReason.trim() ? correctReason.trim() : undefined;
    try {
      const { applied } = await onCorrect(changed, reason);
      toast.success(correctSuccessMessage(applied));
      onDone?.();
    } catch (e) {
      if (e instanceof Error && e.message === 'no-changes') throw e;
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось сохранить правку',
      );
      throw e;
    }
  }

  async function handleDispute() {
    const reason = disputeReason.trim() ? disputeReason.trim() : undefined;
    try {
      await onDispute(reason);
      toast.success('Спасибо! Карточку отправили куратору на разбор');
      onDone?.();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось отправить карточку',
      );
      throw e;
    }
  }

  const trustHint =
    trustTier && trustTier !== 'human'
      ? 'Сейчас эта карточка ещё не проверена человеком.'
      : null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openCorrect}>
        <Pencil className="mr-1.5 h-4 w-4" />
        Исправить
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={openDispute}
      >
        <Flag className="mr-1.5 h-4 w-4" />
        Это неверно
      </Button>

      <ConfirmDialog
        open={correctOpen}
        onOpenChange={setCorrectOpen}
        title="Исправить карточку"
        description={
          <div className="space-y-3">
            {canApplyDirectly ? (
              <p className="text-sm text-fg-secondary">
                Ваша правка применится сразу, и карточка станет проверенной
                человеком.
              </p>
            ) : (
              <p className="text-sm text-fg-secondary">
                Ваша правка уйдёт куратору на проверку.
              </p>
            )}
            {trustHint ? (
              <p className="text-xs text-fg-tertiary">{trustHint}</p>
            ) : null}
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label
                  htmlFor={`correct-${f.key}`}
                  className="block text-xs font-medium text-fg-secondary"
                >
                  {f.label}
                </label>
                {f.multiline ? (
                  <Textarea
                    id={`correct-${f.key}`}
                    value={values[f.key] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                ) : (
                  <Input
                    id={`correct-${f.key}`}
                    value={values[f.key] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
            <div className="space-y-1">
              <label
                htmlFor="correct-reason"
                className="block text-xs font-medium text-fg-secondary"
              >
                В чём была ошибка (необязательно)
              </label>
              <Textarea
                id="correct-reason"
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
                placeholder="Например: устаревший срок, неверная формулировка"
              />
            </div>
          </div>
        }
        confirmLabel={correctConfirmLabel(canApplyDirectly)}
        cancelLabel="Отмена"
        onConfirm={handleCorrect}
      />

      <ConfirmDialog
        open={disputeOpen}
        onOpenChange={setDisputeOpen}
        title="Отметить карточку как неверную"
        description={
          <div className="space-y-3">
            <p className="text-sm text-fg-secondary">
              Карточку отправят куратору на разбор. Можно коротко пояснить, что
              именно не так.
            </p>
            <div className="space-y-1">
              <label
                htmlFor="dispute-reason"
                className="block text-xs font-medium text-fg-secondary"
              >
                Почему вы считаете это неверным (необязательно)
              </label>
              <Textarea
                id="dispute-reason"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Например: такого решения не принимали"
              />
            </div>
          </div>
        }
        confirmLabel="Отметить как неверную"
        cancelLabel="Отмена"
        destructive
        onConfirm={handleDispute}
      />
    </>
  );
}
