import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import { AccountStatus, type RoleName } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { RabbitmqService } from "@/events/rabbitmq.service";
import { toUserAccountResponse } from "@/modules/administration/overview/overview.mappers";
import type { InviteUserDto } from "@/modules/administration/users/dto/invite-user.dto";
import type { UpdateUserAccessDto } from "@/modules/administration/users/dto/update-user-access.dto";
import { reviewScopeProblem } from "@/modules/administration/users/review-scope-rules";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitmqService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, fullName: true, role: true, status: true, institutionId: true },
    });
  }

  async invite(dto: InviteUserDto) {
    const roles = dto.roles?.length ? dto.roles : dto.role ? [dto.role] : [];
    if (!roles.length) throw new BadRequestException("Select at least one role.");
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Same endpoint doubles as "resend invite" - the frontend has no
    // separate resend action, it just calls invite again. A PENDING account
    // was never activated, so there's nothing destructive about re-issuing
    // it: refresh the details in case the admin corrected them, and send a
    // fresh set-password link (old one, if any, stays invalid - it's a
    // separate PasswordResetToken row and only the latest one matters).
    // Deliberately more permissive than the mock, which always 409s on any
    // existing email with no resend path at all - explicitly requested.
    if (existing && existing.status !== AccountStatus.PENDING) {
      throw new ConflictException("A user account already exists for that email.");
    }

    const reviewsAll = dto.reviewsAllInstitutions === true;
    const scopeProblem = reviewScopeProblem(roles, dto.institution, reviewsAll);
    if (scopeProblem) throw new BadRequestException(scopeProblem);
    const institution = reviewsAll ? null : await this.resolveInstitution(dto.institution as string);
    const message = `An invitation was sent to ${dto.email}.`;

    if (existing) {
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName: dto.name,
          designation: dto.designation,
          role: roles[0],
          roles,
          institutionId: institution?.id ?? null,
          reviewsAllInstitutions: reviewsAll,
        },
        include: { institution: true },
      });
      await this.rabbitmq.publish("user.invited", { userId: user.id, email: user.email });
      return { user: toUserAccountResponse(user), message };
    }

    // Starts PENDING (schema default) with a random, unusable password -
    // they can't log in until the set-password link (sent via the
    // "user.invited" consumer, see NotificationsConsumer) is redeemed.
    const temporaryPassword = randomBytes(32).toString("hex");
    const passwordHash = await argon2.hash(temporaryPassword);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.name,
        designation: dto.designation,
        role: roles[0],
        roles,
        institutionId: institution?.id ?? null,
        reviewsAllInstitutions: reviewsAll,
        passwordHash,
      },
      include: { institution: true },
    });

    await this.rabbitmq.publish("user.invited", { userId: user.id, email: user.email });

    return { user: toUserAccountResponse(user), message };
  }

  async setStatus(id: string, status: AccountStatus) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { status, tokenVersion: { increment: 1 } },
        include: { institution: true },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return toUserAccountResponse(user);
    });
  }

  async updateRoles(id: string, roles: RoleName[]) {
    if (!roles.length || new Set(roles).size !== roles.length) {
      throw new BadRequestException("Select at least one distinct role.");
    }
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("User account not found.");
    const scopeProblem = reviewScopeProblem(
      roles,
      existing.institutionId ?? (existing.reviewsAllInstitutions ? null : ""),
      existing.reviewsAllInstitutions,
    );
    if (scopeProblem && (existing.reviewsAllInstitutions || existing.institutionId)) {
      throw new BadRequestException(scopeProblem);
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { role: roles[0], roles },
      include: { institution: true },
    });
    return toUserAccountResponse(user);
  }

  async updateInstitution(id: string, institutionName: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("User account not found.");
    const institution = await this.resolveInstitution(institutionName);
    const user = await this.prisma.user.update({
      where: { id },
      data: { institutionId: institution.id, reviewsAllInstitutions: false },
      include: { institution: true },
    });
    return toUserAccountResponse(user);
  }

  async updateAccess(id: string, dto: UpdateUserAccessDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("User account not found.");
    const roles = dto.roles;
    if (!roles.length || new Set(roles).size !== roles.length) {
      throw new BadRequestException("Select at least one distinct role.");
    }
    const reviewsAll = dto.reviewsAllInstitutions === true;
    const problem = reviewScopeProblem(roles, dto.institution, reviewsAll);
    if (problem) throw new BadRequestException(problem);

    const email = dto.email?.trim();
    const emailChanged = email !== undefined && email.toLowerCase() !== existing.email.toLowerCase();
    if (emailChanged) {
      const taken = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" }, id: { not: id } },
        select: { id: true },
      });
      if (taken) throw new ConflictException("A user account already exists for that email.");
    }

    const institution = dto.institution?.trim() ? await this.resolveInstitution(dto.institution) : null;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        role: roles[0],
        roles,
        institutionId: institution?.id ?? null,
        reviewsAllInstitutions: reviewsAll,
        ...(dto.name !== undefined ? { fullName: dto.name.trim() } : {}),
        ...(dto.designation !== undefined ? { designation: dto.designation.trim() } : {}),
        ...(emailChanged ? { email, tokenVersion: { increment: 1 } } : {}),
      },
      include: { institution: true },
    });
    return toUserAccountResponse(user);
  }


  /**
   * "institution" arrives as free text (matches the real contract - see
   * inviteUserRequestSchema), not an id. The invite form now only ever
   * submits a name copied verbatim from GET /institutions (see
   * institutionOptionSchema on the frontend), so this should always find a
   * match - the case-insensitive lookup is a defence against drift (an
   * institution renamed since the form was last loaded, or a client that
   * bypasses the picker) rather than the primary matching path.
   *
   * An exact, case-SENSITIVE match was found to silently create a
   * duplicate, disconnected institution whenever the submitted casing
   * didn't match exactly (e.g. "NERC" against the stored "Nigerian
   * Electricity Regulatory Commission (NERC)") - the new account ended up
   * attached to an empty institution with none of the real one's KPIs,
   * obligations or submission history, while looking like a normal invite.
   * Case-insensitive matching closes that specific gap; it does not fix an
   * institution named differently in substance (e.g. an abbreviation with
   * no shared text at all), which still needs a real create - see the
   * name/institutionId contract note above for why this remains free text.
   */
  private async resolveInstitution(name: string) {
    const trimmed = name.trim();
    const existing = await this.prisma.institution.findFirst({
      where: { name: { equals: trimmed, mode: "insensitive" } },
    });
    if (existing) return existing;
    return this.prisma.institution.create({ data: { name: trimmed, type: "Institution" } });
  }
}
