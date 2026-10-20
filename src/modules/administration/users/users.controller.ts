import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UsersService } from "@/modules/administration/users/users.service";
import { InviteUserDto } from "@/modules/administration/users/dto/invite-user.dto";
import { SetUserStatusDto } from "@/modules/administration/users/dto/set-user-status.dto";
import { UpdateUserAccessDto } from "@/modules/administration/users/dto/update-user-access.dto";
import { UpdateUserRolesDto } from "@/modules/administration/users/dto/update-user-roles.dto";
import { UpdateUserInstitutionDto } from "@/modules/administration/users/dto/update-user-institution.dto";
import { Roles } from "@/common/decorators/roles.decorator";
import { AuditAction } from "@/common/decorators/audit-action.decorator";

@ApiTags("administration/users")
@ApiBearerAuth()
@Roles("SYSTEM_ADMINISTRATOR")
@Controller("administration/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Post("invite")
  @AuditAction("user.invited")
  invite(@Body() dto: InviteUserDto) {
    return this.users.invite(dto);
  }

  @Patch(":id/status")
  @AuditAction("user.status_changed")
  setStatus(@Param("id") id: string, @Body() dto: SetUserStatusDto) {
    return this.users.setStatus(id, dto.status);
  }

  @Patch(":id/access")
  @AuditAction("user.access_changed")
  updateAccess(@Param("id") id: string, @Body() dto: UpdateUserAccessDto) {
    return this.users.updateAccess(id, dto);
  }

  @Patch(":id/roles")
  @AuditAction("user.roles_changed")
  updateRoles(@Param("id") id: string, @Body() dto: UpdateUserRolesDto) {
    return this.users.updateRoles(id, dto.roles);
  }

  @Patch(":id/institution")
  @AuditAction("user.institution_changed")
  updateInstitution(@Param("id") id: string, @Body() dto: UpdateUserInstitutionDto) {
    return this.users.updateInstitution(id, dto.institution);
  }
}
