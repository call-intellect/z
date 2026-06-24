export function formatEpisodeDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function buildMeetingSourceTitle(args: {
  title?: string | null;
  occurredAt: Date;
}): string {
  const title = (args.title ?? '').trim();
  const date = formatEpisodeDate(args.occurredAt);
  return title.length > 0 ? `Встреча: ${title}, ${date}` : `Встреча от ${date}`;
}

export function buildReportSourceTitle(args: {
  title?: string | null;
  occurredAt: Date;
}): string {
  const title = (args.title ?? '').trim();
  const date = formatEpisodeDate(args.occurredAt);
  return title.length > 0 ? `Отчёт встречи: ${title}, ${date}` : `Отчёт встречи от ${date}`;
}
