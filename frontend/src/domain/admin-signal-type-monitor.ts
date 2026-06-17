export type AdminSignalTypeMonitorItemApi = {
  tenantId: string;
  tenantName: string | null;
  matrix: Record<string, Record<string, number>>;
  distribution7d: Record<string, number>;
  calculatedAt: string | null;
  updatedAt: string;
};

export type AdminSignalTypeMonitorListApi = {
  items: AdminSignalTypeMonitorItemApi[];
};

export type AdminSignalTypeMonitorItemDomain = {
  tenantId: string;
  tenantName: string | null;
  matrix: Record<string, Record<string, number>>;
  distribution7d: Record<string, number>;
  calculatedAt: Date | null;
  updatedAt: Date;
};

export function adminSignalTypeMonitorItemFromApi(
  api: AdminSignalTypeMonitorItemApi,
): AdminSignalTypeMonitorItemDomain {
  return {
    tenantId: api.tenantId,
    tenantName: api.tenantName,
    matrix: api.matrix,
    distribution7d: api.distribution7d,
    calculatedAt: api.calculatedAt ? new Date(api.calculatedAt) : null,
    updatedAt: new Date(api.updatedAt),
  };
}
