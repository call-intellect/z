import { z } from 'zod';

import {
  CARD_CONTACT_FIELD_MAX,
  CARD_DESCRIPTION_MAX,
  CARD_HEX_COLOR_REGEX,
  CARD_NAME_MAX,
  CardKindSchema,
} from './card-kind';

/**
 * `PATCH /api/v1/cards/:id`. Любое подмножество полей; `pinned` и `archived`
 * тоже здесь — отдельные эндпоинты под них не делаем (одна точка изменения).
 */
export const UpdateCardSchema = z
  .object({
    name: z.string().trim().min(1).max(CARD_NAME_MAX).optional(),
    kind: CardKindSchema.optional(),
    color: z.string().regex(CARD_HEX_COLOR_REGEX).optional(),
    icon: z.string().max(40).nullish(),
    description: z.string().max(CARD_DESCRIPTION_MAX).nullish(),
    contactName: z.string().trim().max(CARD_CONTACT_FIELD_MAX).nullish(),
    contactEmail: z.string().trim().max(CARD_CONTACT_FIELD_MAX).nullish(),
    contactPhone: z.string().trim().max(CARD_CONTACT_FIELD_MAX).nullish(),
    pinned: z.boolean().optional(),
    /** true — `archivedAt = now()`, false — `archivedAt = null`. */
    archived: z.boolean().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    { message: 'no_fields_to_update' },
  );

export type UpdateCardDto = z.infer<typeof UpdateCardSchema>;
