export interface LabelApi {
  id: string;
  tenantId: string;
  projectId: string | null;
  name: string;
  color: string;
}

export interface Label {
  id: string;
  tenantId: string;
  projectId: string | null;
  name: string;
  color: string;
}

export function labelFromApi(api: LabelApi): Label {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    name: api.name,
    color: api.color,
  };
}
