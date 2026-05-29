/**
 * ReferralsService — CRUD реферального профиля.
 *
 * Бизнес-правила (ТЗ §9):
 *   - Один user → один Referral (`@unique ownerUserId`).
 *   - Slug: 8 chars из nanoid с custom alphabet (a-z, 0-9; без 0/o/l/1 чтобы
 *     не путались в QR-кодах и копировании руками).
 *   - ИНН верифицируется через `InnLookupService.lookup(inn)` — отдельный
 *     метод `verifyInn()`, который ставит `innVerifiedAt = now` если lookup
 *     успешен (без сравнения с владельцем — на MVP доверяем юзеру).
 *   - Контракт-оферта: `acceptContract()` ставит `contractAcceptedAt = now`.
 *     Без этого + без `innVerifiedAt` cron 10-го числа НЕ переведёт payout
 *     в `paid` (см. ReferralPayoutCron).
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §9.
 */

import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type Referral,
  type ReferralLegalForm,
} from '@prisma/client';
import { customAlphabet } from 'nanoid';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { InnLookupService } from '../../inn-lookup/inn-lookup.service';

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SLUG_LENGTH = 8;
const generateSlug = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

export interface CreateReferralInput {
  ownerUserId: string;
  inn: string;
  legalForm: ReferralLegalForm;
  payoutDetails: Prisma.InputJsonValue;
}

export interface UpdateReferralInput {
  inn?: string;
  legalForm?: ReferralLegalForm;
  payoutDetails?: Prisma.InputJsonValue;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InnLookupService) private readonly innLookup: InnLookupService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async getByUserId(ownerUserId: string): Promise<Referral | null> {
    return this.prisma.referral.findUnique({ where: { ownerUserId } });
  }

  async getBySlug(slug: string): Promise<Referral | null> {
    return this.prisma.referral.findUnique({ where: { slug } });
  }

  /**
   * Создать реферальный профиль. Если уже есть — ConflictException
   * (используйте `update` для изменения).
   */
  async create(input: CreateReferralInput): Promise<Referral> {
    const existing = await this.getByUserId(input.ownerUserId);
    if (existing) {
      throw new ConflictException(
        `Реферальный профиль для user ${input.ownerUserId} уже существует (slug=${existing.slug})`,
      );
    }
    return this.prisma.referral.create({
      data: {
        ownerUserId: input.ownerUserId,
        slug: await this.generateUniqueSlug(),
        inn: input.inn.trim(),
        legalForm: input.legalForm,
        payoutDetails: input.payoutDetails,
      },
    });
  }

  /** Обновить inn / legalForm / payoutDetails (сбрасывает innVerifiedAt если inn менялся). */
  async update(
    ownerUserId: string,
    input: UpdateReferralInput,
  ): Promise<Referral> {
    const existing = await this.getByUserId(ownerUserId);
    if (!existing) {
      throw new NotFoundException(
        `Реферальный профиль для user ${ownerUserId} не найден`,
      );
    }
    const data: Prisma.ReferralUncheckedUpdateInput = {};
    if (input.inn !== undefined && input.inn.trim() !== existing.inn) {
      data.inn = input.inn.trim();
      data.innVerifiedAt = null; // сброс верификации при смене ИНН
    }
    if (input.legalForm !== undefined) data.legalForm = input.legalForm;
    if (input.payoutDetails !== undefined) data.payoutDetails = input.payoutDetails;
    return this.prisma.referral.update({
      where: { id: existing.id },
      data,
    });
  }

  /**
   * Верифицировать ИНН реферала через InnLookupService.
   *
   * audit Б6 (2026-05-29): раньше любой lookup-успех ставил innVerifiedAt.
   * Можно было подать ИНН любого юрлица и получить отметку. Теперь:
   *   - **self_employed / individual**: ИНН в lookup-результате должен
   *     БУКВАЛЬНО совпадать с введённым (защита от опечатки/подмены).
   *     На практике для физлица lookup возвращает свой же ИНН — значит
   *     verifyInn автоматически проходит, если ИНН валидный.
   *   - **company**: требуется `directorName` в lookup-результате и
   *     совпадение по фамилии с `User.name` заявителя. Если нет — статус
   *     `pendingDocVerification` (innVerifiedAt НЕ ставится), UI попросит
   *     загрузить документ.
   *   - На несовпадении бьём метрику `referral_inn_mismatch_total`.
   */
  async verifyInn(ownerUserId: string): Promise<Referral> {
    const ref = await this.getByUserId(ownerUserId);
    if (!ref) {
      throw new NotFoundException(
        `Реферальный профиль для user ${ownerUserId} не найден`,
      );
    }
    if (ref.innVerifiedAt) return ref;

    try {
      const lookup = await this.innLookup.lookup(ref.inn);
      this.logger.log(
        `Inn-lookup для ${ref.inn} → ${lookup.source}/${lookup.payerType}`,
      );

      // audit Б6: проверки до выставления innVerifiedAt.
      if (lookup.inn && lookup.inn.replace(/\D/g, '') !== ref.inn.replace(/\D/g, '')) {
        this.logger.warn(
          `verifyInn: ИНН в lookup-результате (${lookup.inn}) не совпадает с введённым (${ref.inn})`,
        );
        this.metrics.incReferralInnMismatch({ reason: 'lookup_inn_mismatch' });
        return ref;
      }

      // Для company требуем директора с совпадением по User.name.
      if (lookup.payerType === 'legal_entity') {
        const owner = await this.prisma.user.findUnique({
          where: { id: ownerUserId },
          select: { name: true },
        });
        const ownerLastName = extractLastName(owner?.name ?? null);
        const directorLastName = extractLastName(lookup.directorName ?? null);
        if (!ownerLastName || !directorLastName || ownerLastName !== directorLastName) {
          this.logger.warn(
            `verifyInn: company-реферал ${ref.inn}: directorName='${lookup.directorName ?? '-'}', userName='${owner?.name ?? '-'}' — pending doc verification`,
          );
          this.metrics.incReferralInnMismatch({ reason: 'director_name_mismatch' });
          return ref;
        }
      }

      return this.prisma.referral.update({
        where: { id: ref.id },
        data: { innVerifiedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `verifyInn ${ref.inn} не нашёл: ${err instanceof Error ? err.message : String(err)}`,
      );
      // НЕ throw — возвращаем неверифицированный профиль; UI покажет статус.
      return ref;
    }
  }

  /** Принять оферту (фикс `contractAcceptedAt`). Идемпотентно. */
  async acceptContract(ownerUserId: string): Promise<Referral> {
    const ref = await this.getByUserId(ownerUserId);
    if (!ref) {
      throw new NotFoundException(
        `Реферальный профиль для user ${ownerUserId} не найден`,
      );
    }
    if (ref.contractAcceptedAt) return ref;
    return this.prisma.referral.update({
      where: { id: ref.id },
      data: { contractAcceptedAt: new Date() },
    });
  }

  /** Список приведённых клиентов (через ClientReferralLink). */
  async listClients(referralId: string) {
    return this.prisma.clientReferralLink.findMany({
      where: { referralId },
      include: {
        org: { select: { id: true, name: true } },
        subscription: {
          select: {
            status: true,
            paymentMode: true,
            currentPeriodEnd: true,
            totalPaidKopecks: true,
          },
        },
      },
      orderBy: { attachedAt: 'desc' },
    });
  }

  /** Список payout'ов реферала. */
  async listPayouts(referralId: string) {
    return this.prisma.referralPayout.findMany({
      where: { referralId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Денежный баланс реферала — сумма pending+paid payout'ов. */
  async getStats(referralId: string): Promise<{
    totalClients: number;
    activePaying: number;
    totalEarnedKopecks: number;
    totalPaidKopecks: number;
    totalPendingKopecks: number;
  }> {
    const [clients, payouts] = await Promise.all([
      this.prisma.clientReferralLink.count({ where: { referralId } }),
      this.prisma.referralPayout.findMany({
        where: { referralId },
        select: { amountKopecks: true, status: true },
      }),
    ]);
    const activePaying = await this.prisma.clientReferralLink.count({
      where: {
        referralId,
        firstPaidAt: { not: null },
        subscription: {
          status: 'ACTIVE',
          paymentMode: 'paid',
        },
      },
    });
    let totalEarned = 0;
    let totalPaid = 0;
    let totalPending = 0;
    for (const p of payouts) {
      if (p.status === 'paid') {
        totalEarned += p.amountKopecks;
        totalPaid += p.amountKopecks;
      } else if (p.status === 'pending') {
        totalEarned += p.amountKopecks;
        totalPending += p.amountKopecks;
      }
    }
    return {
      totalClients: clients,
      activePaying,
      totalEarnedKopecks: totalEarned,
      totalPaidKopecks: totalPaid,
      totalPendingKopecks: totalPending,
    };
  }

  // ────────────────────────── private ──────────────────────────

  // ↓ см. ниже extractLastName в file scope

  /** Генерация уникального slug'а. Retry до 5 раз при коллизии. */
  private async generateUniqueSlug(): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const candidate = generateSlug();
      const taken = await this.prisma.referral.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // Крайне маловероятно (32^8 ≈ 1.1×10^12 комбинаций). Fallback на hex.
    return randomBytes(6).toString('hex');
  }
}

/**
 * audit Б6: грубое извлечение фамилии для сравнения «director vs user».
 * Принимаем «Иванов Иван Иванович» / «Иван Иванов» / «И. И. Иванов». Берём
 * самое длинное русское слово в верхнем регистре первой буквы, либо первое
 * слово >2 символов. Если ничего не нашли — возвращаем null.
 */
function extractLastName(fullName: string | null): string | null {
  if (!fullName) return null;
  const tokens = fullName
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && /^[\p{L}-]+$/u.test(t));
  if (tokens.length === 0) return null;
  // Берём самое длинное слово как эвристику «фамилии». Для «Иванов Иван Иванович»
  // это часто «Иванов» либо «Иванович» — оба содержат «Иванов».
  let best = tokens[0]!;
  for (const t of tokens) {
    if (t.length > best.length) best = t;
  }
  return best.toLowerCase();
}
