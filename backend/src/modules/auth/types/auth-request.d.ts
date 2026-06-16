declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'user' | 'admin';
        jti?: string;
        livekitIdentity?: string;
        participantId?: string;
        name?: string;
      } | null;
      partner?: {
        id: string;
        partnerName: string;
      };
      idempotencyKey?: string;
      rawBody?: Buffer;
    }
  }
}

export {};
