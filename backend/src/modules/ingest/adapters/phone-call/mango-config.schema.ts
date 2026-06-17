import { z } from 'zod';

export const MangoCallConfigSchema = z.object({
  subtype: z.literal('mango'),
  apiKey: z.string().min(20),
  apiSalt: z.string().min(20),
  extensions: z.array(z.string()).default([]),
});

export type MangoCallConfig = z.infer<typeof MangoCallConfigSchema>;

export function parseMangoConfig(config: unknown): MangoCallConfig {
  const r = MangoCallConfigSchema.safeParse(config);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Невалидный mango-config: ${issues}`);
  }
  return r.data;
}
