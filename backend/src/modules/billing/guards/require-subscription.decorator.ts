import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SUBSCRIPTION_KEY = 'requireSubscription';

export const RequireSubscription = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_SUBSCRIPTION_KEY, true);
