'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '@/api/api-error';
import { meetingsApi, type JoinMeetingApiResponse } from '@/api/meetings.api';
import { toast } from 'sonner';
import { Button } from '@/ui/components/shared/Button';
import { t } from '@/lib/i18n';
import {
  getNoiseSuppressionEnabled,
  setNoiseSuppressionEnabled,
} from '@/lib/livekit/noise-suppression';

type Props = {
  meetingId: string;
  /** Если organizer ещё не запустил встречу, форму всё равно показываем —
   * по сабмиту backend вернёт ошибку, которую покажем тостом. */
  onJoined: (data: JoinMeetingApiResponse) => void;
};

export function GuestNameForm({ meetingId, onJoined }: Props) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [noiseEnabled, setNoiseEnabled] = useState(true);
  // Гидратируем чекбокс из localStorage только на клиенте — чтобы SSR-разметка
  // совпадала с серверной (избегаем hydration mismatch).
  useEffect(() => {
    setNoiseEnabled(getNoiseSuppressionEnabled());
  }, []);

  const onNoiseChange = (next: boolean) => {
    setNoiseEnabled(next);
    setNoiseSuppressionEnabled(next);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Введите имя.');
      return;
    }
    setPending(true);
    try {
      const result = await meetingsApi.join(meetingId, { guest_name: trimmed });
      onJoined(result);
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('errors.join_failed');
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border-subtle bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-fg-primary">
        {t('lobby.name_label')}
      </h2>
      <input
        type="text"
        name="guest_name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('lobby.name_placeholder')}
        maxLength={80}
        autoFocus
        required
        className="w-full rounded-md border border-border px-3 py-2 text-base focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={noiseEnabled}
          onChange={(e) => onNoiseChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border text-accent focus:ring-accent"
        />
        <span className="flex flex-col">
          <span className="font-medium text-fg-primary">
            {t('lobby.noise_suppression_label')}
          </span>
          <span className="text-xs text-fg-secondary">
            {t('lobby.noise_suppression_hint')}
          </span>
        </span>
      </label>
      <Button type="submit" loading={pending} disabled={pending}>
        {pending ? t('lobby.joining') : t('lobby.join')}
      </Button>
    </form>
  );
}
