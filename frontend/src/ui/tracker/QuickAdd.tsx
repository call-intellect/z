'use client';

/**
 * QuickAdd — inline-форма «+ Задача» внизу колонки канбана.
 * Одно поле (title), Enter создаёт задачу, Esc сворачивает форму.
 */

import { useState, useRef, useEffect } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';

export function QuickAdd({
  onSubmit,
  placeholder = 'Что нужно сделать?',
  buttonLabel = 'Задача',
}: {
  onSubmit: (title: string) => Promise<void>;
  placeholder?: string;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSubmit = async () => {
    const title = value.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(title);
      setValue('');
      // Оставляем форму открытой для быстрого ввода следующей.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать задачу');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-fg-tertiary"
        onClick={() => setOpen(true)}
        data-tour-target="project.quick-add"
      >
        <Plus size={14} />
        {buttonLabel}
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated p-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleSubmit();
          } else if (e.key === 'Escape') {
            setOpen(false);
            setValue('');
            setError(null);
          }
        }}
        placeholder={placeholder}
        disabled={submitting}
        className="w-full bg-transparent text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none"
      />
      {error && (
        <div className="mt-1 text-[11px] text-danger">{error}</div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-tertiary">
          Enter — создать · Esc — отмена
        </span>
        {submitting && <Loader2 size={14} className="animate-spin text-fg-tertiary" />}
      </div>
    </div>
  );
}
