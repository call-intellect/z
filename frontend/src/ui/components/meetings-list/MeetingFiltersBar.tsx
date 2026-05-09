'use client';

import { MEETING_STATUSES, MEETING_TYPES } from '@/domain/enums';
import type { MeetingStatus, MeetingType } from '@/domain/enums';
import { t } from '@/lib/i18n';

type Props = {
  status: MeetingStatus | null;
  type: MeetingType | null;
  onStatusChange: (status: MeetingStatus | null) => void;
  onTypeChange: (type: MeetingType | null) => void;
};

export function MeetingFiltersBar({
  status,
  type,
  onStatusChange,
  onTypeChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-700">{t('meetings.filter_status')}</span>
        <select
          value={status ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onStatusChange(v === '' ? null : (v as MeetingStatus));
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">{t('meetings.filter_all')}</option>
          {MEETING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`meeting_status.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-700">{t('meetings.filter_type')}</span>
        <select
          value={type ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onTypeChange(v === '' ? null : (v as MeetingType));
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">{t('meetings.filter_all')}</option>
          {MEETING_TYPES.map((tt) => (
            <option key={tt} value={tt}>
              {t(`meeting_types.${tt}.label`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
