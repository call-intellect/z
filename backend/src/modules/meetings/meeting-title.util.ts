const PLACEHOLDER_TITLES = new Set<string>([
  '.',
  'текст',
  'встреча',
  'команда',
  'новая встреча',
  'без названия',
]);

export function isPlaceholderMeetingTitle(title: string | null | undefined): boolean {
  if (title == null) return true;
  const trimmed = title.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 3) return true;
  return PLACEHOLDER_TITLES.has(trimmed.toLowerCase());
}
