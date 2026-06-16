import type { Prisma, PrismaClient } from '@prisma/client';

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

export function slugify(input: string, maxLen = 40): string {
  const translit = transliterate(input);
  const slug = translit
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return slug.length > 0 ? slug : 'project';
}

export function deriveIdentifier(input: string): string {
  const translit = transliterate(input)
    .replace(/[^a-z]/g, '')
    .toUpperCase();
  if (translit.length === 0) return 'PRJ';
  if (translit.length < 3) {
    return translit.padEnd(3, 'X');
  }
  return translit.slice(0, 5);
}

type PrismaLikeForProject = Pick<PrismaClient, 'project'> | Prisma.TransactionClient;

const MAX_COLLISION_ATTEMPTS = 5;

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

export async function generateProjectIdentifier(
  name: string,
  tenantId: string,
  client: PrismaLikeForProject,
): Promise<string> {
  const base = deriveIdentifier(name);
  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? '' : String(attempt);
    const maxBaseLen = 5 - suffix.length;
    const candidate = (base.slice(0, maxBaseLen) + suffix).slice(0, 5);
    if (candidate.length < 2) continue;
    const exists = await client.project.findFirst({
      where: { tenantId, identifier: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new Error('identifier_collision');
}
