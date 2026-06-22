import { Inject, Injectable, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { commonPrefixLength, levenshtein } from '../../../common/text/levenshtein';

export type AssigneeResolution =
  | { kind: 'resolved'; userId: string; name: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: Array<{ userId: string; name: string }> };

const DEFAULT_MAX_EDITS = 2;

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["'«»„‟“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(norm: string): string[] {
  return norm.split(' ').filter((t) => t.length > 0);
}

function declensionEquivalent(a: string, b: string, maxEdits: number): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 3) return false;
  const prefix = commonPrefixLength(a, b);
  if (prefix < 3) return false;
  if (prefix < minLen - 2) return false;
  return levenshtein(a, b) <= maxEdits;
}

interface Candidate {
  userId: string;
  name: string;
  forms: string[];
  tokens: string[];
}

function matchTier(
  inputNorm: string,
  inputTokens: string[],
  candidate: Candidate,
  maxEdits: number,
): number | null {
  if (candidate.forms.includes(inputNorm)) return 0;

  if (inputTokens.length > 0) {
    let worst = 0;
    let allTokensMatched = true;
    for (const t of inputTokens) {
      if (candidate.tokens.includes(t)) continue;
      const declension = candidate.tokens.some((u) => declensionEquivalent(t, u, maxEdits));
      if (declension) {
        worst = Math.max(worst, 1);
        continue;
      }
      allTokensMatched = false;
      break;
    }
    if (allTokensMatched) return worst === 0 ? 1 : 2;
  }

  if (candidate.forms.some((f) => f.startsWith(inputNorm))) return 3;
  if (candidate.forms.some((f) => f.includes(inputNorm))) return 4;
  return null;
}

@Injectable()
export class AssigneeResolverService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(TypedConfigService) private readonly cfg?: TypedConfigService,
  ) {}

  private async maxEdits(): Promise<number> {
    const raw = await this.cfg
      ?.getDynamic<number>('tracker.assigneeMatchMaxEdits', undefined, DEFAULT_MAX_EDITS)
      .catch(() => DEFAULT_MAX_EDITS);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MAX_EDITS;
    return Math.max(0, Math.min(4, value));
  }

  async resolve(tenantId: string, rawName: string): Promise<AssigneeResolution> {
    const norm = normalizeName(rawName);
    if (!norm) return { kind: 'not_found' };

    const memberships = await this.prisma.membership.findMany({
      where: { orgId: tenantId, user: { deletedAt: null } },
      select: { userId: true, user: { select: { name: true } } },
    });
    const activeUserIds = new Set(memberships.map((m) => m.userId));
    if (activeUserIds.size === 0) return { kind: 'not_found' };

    const userNameById = new Map<string, string | null>(
      memberships.map((m) => [m.userId, m.user?.name ?? null]),
    );

    const persons = await this.prisma.person.findMany({
      where: { tenantId, deletedAt: null, userId: { not: null } },
      select: { userId: true, name: true },
    });

    const candidates: Candidate[] = persons
      .filter((p) => p.userId !== null && activeUserIds.has(p.userId))
      .map((p) => {
        const userId = p.userId as string;
        const formSet = new Set<string>();
        const personForm = normalizeName(p.name);
        if (personForm) formSet.add(personForm);
        const userName = userNameById.get(userId);
        if (userName) {
          const userForm = normalizeName(userName);
          if (userForm) formSet.add(userForm);
        }
        const forms = [...formSet];
        const tokenSet = new Set<string>();
        for (const form of forms) for (const t of tokenize(form)) tokenSet.add(t);
        return { userId, name: p.name, forms, tokens: [...tokenSet] };
      });

    const inputTokens = tokenize(norm);
    const maxEdits = await this.maxEdits();

    let bestTier = Number.POSITIVE_INFINITY;
    const byTier = new Map<string, { userId: string; name: string }>();
    let tierCandidates: Array<{ userId: string; name: string }> = [];

    for (const c of candidates) {
      const tier = matchTier(norm, inputTokens, c, maxEdits);
      if (tier === null) continue;
      if (tier < bestTier) {
        bestTier = tier;
        byTier.clear();
        tierCandidates = [];
      }
      if (tier === bestTier && !byTier.has(c.userId)) {
        byTier.set(c.userId, { userId: c.userId, name: c.name });
        tierCandidates.push({ userId: c.userId, name: c.name });
      }
    }

    if (tierCandidates.length === 0) return { kind: 'not_found' };
    const first = tierCandidates[0];
    if (tierCandidates.length === 1 && first) {
      return { kind: 'resolved', userId: first.userId, name: first.name };
    }
    return { kind: 'ambiguous', candidates: tierCandidates.slice(0, 5) };
  }
}
