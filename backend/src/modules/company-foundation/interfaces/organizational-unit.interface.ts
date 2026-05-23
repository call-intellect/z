/**
 * SBA α-9 wave 3 — общий интерфейс для всех «организационных единиц»:
 *   - CompanyProfile  — корень (1:1 на Org).
 *   - Department      — отдел.
 *   - Role            — должность.
 *   - FunctionalDomain — функциональная область (агрегатная единица, не «единица
 *     управления», но имеет maturity / completeness / иерархию — поэтому удобно
 *     уложить в тот же интерфейс).
 *
 * Цель: единая работа MaturityScorerService / DomainExpanderService / UI-
 * виджетов поверх любых из этих сущностей без `if (unit instanceof ...)`.
 *
 * `getChildren()` возвращает «следующий уровень» в иерархии единицы:
 *   - CompanyProfile.children   → все Department'ы Org.
 *   - Department.children       → все Department'ы с parentDepartmentId=this.id
 *                                 (children по иерархии Org).
 *   - Role.children             → ∅ (Role — листовая).
 *   - FunctionalDomain.children → дочерние FunctionalDomain (parentDomainId).
 */
export type OrganizationalUnitScope = 'company' | 'department' | 'role' | 'domain';

export interface IOrganizationalUnit {
  readonly scope: OrganizationalUnitScope;
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  /** Краткая миссия (1-2 предложения). */
  readonly missionStatement?: string | null;
  /** Линковка в граф знаний (если применимо). */
  readonly entityId?: string | null;
  /** 0..1. */
  readonly maturityScore?: number | null;
  /** 0..1. */
  readonly completeness?: number | null;
  /** Родительский unit (для иерархии). */
  readonly parentUnitId?: string | null;
  /** Получить детей (один уровень). */
  getChildren(): Promise<IOrganizationalUnit[]>;
}
