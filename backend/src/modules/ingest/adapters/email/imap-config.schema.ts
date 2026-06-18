import { z } from 'zod';

export const ImapMailboxConfigSchema = z.object({
  subtype: z.literal('imap'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  user: z.string().min(1),
  passwordEnc: z.string().min(1),
  folder: z.string().min(1).default('INBOX'),
  sinceDate: z.string().datetime().optional(),
  sensitiveFolders: z.array(z.string()).default([]),
});

export type ImapMailboxConfig = z.infer<typeof ImapMailboxConfigSchema>;

export function parseImapConfig(config: unknown): ImapMailboxConfig {
  const r = ImapMailboxConfigSchema.safeParse(config);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Невалидный imap-config: ${issues}`);
  }
  return r.data;
}
