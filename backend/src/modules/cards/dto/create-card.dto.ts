import { z } from 'zod';

import {
  CARD_CONTACT_FIELD_MAX,
  CARD_DESCRIPTION_MAX,
  CARD_HEX_COLOR_REGEX,
  CARD_NAME_MAX,
  CardKindSchema,
} from './card-kind';

/**
 * `POST /api/v1/cards`. Все поля кроме `name` опциональны.
 * Email/phone валидируются мягко — только длина и тип; глубокую валидацию
 * (например, RFC-compliant email) НЕ делаем — пользователь сам ведёт CRM.
 */
export const CreateCardSchema = z.object({
  name: z.string().trim().min(1).max(CARD_NAME_MAX),
  kind: CardKindSchema.optional(),
  color: z.string().regex(CARD_HEX_COLOR_REGEX).optional(),
  icon: z.string().max(40).nullish(),
  description: z.string().max(CARD_DESCRIPTION_MAX).nullish(),
  contactName: z.string().trim().max(CARD_CONTACT_FIELD_MAX).nullish(),
  contactEmail: z.string().trim().max(CARD_CONTACT_FIELD_MAX).nullish(),
  contactPhone: z.string().trim().max(CARD_CONTACT_FIELD_MAX).nullish(),
});

export type CreateCardDto = z.infer<typeof CreateCardSchema>;
