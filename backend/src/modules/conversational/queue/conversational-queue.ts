export const CONVERSATIONAL_SEND_QUEUE = 'conversational.send';

export interface ConversationalSendJobData {
  deliveryId: string;
  attempt: number;
}
