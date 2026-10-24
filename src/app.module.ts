import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "@/config/env.validation";
import { httpLoggerOptions } from "@/config/logging";
import { PrismaModule } from "@/prisma/prisma.module";
import { RabbitmqModule } from "@/events/rabbitmq.module";
import { StorageModule } from "@/storage/storage.module";
import { EmailModule } from "@/notifications/email/email.module";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { RolesGuard } from "@/common/guards/roles.guard";
import { AuditLogInterceptor } from "@/common/interceptors/audit-log.interceptor";

import { AuthModule } from "@/modules/auth/auth.module";
import { HealthModule } from "@/modules/health/health.module";
import { InstitutionsModule } from "@/modules/institutions/institutions.module";
import { ProgramsModule } from "@/modules/programs/programs.module";
import { FiltersModule } from "@/modules/filters/filters.module";
import { SearchModule } from "@/modules/search/search.module";
import { BottlenecksModule } from "@/modules/bottlenecks/bottlenecks.module";
import { ReportsModule } from "@/modules/reports/reports.module";
import { StakeholdersModule } from "@/modules/stakeholders/stakeholders.module";
import { AdministrationModule } from "@/modules/administration/administration.module";
import { NotificationsModule } from "@/notifications/notifications.module";
import { FilesModule } from "@/files/files.module";
import { ProfileModule } from "@/modules/profile/profile.module";
import { DataSubmissionsModule } from "@/modules/data-submissions/data-submissions.module";
import { KpiExplorerModule } from "@/modules/kpi-explorer/kpi-explorer.module";
import { ExecutiveOverviewModule } from "@/modules/executive-overview/executive-overview.module";
import { PillarDashboardModule } from "@/modules/pillar-dashboard/pillar-dashboard.module";
import { StateDiscoModule } from "@/modules/state-disco/state-disco.module";
import { LearningLogModule } from "@/modules/learning-log/learning-log.module";
import { ReformActionsModule } from "@/modules/reform-actions/reform-actions.module";
import { PublicOverviewModule } from "@/modules/public-overview/public-overview.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? "development"}`],
      validate: validateEnv,
    }),
    // Generous global default (a safety net against runaway/scripted
    // traffic across the whole API) - the sensitive auth endpoints
    // (identify/login) carry their own much stricter @Throttle() override,
    // see auth.controller.ts. See WEB-007 in the audit report.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    LoggerModule.forRoot({
      pinoHttp: httpLoggerOptions(),
    }),
    PrismaModule,
    RabbitmqModule,
    StorageModule,
    EmailModule,

    AuthModule,
    HealthModule,
    InstitutionsModule,
    ProgramsModule,
    FiltersModule,
    SearchModule,
    BottlenecksModule,
    ReportsModule,
    StakeholdersModule,
    AdministrationModule,
    NotificationsModule,
    FilesModule,
    ProfileModule,
    DataSubmissionsModule,
    KpiExplorerModule,
    ExecutiveOverviewModule,
    PillarDashboardModule,
    StateDiscoModule,
    LearningLogModule,
    ReformActionsModule,
    PublicOverviewModule,
  ],
  providers: [
    // Rate limiting runs first, before auth is even checked - an
    // unauthenticated brute-force attempt should be throttled too.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Every route requires a valid JWT unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Then, if a route carries @Roles(...), the caller's role must match.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Auto-logs any route tagged @AuditAction(...) to audit_log_entries.
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
