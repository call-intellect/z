/**
 * Попытаться распарсить JSON: чистый объект, обёрнутый в ```json ... ```
 * или первый встретившийся объект внутри текста. На неуспех — вернуть
 * `{ raw: text }`, чтобы хотя бы что-то записалось в `output`.
 */
export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const stripped = stripCodeFence(trimmed);
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
  }
  return { raw: text };
}

function stripCodeFence(text: string): string {
  if (!text.startsWith('```')) return text;
  const lines = text.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n');
}
