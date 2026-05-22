import { z } from 'zod';

/**
 * Допустимые виды карточки. Хранится строкой в `Card.kind` (а не enum'ом),
 * чтобы можно было дополнять без миграций.
 *
 *   client  — клиент (психолог, продажник 1-на-1)
 *   deal    — сделка (продажник: «Acme Q4»)
 *   project — проект («Запуск курса»)
 *   topic   — тема без человека («Q4 планирование»)
 *   custom  — всё остальное
 *   vendor  — поставщик (SBA α-3); карточка-связка к Vendor-сущности.
 */
export const CARD_KINDS = [
  'client',
  'deal',
  'project',
  'topic',
  'custom',
  'vendor',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CardKindSchema = z.enum(CARD_KINDS);

/**
 * Ограничения на пользовательский ввод (общие для create/update).
 */
export const CARD_NAME_MAX = 200;
export const CARD_DESCRIPTION_MAX = 5000;
export const CARD_CONTACT_FIELD_MAX = 200;
export const CARD_HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/u;
