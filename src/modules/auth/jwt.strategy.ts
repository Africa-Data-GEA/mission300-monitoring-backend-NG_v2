import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AccountStatus } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";

interface JwtPayload {
  sub: string;
  tokenVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_SECRET"),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException("Account is inactive or no longer exists");
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException("Session has been signed out - please log in again");
    }
    return {
      id: user.id,
      role: user.role,
      roles: user.roles.length ? user.roles : [user.role],
      institutionId: user.institutionId,
      reviewsAllInstitutions: user.reviewsAllInstitutions,
    };
  }
}
