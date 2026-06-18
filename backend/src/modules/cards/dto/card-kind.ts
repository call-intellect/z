import { z } from 'zod';

export const CARD_KINDS = ['client', 'deal', 'project', 'topic', 'custom', 'vendor'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CardKindSchema = z.enum(CARD_KINDS);

export const CARD_NAME_MAX = 200;
export const CARD_DESCRIPTION_MAX = 5000;
export const CARD_CONTACT_FIELD_MAX = 200;
export const CARD_HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/u;
