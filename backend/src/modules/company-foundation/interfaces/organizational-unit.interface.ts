export type OrganizationalUnitScope = 'company' | 'department' | 'role' | 'domain';

export interface IOrganizationalUnit {
  readonly scope: OrganizationalUnitScope;
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly missionStatement?: string | null;
  readonly entityId?: string | null;
  readonly maturityScore?: number | null;
  readonly completeness?: number | null;
  readonly parentUnitId?: string | null;
  getChildren(): Promise<IOrganizationalUnit[]>;
}
