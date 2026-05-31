'use client';

/**
 * RenameTopicDialog — диалог переименования смыслового блока обратной связи.
 *
 * Поля:
 *   - title (обязательное, ≤ 120 символов)
 *   - description (обязательное, ≤ 500 символов)
 *
 * Pre-fill из текущих значений блока. После успеха — toast + onSaved (родитель
 * выполняет SWR mutate).
 *
 * Фаза 8 ТЗ user-feedback-with-ai-clustering.
 */

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminFeedbackApi } from '@/api/admin-feedback.api';
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
import { Textarea } from '@/ui/shadcn/textarea';

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 500;

interface RenameTopicDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  topicId: string;
  initialTitle: string;
  initialDescription: string;
  onSaved: () => void;
}

export function RenameTopicDialog({
  open,
  onOpenChange,
  topicId,
  initialTitle,
  initialDescription,
  onSaved,
}: RenameTopicDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setDescription(initialDescription);
    setError(null);
  }, [open, initialTitle, initialDescription]);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const titleTooLong = title.length > TITLE_MAX;
  const descriptionTooLong = description.length > DESCRIPTION_MAX;
  const canSubmit =
    trimmedTitle.length > 0 &&
    trimmedDescription.length > 0 &&
    !titleTooLong &&
    !descriptionTooLong &&
    !saving;

  async function handleSave() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await adminFeedbackApi.renameTopic(topicId, {
        title: trimmedTitle,
        description: trimmedDescription,
      });
      toast.success('Готово');
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось переименовать блок';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Переименовать блок</DialogTitle>
          <DialogDescription>
            Изменения видны сразу в дашборде и на странице блока.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="rename-title">Название</Label>
            <Input
              id="rename-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX + 50}
              placeholder="Короткое название блока"
              disabled={saving}
            />
            <div className="flex items-center justify-between text-[11px] text-fg-tertiary">
              <span>Не более {TITLE_MAX} символов.</span>
              <span
                className={
                  titleTooLong ? 'text-danger' : 'text-fg-tertiary'
                }
              >
                {title.length}/{TITLE_MAX}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rename-description">Описание</Label>
            <Textarea
              id="rename-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX + 100}
              rows={5}
              placeholder="Что именно объединяет items этого блока"
              disabled={saving}
            />
            <div className="flex items-center justify-between text-[11px] text-fg-tertiary">
              <span>Не более {DESCRIPTION_MAX} символов.</span>
              <span
                className={
                  descriptionTooLong ? 'text-danger' : 'text-fg-tertiary'
                }
              >
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </div>
          </div>

          {error && (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
