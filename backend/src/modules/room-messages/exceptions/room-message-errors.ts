import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Доменные исключения room-chat. Маппинг на HTTP делает Nest по типу
 * (Forbidden → 403, BadRequest → 400). `code` в payload — для фронта.
 */

export class NotMeetingParticipantError extends ForbiddenException {
  constructor() {
    super({
      ok: false,
      error: {
        code: 'not_participant',
        message: 'Вы не являетесь участником этой встречи',
      },
    });
  }
}

export class ClientMessageIdCollisionError extends BadRequestException {
  constructor() {
    super({
      ok: false,
      error: {
        code: 'client_message_id_collision',
        message: 'clientMessageId уже использован для другой встречи',
      },
    });
  }
}

export class RoomMessageTooLongError extends BadRequestException {
  constructor(maxChars: number) {
    super({
      ok: false,
      error: {
        code: 'room_message_too_long',
        message: `Сообщение длиннее ${maxChars} символов`,
      },
    });
  }
}
