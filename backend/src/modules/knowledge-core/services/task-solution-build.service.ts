import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DataClass, Prisma, SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';
import { StructuredDocumentCompilerService } from './structured-document-compiler.service';
import { TaskSolutionRefinerService } from './task-solution-refiner.service';

const DEFAULT_HOW_SOLVED_SIGNAL_TYPES = [
  'reasoning',
  'rationale',
  'decision_basis',
  'methodology_step',
] as const;

type BuildOutcome =
  | 'created'
  | 'updated'
  | 'skippedNoOwner'
  | 'skippedGate'
  | 'skippedNoMethod'
  | 'skippedNoNew'
  | 'skippedCompilerUnavailable'
  | 'error';

export interface TaskSolutionBuildStats {
  candidates: number;
  created: number;
  updated: number;
  skippedNoOwner: number;
  skippedGate: number;
  skippedNoMethod: number;
  skippedNoNew: number;
  skippedCompilerUnavailable: number;
}

const DATA_CLASS_STRICTNESS: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

@Injectable()
export class TaskSolutionBuildService {
  private readonly logger = new Logger(TaskSolutionBuildService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StructuredDocumentCompilerService)
    private readonly docCompiler: StructuredDocumentCompilerService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(TaskSolutionRefinerService)
    private readonly refiner: TaskSolutionRefinerService,
    @Inject(EntityResolutionService)
    private readonly entityResolver: EntityResolutionService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async runForOrg(
    tenantId: string,
    opts: { now?: Date } = {},
  ): Promise<TaskSolutionBuildStats> {
    const now = opts.now ?? new Date();
    const lookbackHours = await this.cfg.getDynamic<number>(
      'taskSolution.lookbackHours',
      undefined,
      48,
    );
    const since = new Date(now.getTime() - lookbackHours * 3_600_000);

    const howSolvedTypes = await this.howSolvedSignalTypes();
    const issueIds = await this.detectCandidateIssueIds(tenantId, since, howSolvedTypes);

    const stats: TaskSolutionBuildStats = {
      candidates: issueIds.length,
      created: 0,
      updated: 0,
      skippedNoOwner: 0,
      skippedGate: 0,
      skippedNoMethod: 0,
      skippedNoNew: 0,
      skippedCompilerUnavailable: 0,
    };

    for (const issueId of issueIds) {
      try {
        const outcome = await this.buildOne(tenantId, issueId);
        switch (outcome) {
          case 'created':
            stats.created += 1;
            break;
          case 'updated':
            stats.updated += 1;
            break;
          case 'skippedNoOwner':
            stats.skippedNoOwner += 1;
            break;
          case 'skippedGate':
            stats.skippedGate += 1;
            break;
          case 'skippedNoMethod':
            stats.skippedNoMethod += 1;
            break;
          case 'skippedNoNew':
            stats.skippedNoNew += 1;
            break;
          case 'skippedCompilerUnavailable':
            stats.skippedCompilerUnavailable += 1;
            break;
          default:
            break;
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            issueId,
            err: err instanceof Error ? err.message : String(err),
          },
          'task-solution-build: ошибка на задаче — продолжаю',
        );
      }
    }

    return stats;
  }

  private async buildOne(tenantId: string, issueId: string): Promise<BuildOutcome> {
    try {
      const issue = await this.prisma.issue.findFirst({
        where: { id: issueId, tenantId, deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          descriptionStripped: true,
          assignees: { select: { userId: true }, orderBy: { userId: 'asc' } },
        },
      });
      if (!issue) return 'skippedGate';

      const howSolvedTypes = await this.howSolvedSignalTypes();
      const rawBlockIds = await this.gatherSolutionBlockIds(tenantId, issueId, howSolvedTypes);
      if (rawBlockIds.length === 0) return 'skippedGate';

      const blocks = await this.prisma.ideaBlock.findMany({
        where: { id: { in: rawBlockIds }, tenantId },
        select: {
          id: true,
          name: true,
          criticalQuestion: true,
          trustedAnswer: true,
          tags: true,
          dataClass: true,
          createdAt: true,
          evidence: { take: 6, select: { quote: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (blocks.length === 0) return 'skippedGate';

      const blockIds = blocks.map((b) => b.id);

      const minChars = await this.cfg.getDynamic<number>(
        'taskSolution.minSignalChars',
        undefined,
        15,
      );
      const totalChars = blocks.reduce((sum, b) => sum + b.trustedAnswer.trim().length, 0);
      if (totalChars < minChars) return 'skippedGate';

      const existing = await this.prisma.taskSolution.findUnique({
        where: { tenantId_sourceIssueId: { tenantId, sourceIssueId: issueId } },
      });

      const newBlockIds = blockIds.filter((id) => !existing?.sourceBlockIds.includes(id));
      if (existing && newBlockIds.length === 0) return 'skippedNoNew';

      const newBlockIdSet = new Set(newBlockIds);
      const refineBlocks = existing ? blocks.filter((b) => newBlockIdSet.has(b.id)) : blocks;

      const dataClass = this.mostSensitive(blocks.map((b) => b.dataClass));
      const now = new Date();

      const assigneePersonIds = await this.resolveAssigneePersonIds(tenantId, issue.assignees);
      const refineEnabled = await this.cfg.getDynamic<boolean>(
        'taskSolution.refineEnabled',
        undefined,
        true,
      );
      const disambigContext = `${issue.title}\n${blocks
        .map((b) => b.trustedAnswer)
        .join('\n')}`.slice(0, 4000);

      let solverNames: string[] = [];
      let hasConcreteMethod = true;
      let refineOk = false;
      if (refineEnabled) {
        const firstAssigneeName =
          assigneePersonIds.length > 0 ? await this.personName(tenantId, assigneePersonIds[0]!) : null;
        const refined = await this.refiner.extract({
          taskTitle: issue.title,
          assigneeName: firstAssigneeName,
          blocks: refineBlocks.map((b) => ({
            name: b.name,
            question: b.criticalQuestion,
            answer: b.trustedAnswer,
            quotes: (b.evidence ?? [])
              .map((e) => e.quote)
              .filter((q): q is string => !!q && q.length > 0)
              .slice(0, 6),
          })),
          tenantId,
          dataClass,
          sourceRef: { type: 'issue', id: issueId },
          nowIso: now.toISOString(),
        });
        refineOk = refined.ok;
        hasConcreteMethod = refined.hasConcreteMethod;
        solverNames = refined.solverNames;
      }

      if (refineOk && !hasConcreteMethod) return 'skippedNoMethod';

      const solverPersonIds =
        refineEnabled && solverNames.length > 0
          ? await this.resolveSolverPersonIds(tenantId, solverNames, disambigContext)
          : [];

      let ownerPersonId: string | null;
      let ownerAudit: Prisma.InputJsonValue | undefined;
      if (existing) {
        ownerPersonId = existing.ownerPersonId;
      } else {
        const ownerInferenceEnabled = await this.cfg.getDynamic<boolean>(
          'taskSolution.ownerInferenceEnabled',
          undefined,
          true,
        );
        const assigneeOwner = this.pickAssigneeOwner(assigneePersonIds, solverPersonIds);
        const singleSolver =
          solverNames.length === 1 && solverPersonIds.length === 1 ? solverPersonIds[0]! : null;
        if (assigneeOwner === null) {
          if (ownerInferenceEnabled && singleSolver) {
            ownerPersonId = singleSolver;
            ownerAudit = this.buildOwnerAudit('solver-no-assignee', null, singleSolver, solverNames, now);
          } else {
            ownerPersonId = null;
          }
        } else if (
          ownerInferenceEnabled &&
          singleSolver &&
          !assigneePersonIds.includes(singleSolver)
        ) {
          ownerPersonId = singleSolver;
          ownerAudit = this.buildOwnerAudit(
            'assignee-solver-divergence',
            assigneeOwner,
            singleSolver,
            solverNames,
            now,
          );
        } else {
          ownerPersonId = assigneeOwner;
        }
      }
      if (!ownerPersonId) return 'skippedNoOwner';

      const subjectIds = this.union(
        existing?.personSubjectIds ?? [],
        this.union([ownerPersonId], solverPersonIds),
      );

      const compiled = this.docCompiler.isEnabled()
        ? await this.docCompiler.compile(
            {
              kind: 'task_solution',
              name: issue.title,
              newSourceBlocks: blocks.map((b) => ({
                name: b.name,
                question: b.criticalQuestion,
                answer: b.trustedAnswer,
                quotes: (b.evidence ?? [])
                  .map((e) => e.quote)
                  .filter((q): q is string => !!q && q.length > 0)
                  .slice(0, 6),
              })),
              existingContentMd: existing?.solutionMd ?? '',
              nowIso: now.toISOString(),
            },
            { tenantId, dataClass, sourceRef: { type: 'issue', id: issueId } },
          )
        : null;

      if (existing && !(compiled && compiled.ok)) return 'skippedCompilerUnavailable';

      const bodyMd =
        compiled && compiled.ok
          ? compiled.contentMd
          : blocks.map((b) => `- ${b.trustedAnswer}`).join('\n');

      const taskDescription = (issue.descriptionStripped ?? issue.description ?? '').slice(0, 4000);
      const skillTags = this.union(
        existing?.skillTags ?? [],
        blocks.flatMap((b) => b.tags),
      ).slice(0, 20);
      const sourceBlockIds = this.union(existing?.sourceBlockIds ?? [], blockIds);

      const payload = {
        contentMd: bodyMd,
        signals: compiled?.signals ?? [],
        changeReasonText: compiled?.changeReason ?? (existing ? 'дополнение' : 'первичная сборка'),
      } as unknown as Prisma.InputJsonValue;

      let solutionId: string;
      let outcome: BuildOutcome;

      if (!existing) {
        solutionId = await this.prisma.$transaction(async (tx) => {
          const ts = await tx.taskSolution.create({
            data: {
              tenantId,
              title: issue.title.slice(0, 300),
              taskDescription,
              solutionMd: bodyMd,
              ownerPersonId,
              personSubjectIds: subjectIds,
              sourceIssueId: issueId,
              sourceBlockIds,
              skillTags,
              dataClass,
              confidence: null,
              version: 1,
              ...(ownerAudit !== undefined ? { ownerAudit } : {}),
            },
          });
          const cv = await tx.cardVersion.create({
            data: {
              tenantId,
              resourceType: 'task_solution',
              resourceId: ts.id,
              version: 1,
              payload,
              changeReason: 'create',
              trustTier: 'auto',
              previousVersionId: null,
              createdByUserId: null,
            },
          });
          await tx.taskSolution.update({
            where: { id: ts.id },
            data: { currentVersionId: cv.id },
          });
          return ts.id;
        });
        outcome = 'created';
      } else {
        const newVersion = (existing.version ?? 1) + 1;
        solutionId = await this.prisma.$transaction(async (tx) => {
          const cv = await tx.cardVersion.create({
            data: {
              tenantId,
              resourceType: 'task_solution',
              resourceId: existing.id,
              version: newVersion,
              payload,
              changeReason: 'extension',
              trustTier: 'auto',
              previousVersionId: existing.currentVersionId,
              createdByUserId: null,
            },
          });
          await tx.taskSolution.update({
            where: { id: existing.id },
            data: {
              solutionMd: bodyMd,
              taskDescription,
              sourceBlockIds: { set: sourceBlockIds },
              skillTags: { set: skillTags },
              personSubjectIds: { set: subjectIds },
              dataClass,
              version: newVersion,
              currentVersionId: cv.id,
            },
          });
          return existing.id;
        });
        outcome = 'updated';
      }

      const vecStr = await this.tryWriteEmbedding(solutionId, `${issue.title} ${bodyMd}`);
      if (vecStr) await this.assignRepeatGroup(tenantId, solutionId, vecStr);
      return outcome;
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-solution-build.buildOne: внутренняя ошибка — пропускаю задачу',
      );
      return 'error';
    }
  }

  private async howSolvedSignalTypes(): Promise<string[]> {
    const raw = await this.cfg.getDynamic<string[]>(
      'taskSolution.howSolvedSignalTypes',
      undefined,
      [...DEFAULT_HOW_SOLVED_SIGNAL_TYPES],
    );
    const valid = new Set<string>(Object.values(SignalType));
    const filtered = Array.isArray(raw) ? raw.filter((t) => valid.has(t)) : [];
    return filtered.length > 0 ? filtered : [...DEFAULT_HOW_SOLVED_SIGNAL_TYPES];
  }

  private async detectCandidateIssueIds(
    tenantId: string,
    since: Date,
    howSolvedTypes: readonly string[],
  ): Promise<string[]> {
    const typePlaceholders = howSolvedTypes.map((_, i) => `$${i + 3}`).join(',');
    const sql = `
      SELECT DISTINCT issue_id FROM (
        SELECT re.payload->>'contextCardId' AS issue_id
        FROM "IdeaBlock" ib
        JOIN "IdeaBlockEvidence" ev ON ev."blockId" = ib.id AND ev."tenantId" = ib."tenantId"
        JOIN "RawEvent" re ON re.id = ev."rawEventId"
        WHERE ib."tenantId" = $1
          AND ib."signalType" IN (${typePlaceholders})
          AND ib.status = 'canonical'
          AND re.payload->>'contextCardId' IS NOT NULL
          AND GREATEST(COALESCE(ev."sourceTimestamp", re."occurredAt"), re."occurredAt") >= $2
        UNION
        SELECT tcc."issueId" AS issue_id
        FROM "TaskClosureCandidate" tcc
        WHERE tcc."tenantId" = $1
          AND tcc.status IN ('pending', 'accepted')
          AND tcc."createdAt" >= $2
      ) u
      WHERE issue_id IS NOT NULL AND issue_id <> ''
      LIMIT 2000
    `;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ issue_id: string | null }>>(
      sql,
      tenantId,
      since,
      ...howSolvedTypes,
    );
    return [
      ...new Set(rows.map((r) => r.issue_id).filter((v): v is string => !!v && v.length > 0)),
    ];
  }

  private async gatherSolutionBlockIds(
    tenantId: string,
    issueId: string,
    howSolvedTypes: readonly string[],
  ): Promise<string[]> {
    const typePlaceholders = howSolvedTypes.map((_, i) => `$${i + 3}`).join(',');
    const sql = `
      SELECT DISTINCT block_id FROM (
        SELECT ib.id AS block_id
        FROM "IdeaBlock" ib
        JOIN "IdeaBlockEvidence" ev ON ev."blockId" = ib.id AND ev."tenantId" = ib."tenantId"
        JOIN "RawEvent" re ON re.id = ev."rawEventId"
        WHERE ib."tenantId" = $1
          AND ib."signalType" IN (${typePlaceholders})
          AND ib.status = 'canonical'
          AND re.payload->>'contextCardId' = $2
        UNION
        SELECT cib.id AS block_id
        FROM "TaskClosureCandidate" tcc
        JOIN "IdeaBlock" sib ON sib.id = tcc."sourceBlockId" AND sib."tenantId" = tcc."tenantId"
        JOIN "IdeaBlock" cib ON cib.id = COALESCE(sib."mergedIntoId", sib.id) AND cib."tenantId" = tcc."tenantId"
        WHERE tcc."tenantId" = $1
          AND tcc."issueId" = $2
          AND tcc.status IN ('pending', 'accepted')
          AND cib.status = 'canonical'
      ) u
      LIMIT 500
    `;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ block_id: string }>>(
      sql,
      tenantId,
      issueId,
      ...howSolvedTypes,
    );
    return [...new Set(rows.map((r) => r.block_id).filter(Boolean))];
  }

  async resolveOwnerPerson(
    tenantId: string,
    assignees: { userId: string | null }[],
    solverPersonIds: readonly string[] = [],
  ): Promise<string | null> {
    const personIds = await this.resolveAssigneePersonIds(tenantId, assignees);
    return this.pickAssigneeOwner(personIds, solverPersonIds);
  }

  private async resolveAssigneePersonIds(
    tenantId: string,
    assignees: { userId: string | null }[],
  ): Promise<string[]> {
    const userIds = [...new Set(assignees.map((a) => a.userId).filter((u): u is string => !!u))];
    if (!userIds.length) return [];
    const persons = await this.prisma.person.findMany({
      where: { tenantId, userId: { in: userIds }, deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return [...new Set(persons.map((p) => p.id))];
  }

  private pickAssigneeOwner(
    assigneePersonIds: readonly string[],
    solverPersonIds: readonly string[],
  ): string | null {
    if (assigneePersonIds.length === 0) return null;
    const sorted = [...assigneePersonIds].sort();
    const solverSet = new Set(solverPersonIds);
    const solverAssignee = sorted.find((id) => solverSet.has(id));
    return solverAssignee ?? sorted[0]!;
  }

  private buildOwnerAudit(
    reason: 'solver-no-assignee' | 'assignee-solver-divergence',
    assigneePersonId: string | null,
    inferredOwnerPersonId: string,
    solverNames: readonly string[],
    now: Date,
  ): Prisma.InputJsonValue {
    return {
      reason,
      assigneePersonId,
      inferredOwnerPersonId,
      solverNames: [...solverNames],
      at: now.toISOString(),
    };
  }

  private async personName(tenantId: string, personId: string): Promise<string | null> {
    const p = await this.prisma.person.findFirst({
      where: { id: personId, tenantId },
      select: { name: true },
    });
    return p?.name ?? null;
  }

  private async resolveSolverPersonIds(
    tenantId: string,
    solverNames: readonly string[],
    context: string,
  ): Promise<string[]> {
    const ids = new Set<string>();
    for (const name of solverNames) {
      const pid = await this.entityResolver
        .resolvePersonByHint(tenantId, name, context)
        .catch(() => null);
      if (pid) {
        ids.add(pid);
      } else {
        this.logger.debug(
          { tenantId, name },
          'task-solution-build: со-решатель не разрезолвлен по имени — пропускаю',
        );
      }
    }
    return [...ids];
  }

  private async tryWriteEmbedding(id: string, text: string): Promise<string | null> {
    try {
      const t = text.trim().slice(0, 2_000);
      if (!t) return null;
      const vec = await this.embedder.embedQuery(t);
      if (!vec) return null;
      const vecStr = `[${vec.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        'UPDATE "task_solutions" SET "embedding" = $1::vector WHERE "id" = $2',
        vecStr,
        id,
      );
      return vecStr;
    } catch (err) {
      this.logger.debug(
        { id, err: err instanceof Error ? err.message : String(err) },
        'task-solution-build.tryWriteEmbedding: пропускаю (best-effort)',
      );
      return null;
    }
  }

  private async assignRepeatGroup(
    tenantId: string,
    solutionId: string,
    vecStr: string,
  ): Promise<void> {
    try {
      const threshold = await this.cfg.getDynamic<number>(
        'taskSolution.repeatThreshold',
        undefined,
        3,
      );
      const minSim = await this.cfg.getDynamic<number>(
        'taskSolution.repeatSimilarity',
        undefined,
        0.85,
      );
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; repeatGroupKey: string | null; similarity: number }>
      >(
        `SELECT id, "repeatGroupKey", (1 - (embedding <=> $1::vector)) AS similarity
         FROM "task_solutions"
         WHERE "tenantId" = $2 AND id <> $3 AND "deletedAt" IS NULL AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 20`,
        vecStr,
        tenantId,
        solutionId,
      );
      const neighbors = rows.filter((r) => Number(r.similarity) >= minSim);
      const groupSize = neighbors.length + 1;
      if (groupSize < threshold) return;
      const existingKeys = [
        ...new Set(neighbors.map((n) => n.repeatGroupKey).filter((k): k is string => !!k)),
      ].sort();
      const memberIds = [solutionId, ...neighbors.map((n) => n.id)];
      const key = existingKeys[0] ?? `grp_${[...memberIds].sort()[0]}`;
      await this.prisma.taskSolution.updateMany({
        where: { tenantId, id: { in: memberIds }, promotedToInstructionId: null, deletedAt: null },
        data: { repeatGroupKey: key, candidateInstruction: true },
      });
    } catch (err) {
      this.logger.debug(
        { solutionId, err: err instanceof Error ? err.message : String(err) },
        'task-solution-build.assignRepeatGroup: пропускаю (best-effort)',
      );
    }
  }

  union<T>(a: readonly T[], b: readonly T[]): T[] {
    return [...new Set([...a, ...b])];
  }

  mostSensitive(classes: readonly DataClass[]): DataClass {
    let best: DataClass | null = null;
    for (const c of classes) {
      if (best === null || DATA_CLASS_STRICTNESS[c] > DATA_CLASS_STRICTNESS[best]) {
        best = c;
      }
    }
    return best ?? 'internal';
  }
}
