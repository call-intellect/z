export const JSON_MODE_USER_SUFFIX = '\n\nОтвет верни строго в формате JSON.';

export function hasJsonWord(...texts: Array<string | undefined | null>): boolean {
  return texts.some((t) => typeof t === 'string' && /json/i.test(t));
}

export function appendJsonWordToUser(systemText: string, userText: string): string {
  if (hasJsonWord(systemText, userText)) return userText;
  return `${userText}${JSON_MODE_USER_SUFFIX}`;
}

export function ensureJsonWordInUser(messages: Array<{ role: string; content: string }>): void {
  if (messages.some((m) => /json/i.test(m.content))) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      m.content += JSON_MODE_USER_SUFFIX;
      return;
    }
  }
}
