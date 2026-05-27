import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Sprints (2026-05-28) — транслитерация кириллицы в латиницу и генерация
 * уникальных `slug` / `identifier` для нового `Project` в режиме quick-create.
 *
 * Никаких внешних зависимостей. Никакого LLM. Работа в Prisma-транзакции
 * (`tx: Prisma.TransactionClient`) или с обычным PrismaService — оба типа
 * совместимы по сигнатуре `project.findUnique`.
 *
 * Бизнес-инвариант: `Project.slug` уникален per tenant (`@@unique(tenantId, slug)`),
 * `Project.identifier` — НЕ имеет глобального unique, но в рамках tenant'а мы
 * храним его уникальным по соглашению (иначе UI с `IDENT-N` теряет смысл).
 *
 * См. `plans/tz/2026-05-28-sprints-master-detail-and-wizard.md` §1.3.
 */

/** Таблица практической транслитерации (ГОСТ-подобная, но без академического перфекционизма). */
const CYR_TO_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * Транслитерирует кириллический текст в латиницу. ASCII-символы сохраняются
 * как есть. Пустая строка → пустая строка.
 *
 * Примеры:
 *   - 'Альфа' → 'alfa'
 *   - 'Маркетинг' → 'marketing'
 *   - 'ООО «Ромашка»' → 'ooo romashka'
 */
export function transliterate(input: string): string {
  if (!input) return '';
  const lower = input.toLowerCase();
  let out = '';
  for (const ch of lower) {
    if (Object.prototype.hasOwnProperty.call(CYR_TO_LAT, ch)) {
      out += CYR_TO_LAT[ch];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Превращает произвольную строку в slug:
 *   - транслит → нижний регистр,
 *   - всё, кроме `[a-z0-9]` → дефис,
 *   - схлопывает повторы дефисов, обрезает по краям,
 *   - длина <= maxLen (default 40).
 *
 * Если результат пуст — возвращает 'project'.
 */
export function slugify(input: string, maxLen = 40): string {
  const translit = transliterate(input);
  const slug = translit
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return slug.length > 0 ? slug : 'project';
}

/**
 * Извлекает identifier-префикс из имени: первые 3-5 заглавных латинских
 * букв после транслита. Если букв < 3 — добивает 'X'. Fallback — 'PRJ'.
 *
 * Примеры:
 *   - 'Маркетинг' → 'MARKE'
 *   - 'Альфа' → 'ALFA'
 *   - 'ИТ' → 'IT' (короткий, добивка отключена — мы ниже дадим 3 буквы хотя бы)
 *   - '' → 'PRJ'
 */
export function deriveIdentifier(input: string): string {
  const translit = transliterate(input).replace(/[^a-z]/g, '').toUpperCase();
  if (translit.length === 0) return 'PRJ';
  if (translit.length < 3) {
    return translit.padEnd(3, 'X');
  }
  return translit.slice(0, 5);
}

// ─────────────────────────── helpers для коллизий ────────────────────────────

/**
 * Минимальный интерфейс Prisma-клиента, достаточный для проверки коллизий.
 * Подходит и `PrismaService`, и `Prisma.TransactionClient`.
 */
type PrismaLikeForProject = Pick<PrismaClient, 'project'> | Prisma.TransactionClient;

const MAX_COLLISION_ATTEMPTS = 5;

/**
 * Генерирует уникальный slug для нового Project в рамках tenant'а.
 * При коллизии добавляет числовой суффикс `-2`, `-3`, ... Если все 5 попыток
 * заняты — бросает Error (вызывающий код должен переводить это в 409
 * `slug_collision`).
 *
 * @param name — человекочитаемое имя (рус.), на основе которого строится slug.
 * @param tenantId — Org.id; slug уникален per tenant.
 * @param client — `PrismaService` или `Prisma.TransactionClient`.
 */
export async function generateProjectSlug(
  name: string,
  tenantId: string,
  client: PrismaLikeForProject,
): Promise<string> {
  const base = slugify(name);
  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    const exists = await client.project.findUnique({
      where: { tenantId_slug: { tenantId, slug: candidate } },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new Error('slug_collision');
}

/**
 * Генерирует уникальный identifier для нового Project в рамках tenant'а.
 * При коллизии добавляет числовой суффикс — `1`, `2`, ... вплоть до 5 попыток.
 * При коллизии-overflow добавляет цифру к усечённому префиксу так, чтобы общая
 * длина <= 5 символов.
 *
 * Поиск коллизий — через @@index(tenantId, identifier).
 */
export async function generateProjectIdentifier(
  name: string,
  tenantId: string,
  client: PrismaLikeForProject,
): Promise<string> {
  const base = deriveIdentifier(name);
  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? '' : String(attempt);
    // identifier должен укладываться в max 5 символов:
    //   при attempt=1 → base целиком
    //   при attempt>1 → обрезаем base до (5 - suffix.length), приклеиваем suffix
    const maxBaseLen = 5 - suffix.length;
    const candidate = (base.slice(0, maxBaseLen) + suffix).slice(0, 5);
    if (candidate.length < 2) continue; // защита от деградации
    const exists = await client.project.findFirst({
      where: { tenantId, identifier: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new Error('identifier_collision');
}
