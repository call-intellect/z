import type { IdeaListItemDto } from '../../ideas/dto/ideas.dto';

export interface MyIdeasResponseDto {
  items: IdeaListItemDto[];
}

export interface MyRecognitionDto {
  id: string;
  type: string;
  message: string | null;
  fromPersonName: string | null;
  visibility: string;
  createdAt: string;
}

export interface MyRecognitionsResponseDto {
  items: MyRecognitionDto[];
}
