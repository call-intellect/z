export interface MaxSendMessageRequest {
  chat_id?: string | number;
  user_id?: string | number;
  text: string;
}

export interface MaxSendMessageResponse {
  message?: {
    mid?: string;
    timestamp?: number;
  };
}

export interface MaxUser {
  user_id?: number;
  name?: string;
  username?: string;
}

export interface MaxRecipient {
  chat_id?: number;
  user_id?: number;
}

export interface MaxIncomingAttachment {
  type?: string;
  payload?: {
    file_id?: string;
    url?: string;
    duration?: number;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    [k: string]: unknown;
  };
}

export interface MaxMessageBody {
  mid?: string;
  text?: string;
  attachments?: MaxIncomingAttachment[];
}

export interface MaxMessage {
  recipient?: MaxRecipient;
  sender?: MaxUser;
  body?: MaxMessageBody;
  timestamp?: number;
}

export interface MaxUpdate {
  update_type?: string;
  timestamp?: number;
  message?: MaxMessage;
}

export interface MaxBotChannelConfig {
  accessToken: string;
  webhookSecret: string;
  botName?: string;
}
