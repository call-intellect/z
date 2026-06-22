import { Inject, Injectable, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { commonPrefixLength, levenshtein } from '../../../common/text/levenshtein';
import { SubjectMemoryService } from '../../probe/subject-memory/subject-memory.service';

export type AssigneeResolution =
  | { kind: 'resolved'; userId: string; name: string; via: 'name' | 'memory' }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: Array<{ userId: string; name: string }> }
  | { kind: 'collective'; label: string; departmentId?: string; roleId?: string };

const DEFAULT_MAX_EDITS = 2;

const COLLECTIVE_KEYWORDS = ['отдел', 'команда', 'группа', 'департамент', 'служба', 'все'];

interface NamedUnit {
  id: string;
  name: string;
  forms: string[];
  tokens: string[];
}

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

type MemberMatch =
  | { kind: 'resolved'; userId: string; name: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: Array<{ userId: string; name: string }> };

@Injectable()
export class AssigneeResolverService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(TypedConfigService) private readonly cfg?: TypedConfigService,
    @Optional() @Inject(SubjectMemoryService) private readonly subjectMemory?: SubjectMemoryService,
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

    const direct = await this.matchMembers(tenantId, rawName);

    if (direct.kind === 'resolved') {
      return { kind: 'resolved', userId: direct.userId, name: direct.name, via: 'name' };
    }

    const fromMemory = await this.resolveFromMemory(tenantId, rawName);
    if (fromMemory) return fromMemory;

    if (direct.kind === 'ambiguous') {
      return { kind: 'ambiguous', candidates: direct.candidates };
    }

    const collective = await this.detectCollective(tenantId, rawName, norm);
    if (collective) return collective;

    return { kind: 'not_found' };
  }

  private async resolveFromMemory(
    tenantId: string,
    rawName: string,
  ): Promise<Extract<AssigneeResolution, { kind: 'resolved' }> | null> {
    if (!this.subjectMemory) return null;
    let rule: { kind: string; ruleText: string } | null;
    try {
      rule = await this.subjectMemory.findApplicableRule(tenantId, rawName);
    } catch {
      return null;
    }
    if (!rule || rule.kind !== 'disambiguation') return null;
    const ruleText = rule.ruleText?.trim();
    if (!ruleText) return null;
    const matched = await this.matchMembers(tenantId, ruleText);
    if (matched.kind !== 'resolved') return null;
    return { kind: 'resolved', userId: matched.userId, name: matched.name, via: 'memory' };
  }

  private async matchMembers(tenantId: string, rawName: string): Promise<MemberMatch> {
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

  private async detectCollective(
    tenantId: string,
    rawName: string,
    norm: string,
  ): Promise<Extract<AssigneeResolution, { kind: 'collective' }> | null> {
    const departmentId = await this.matchUnit(this.loadDepartments(tenantId), norm);
    if (departmentId) return { kind: 'collective', label: rawName, departmentId };

    const roleId = await this.matchUnit(this.loadRoles(tenantId), norm);
    if (roleId) return { kind: 'collective', label: rawName, roleId };

    const inputTokens = new Set(tokenize(norm));
    const hasKeyword = COLLECTIVE_KEYWORDS.some(
      (kw) => inputTokens.has(kw) || norm.includes(kw),
    );
    if (hasKeyword) return { kind: 'collective', label: rawName };

    return null;
  }

  private async loadDepartments(tenantId: string): Promise<NamedUnit[]> {
    const findMany = this.prisma.department?.findMany?.bind(this.prisma.department);
    if (!findMany) return [];
    const rows = await findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    return this.toUnits(rows);
  }

  private async loadRoles(tenantId: string): Promise<NamedUnit[]> {
    const findMany = this.prisma.role?.findMany?.bind(this.prisma.role);
    if (!findMany) return [];
    const rows = await findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    return this.toUnits(rows);
  }

  private toUnits(rows: Array<{ id: string; name: string }>): NamedUnit[] {
    return rows.map((r) => {
      const form = normalizeName(r.name);
      const forms = form ? [form] : [];
      const tokens = forms.flatMap((f) => tokenize(f));
      return { id: r.id, name: r.name, forms, tokens };
    });
  }

  private async matchUnit(unitsPromise: Promise<NamedUnit[]>, norm: string): Promise<string | null> {
    let units: NamedUnit[];
    try {
      units = await unitsPromise;
    } catch {
      return null;
    }
    const inputTokens = new Set(tokenize(norm));
    for (const u of units) {
      for (const form of u.forms) {
        if (!form) continue;
        if (norm.includes(form) || form.includes(norm)) return u.id;
      }
      if (u.tokens.length > 0 && u.tokens.every((t) => inputTokens.has(t))) return u.id;
    }
    return null;
  }
}
