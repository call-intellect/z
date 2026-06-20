const RU_MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export function formatRuDate(value: string | null | undefined): string {
  if (!value) return '';
  const raw = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      return `${day} ${RU_MONTHS_GENITIVE[month]}`;
    }
    return raw;
  }
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);
  if (dateTime) {
    const month = Number(dateTime[2]) - 1;
    const day = Number(dateTime[3]);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      return `${day} ${RU_MONTHS_GENITIVE[month]}, ${dateTime[4]}:${dateTime[5]}`;
    }
  }
  return raw;
}
