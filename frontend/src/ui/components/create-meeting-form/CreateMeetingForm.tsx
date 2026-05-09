'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { meetingsApi } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/components/shared/Button';
import { MEETING_TYPES, type MeetingType } from '@/domain/enums';
import { t } from '@/lib/i18n';

import { MeetingTypeCard } from './MeetingTypeCard';

const DEFAULT_TYPE: MeetingType = 'team';

export function CreateMeetingForm() {
  const router = useRouter();
  const { addToast } = useToast();
  const [type, setType] = useState<MeetingType>(DEFAULT_TYPE);
  const [title, setTitle] = useState('');
  const [customPromptOpen, setCustomPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      addToast({ type: 'error', message: 'Введите название встречи.' });
      return;
    }
    setPending(true);
    try {
      const result = await meetingsApi.create({
        type,
        title: trimmedTitle,
        custom_prompt: customPrompt.trim() ? customPrompt.trim() : null,
      });
      router.push(`/m/${result.id}`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('errors.unknown');
      addToast({ type: 'error', message });
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 className="text-2xl font-semibold text-slate-900">
        {t('meetings.create')}
      </h1>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">
          {t('meetings.type_label')}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MEETING_TYPES.map((tt) => (
            <MeetingTypeCard
              key={tt}
              type={tt}
              selected={tt === type}
              onSelect={() => setType(tt)}
            />
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="meeting-title"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          {t('meetings.title_label')}
        </label>
        <input
          id="meeting-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('meetings.title_placeholder')}
          maxLength={200}
          required
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setCustomPromptOpen((v) => !v)}
          className="text-sm font-medium text-blue-700 hover:text-blue-800"
          aria-expanded={customPromptOpen}
        >
          {customPromptOpen ? '▾' : '▸'} {t('meetings.custom_prompt_label')}
        </button>
        {customPromptOpen ? (
          <div className="mt-2">
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={6}
              maxLength={10000}
              placeholder={t('meetings.custom_prompt_help')}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t('meetings.custom_prompt_help')}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? t('meetings.creating') : t('meetings.submit')}
        </Button>
      </div>
    </form>
  );
}
