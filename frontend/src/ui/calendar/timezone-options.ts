/**
 * Единый список часовых поясов (IANA) для UI календаря и рабочего профиля.
 *
 * Вынесен из `EventForm.tsx` (ТЗ assistant-calendar-master Ф8), чтобы и форма
 * события, и настройки рабочего времени использовали один список без дублей.
 * Покрывает российские пояса (UTC+2…+12) плюс Алматы. Упорядочено по смещению.
 */
export const TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  [
    { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
    { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
    { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
    { value: 'Asia/Almaty', label: 'Алматы (UTC+5)' },
    { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
    { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
    { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
    { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
    { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
    { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
    { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
    { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
  ];

/** Дефолтная таймзона (совпадает с резолвом бэка Person→Org→Moscow). */
export const DEFAULT_TIMEZONE = 'Europe/Moscow';
