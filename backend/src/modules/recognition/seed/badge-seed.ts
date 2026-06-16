import type { PrismaClient } from '@prisma/client';

export interface BadgeSeedEntry {
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  condition: { type: string; threshold: number };
}

export const BASE_BADGES: readonly BadgeSeedEntry[] = [
  {
    slug: 'ideator',
    name: 'Идеатор',
    description: '5+ идей взято в работу. Спасибо, что предлагаешь — это меняет компанию.',
    iconUrl: null,
    condition: { type: 'ideas_in_dev', threshold: 5 },
  },
  {
    slug: 'expert',
    name: 'Эксперт',
    description: '10+ благодарностей от коллег. Тебя ценят за глубину знаний.',
    iconUrl: null,
    condition: { type: 'thanks_received', threshold: 10 },
  },
  {
    slug: 'helper',
    name: 'Помощник',
    description:
      '20+ «спасибо» под твоими комментариями. Ты помогаешь другим разбираться в задачах.',
    iconUrl: null,
    condition: { type: 'helpful_comments', threshold: 20 },
  },
  {
    slug: 'aligned',
    name: 'Стрелок',
    description: '90%+ задач привязано к целям компании. Ты работаешь по приоритетам.',
    iconUrl: null,
    condition: { type: 'goal_alignment', threshold: 90 },
  },
  {
    slug: 'consistent',
    name: 'Стабильный',
    description: '14 дней подряд с чек-инами. Команда видит полную картину благодаря тебе.',
    iconUrl: null,
    condition: { type: 'checkin_streak', threshold: 14 },
  },
];

export interface BadgeSeedStats {
  inserted: number;
  skipped: number;
}

export async function seedBaseBadges(prisma: PrismaClient): Promise<BadgeSeedStats> {
  const stats: BadgeSeedStats = { inserted: 0, skipped: 0 };
  for (const b of BASE_BADGES) {
    const existing = await prisma.badge.findUnique({ where: { slug: b.slug } });
    if (existing) {
      stats.skipped += 1;
      continue;
    }
    await prisma.badge.create({
      data: {
        slug: b.slug,
        name: b.name,
        description: b.description,
        iconUrl: b.iconUrl,
        condition: b.condition as unknown as object,
      },
    });
    stats.inserted += 1;
  }
  return stats;
}
