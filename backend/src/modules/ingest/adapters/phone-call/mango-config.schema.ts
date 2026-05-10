import { z } from 'zod';

/**
 * Zod-схема `Source.config` для адаптера Mango Office (`Source.type='phone_call'`,
 * subtype='mango').
 *
 * Mango аутентифицирует webhook'и через подпись: `sign = sha256(apiKey + json + apiSalt)`.
 * Обе строки — секретные, шифруются `CryptoService`.
 */
export const MangoCallConfigSchema = z.object({
  subtype: z.literal('mango'),
  /** API key Mango (учётка АТС). 20+ символов. */
  apiKey: z.string().min(20),
  /** API salt Mango (для подписи). 20+ символов. */
  apiSalt: z.string().min(20),
  /**
   * Список добавочных, которые мы принимаем (пусто = все). Используется,
   * если у Org несколько SIP-подключений и нужно фильтровать.
   */
  extensions: z.array(z.string()).default([]),
});

export type MangoCallConfig = z.infer<typeof MangoCallConfigSchema>;

export function parseMangoConfig(config: unknown): MangoCallConfig {
  const r = MangoCallConfigSchema.safeParse(config);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Невалидный mango-config: ${issues}`);
  }
  return r.data;
}
