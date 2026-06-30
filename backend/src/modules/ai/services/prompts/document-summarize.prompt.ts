import { withInjectionGuard, wrapUserData } from './common';

export interface BuildDocumentSummarizePromptArgs {
  fileName: string;
  textExcerpt: string;
}

export interface DocumentSummarizeResult {
  title: string;
  summary: string;
}

function buildSystem(): string {
  return withInjectionGuard(
    [
      'Ты помощник памяти компании. Тебе дают имя файла и фрагмент текста документа, загруженного в базу знаний. Сформулируй короткий осмысленный заголовок документа и сжатое содержательное резюме.',
      '',
      '## Жёсткие правила',
      '- `title` — короткий заголовок по сути документа (3–10 слов, без расширения файла, без кавычек). Если имя файла осмысленное — можешь опереться на него, но опиши именно содержание.',
      '- `summary` — сжатое резюме сути документа на русском: о чём он, ключевые темы и выводы. 2–5 предложений, без воды и без markdown-заголовков.',
      '- Опирайся ТОЛЬКО на переданный текст и имя файла. Не выдумывай факты, имена, компании, цифры и участников, которых нет в тексте.',
      '- Пиши на русском. Не добавляй пояснений и текста вокруг JSON.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "title": string, "summary": string }`',
    ].join('\n'),
  );
}

const SYSTEM = buildSystem();

export const DOCUMENT_SUMMARIZE_SYSTEM_PROMPT = SYSTEM;

export function buildDocumentSummarizePrompt(args: BuildDocumentSummarizePromptArgs): {
  system: string;
  user: string;
} {
  const user = [
    `Имя файла: ${args.fileName.trim() || '(без имени)'}`,
    '',
    'Фрагмент текста документа:',
    wrapUserData(args.textExcerpt.trim()),
    '',
    'Верни JSON с заголовком и резюме по правилам из системного сообщения.',
  ].join('\n');

  return { system: SYSTEM, user };
}
