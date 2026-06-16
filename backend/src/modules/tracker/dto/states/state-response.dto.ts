export interface StateResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  category: string;
  sequence: number;
  isDefault: boolean;
}

export interface ListStatesResponse {
  items: StateResponseDto[];
  total: number;
}
