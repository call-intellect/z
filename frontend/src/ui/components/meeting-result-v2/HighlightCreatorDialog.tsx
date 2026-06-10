'use client';

/**
 * Диалог создания клипа из встречи. Принимает таймкоды в виде mm:ss
 * (или hh:mm:ss). После создания делает mutate списка highlights.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { highlightsApi } from '@/api/highlights.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { toast } from '@/ui/shadcn/toast';

import { fmtTime, parseTimeInput } from './format-utils';

export type HighlightCreatorDialogProps = {
  meetingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /** Если задан — будет преподставлен как стартовая позиция клипа. */
  initialStartMs?: number | null;
  /** Длительность всей записи — чтобы валидировать таймкоды. */
  durationMs: number | null;
};

export function HighlightCreatorDialog({
  meetingId,
  open,
  onOpenChange,
  onCreated,
  initialStartMs,
  durationMs,
}: HighlightCreatorDialogProps) {
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState(
    typeof initialStartMs === 'number' ? fmtTime(initialStartMs) : '0:00',
  );
  const [to, setTo] = useState(
    typeof initialStartMs === 'number' ? fmtTime(initialStartMs + 30_000) : '0:30',
  );
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const startMs = parseTimeInput(from);
    const endMs = parseTimeInput(to);
    if (startMs === null || endMs === null) {
      toast.error('Введите таймкоды в формате mm:ss');
      return;
    }
    if (endMs <= startMs) {
      toast.error('Конец клипа должен быть позже начала');
      return;
    }
    if (durationMs && endMs > durationMs) {
      toast.error('Конец клипа выходит за длительность записи');
      return;
    }
    if (!title.trim()) {
      toast.error('Введите название клипа');
      return;
    }
    setSubmitting(true);
    try {
      await highlightsApi.create(meetingId, {
        startMs,
        endMs,
        title: title.trim(),
      });
      toast.success('Клип создан');
      onCreated?.();
      onOpenChange(false);
      setTitle('');
    } catch (e) {
      const message = humanizeApiError(e, 'Не удалось создать клип.');
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Создать клип</DialogTitle>
          <DialogDescription>
            Выделите фрагмент записи, чтобы сохранить или поделиться им отдельно.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hl-title">Название</Label>
            <Input
              id="hl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Бюджет 500к, например"
              maxLength={120}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hl-from">От (mm:ss)</Label>
              <Input
                id="hl-from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="font-mono"
                placeholder="0:00"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hl-to">До (mm:ss)</Label>
              <Input
                id="hl-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="font-mono"
                placeholder="0:30"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" size={14} />}
              Сохранить клип
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
