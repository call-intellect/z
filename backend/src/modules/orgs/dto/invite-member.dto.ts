import { z } from 'zod';

/**
 * Создание приглашения в Org.
 *
 * β-9 (2026-05-25): электронная почта стала опциональной. Линейный персонал
 * (продавцы, повара, мастера) может работать только через Telegram — для
 * них директор копирует ссылку приглашения и пересылает руками.
 * Подробности — `plans/tz/2026-05-25-telegram-bot-global-and-invites.md` §3
 * принцип 4 и `second-brain/01_projects/conversational-channels.md`
 * §«Продуктовые принципы каналов» принцип 3.
 *
 * `name` — имя сотрудника для шаблона письма и Person. Если email есть —
 * нужен; если email нет — тоже нужен (показывается в UI директора).
 */
export const InviteMemberSchema = z.object({
  /** Электронная почта. Опционально с β-9 — см. JSDoc выше. */
  email: z
    .string()
    .email('Невалидный адрес электронной почты')
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Имя сотрудника (для шаблона письма и карточки). */
  name: z.string().trim().min(1, 'Имя обязательно').max(120).optional(),
  role: z.enum(['admin', 'manager']).default('manager'),
});

export type InviteMemberDto = z.infer<typeof InviteMemberSchema>;
