/**
 * Domain-модель рабочего профиля (ТЗ assistant-calendar-master Ф8).
 *
 * Маппит `WorkProfileApi` (ApiDto) 1:1 в DomainModel — слоистость
 * ApiDto→DomainModel→UiModel соблюдается даже для плоского контракта,
 * чтобы UI не зависел напрямую от формы ответа сети.
 */

import type { WorkProfileApi } from '@/api/work-profile.api';

export interface WorkProfileDomain {
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  /** Дни недели, когда человек работает: 0=вс..6=сб. */
  workingDays: number[];
  /** Таймзона задана пользователем (false = дефолт компании). */
  timezoneIsCustom: boolean;
  /** Рабочие часы заданы пользователем (false = дефолт компании). */
  hoursAreCustom: boolean;
}

export function mapWorkProfileDtoToDomain(api: WorkProfileApi): WorkProfileDomain {
  return {
    timezone: api.timezone,
    workStartHour: api.workStartHour,
    workEndHour: api.workEndHour,
    workingDays: api.workingDays,
    timezoneIsCustom: api.timezoneIsCustom,
    hoursAreCustom: api.hoursAreCustom,
  };
}
