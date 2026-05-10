import { z } from 'zod';

/**
 * Zod-схема `Source.config` для адаптера Email IMAP (`Source.type='email'`,
 * subtype='imap').
 *
 * `passwordEnc` шифруется `CryptoService` (формат `gcm:v1:...`); схема
 * допускает и plain (на dev / при первом онбординге) — `EmailFetchService`
 * расшифровывает только если `isEncrypted(value) === true`.
 *
 * `sensitiveFolders` — папки, письма из которых получают `dataClass='sensitive'`
 * вне зависимости от `Source.dataClass` (см. `EmailFetchService.fetchOne`).
 */
export const ImapMailboxConfigSchema = z.object({
  subtype: z.literal('imap'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  user: z.string().min(1),
  passwordEnc: z.string().min(1),
  folder: z.string().min(1).default('INBOX'),
  /** ISO-строка: с какой даты подтягивать при первом запуске. Дальше — lastFetchAt. */
  sinceDate: z.string().datetime().optional(),
  sensitiveFolders: z.array(z.string()).default([]),
});

export type ImapMailboxConfig = z.infer<typeof ImapMailboxConfigSchema>;

export function parseImapConfig(config: unknown): ImapMailboxConfig {
  const r = ImapMailboxConfigSchema.safeParse(config);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Невалидный imap-config: ${issues}`);
  }
  return r.data;
}
