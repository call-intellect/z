import type {
  BlockSearchItemDto,
  EntityItemDto,
  EvidenceItemDto,
} from './search.dto';

/**
 * `GET /api/v1/knowledge/blocks/:id` — деталка блока. Если блок merged_into,
 * controller следует по mergedIntoId один шаг и возвращает canonical, дополняя
 * mergedFrom массивом исходных блоков.
 */
export interface BlockDetailDto {
  block: BlockSearchItemDto;
  evidence: EvidenceItemDto[];
  entities: EntityItemDto[];
  /** Если блок canonical — здесь список его merged_from источников. */
  mergedFrom?: BlockSearchItemDto[];
  /** Если запрашивали merged_into блок и его подменили на canonical — true. */
  redirectedToCanonical?: boolean;
}
