import type { BlockSearchItemDto, EntityItemDto, EvidenceItemDto } from './search.dto';

export interface BlockDetailDto {
  block: BlockSearchItemDto;
  evidence: EvidenceItemDto[];
  entities: EntityItemDto[];
  mergedFrom?: BlockSearchItemDto[];
  redirectedToCanonical?: boolean;
}
