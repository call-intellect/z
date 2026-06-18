import { BadRequestException, ForbiddenException } from '@nestjs/common';

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
