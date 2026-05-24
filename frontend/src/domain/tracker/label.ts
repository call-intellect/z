/**
 * Доменная модель метки (Label) трекера.
 *
 * Контракт: `backend/src/modules/tracker/services/labels.service.ts`.
 */

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface LabelApi {
  id: string;
  tenantId: string;
  projectId: string | null;
  name: string;
  color: string;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface Label {
  id: string;
  tenantId: string;
  /** null = глобальная (общая на уровне Org). */
  projectId: string | null;
  name: string;
  /** HEX-цвет `#RRGGBB`. */
  color: string;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

export function labelFromApi(api: LabelApi): Label {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    name: api.name,
    color: api.color,
  };
}
