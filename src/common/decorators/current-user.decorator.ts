import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export interface AuthenticatedUser {
  id: string;
  role: string;
  roles?: string[];
  institutionId: string | null;
  reviewsAllInstitutions?: boolean;
}

// Usage: findAll(@CurrentUser() user: AuthenticatedUser). Populated by
// JwtStrategy.validate() - see modules/auth/jwt.strategy.ts.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
