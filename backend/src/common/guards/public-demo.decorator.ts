import { SetMetadata } from '@nestjs/common';

export const PUBLIC_DEMO_KEY = 'public_demo';

export const PublicDemo = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_DEMO_KEY, true);
