import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { institutionStatus } from "@/modules/stakeholders/institution-status";
import { CANONICAL_INSTITUTIONS, normalizeInstitutionToken, resolveInstitutionSources } from "@/common/institutions/institution-alias";
import { PrismaService } from "@/prisma/prisma.service";
import type { StakeholdersQueryDto } from "@/modules/stakeholders/dto/stakeholders-query.dto";
import type {
  CreateDataCustodianDto,
  UpdateDataCustodianDto,
} from "@/modules/stakeholders/dto/upsert-data-custodian.dto";
import type {
  CreateInstitutionDto,
  UpdateInstitutionDto,
} from "@/modules/stakeholders/dto/upsert-institution.dto";

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMINISTRATOR: "System Administrator",
  INSTITUTIONAL_DATA_PROVIDER: "Institutional Data Provider",
  DATA_REVIEWER: "Data Reviewer",
  VALIDATOR: "Validator",
  DASHBOARD_MANAGER: "Dashboard Manager",
  OVERSIGHT_USER: "Oversight User",
  READ_ONLY_USER: "Read-Only User",
};

const INSTITUTION_INCLUDE = {
  users: true,
  ownedDatasets: true,
  obligations: { include: { dataset: true } },
} as const;

function toInstitutionType(rawType: string): string {
  const value = rawType.toLowerCase();
  if (value.includes("disco") || value.includes("distribution")) return "disco";
  if (value.includes("regulator")) return "regulator";
  if (value.includes("ministry")) return "ministry";
  if (value.includes("agency")) return "agency";
  if (value.includes("utility") || value.includes("genco") || value.includes("transmission")) return "utility";
  if (value.includes("programme") || value.includes("program") || value.includes("pmu")) return "programme-team";
  if (value.includes("federal") || value.includes("government")) return "agency";
  return "partner";
}

function toShortName(name: string): string {
  const bracketed = /\(([^)]{2,12})\)\s*$/.exec(name.trim());
  if (bracketed) return bracketed[1];

  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^(of|the|and|for|ltd|plc)$/i.test(word));
  if (words.length >= 2) return words.map((word) => word[0]!.toUpperCase()).join("");
  return name.trim();
}

type InstitutionWithRelations = {
  id: string;
  name: string;
  type: string;
  updatedAt: Date;
  users: { role: string; status: string }[];
  ownedDatasets: { name: string }[];
  obligations: { dataset: { name: string } }[];
};


const withAll = (label: string, options: { value: string; label: string }[]) => [
  { value: "all", label: `All ${label}` },
  ...options,
];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))].sort((a, b) => a.localeCompare(b));
}

@Injectable()
export class StakeholdersService {
  constructor(private readonly prisma: PrismaService) {}

  findInstitutions() {
    return this.prisma.institution.findMany();
  }

  private async assertUniqueInstitutionName(name: string, exceptId?: string) {
    const trimmed = name.trim();
    const others = await this.prisma.institution.findMany({
      where: exceptId ? { id: { not: exceptId } } : {},
      select: { id: true, name: true },
    });
    const token = normalizeInstitutionToken(trimmed);
    const resolved = resolveInstitutionSources(trimmed);
    const canonicalId = resolved.slugs.length === 1 && resolved.unresolved.length === 0 ? CANONICAL_INSTITUTIONS[resolved.slugs[0]].id : null;
    const duplicate = others.find(
      (other) =>
        other.name.trim().toLowerCase() === trimmed.toLowerCase() ||
        normalizeInstitutionToken(other.name) === token ||
        (canonicalId !== null && other.id === canonicalId),
    );
    if (duplicate) {
      throw new ConflictException(`An institution named ${trimmed} already exists as ${duplicate.name}.`);
    }
  }

  async createInstitution(dto: CreateInstitutionDto) {
    await this.assertUniqueInstitutionName(dto.name);
    const institution = await this.prisma.institution.create({
      data: { name: dto.name.trim(), type: dto.type.trim() },
    });
    return { institution, message: `${institution.name} added.` };
  }

  async updateInstitution(id: string, dto: UpdateInstitutionDto) {
    const existing = await this.prisma.institution.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Unknown institution.");

    const newName = dto.name?.trim();
    const renamed = newName !== undefined && newName !== existing.name;
    if (renamed) await this.assertUniqueInstitutionName(newName, id);

    const requestedType = dto.type?.trim();
    const typeChanged =
      requestedType !== undefined &&
      requestedType !== existing.type &&
      toInstitutionType(requestedType) !== toInstitutionType(existing.type);

    const institution = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.institution.update({
        where: { id },
        data: { ...(renamed ? { name: newName } : {}), ...(typeChanged ? { type: requestedType } : {}) },
      });
      if (renamed) await this.renameStoredInstitutionName(tx, existing.name, newName);
      return updated;
    });
    return { institution, message: `${institution.name} updated.` };
  }

  private async renameStoredInstitutionName(tx: Prisma.TransactionClient, from: string, to: string) {
    const exact = { equals: from, mode: "insensitive" as const };
    await tx.kpiDefinition.updateMany({ where: { sourceInstitution: exact }, data: { sourceInstitution: to } });
    await tx.bottleneck.updateMany({ where: { institution: exact }, data: { institution: to } });
    await tx.escalation.updateMany({ where: { owner: exact }, data: { owner: to } });
    await tx.programme.updateMany({ where: { leadInstitution: exact }, data: { leadInstitution: to } });
    await tx.project.updateMany({ where: { owner: exact }, data: { owner: to } });
    await tx.milestone.updateMany({ where: { leadInstitution: exact }, data: { leadInstitution: to } });
    await tx.scopeAssignment.updateMany({ where: { level: "INSTITUTION", scope: exact }, data: { scope: to } });

    const programmes = await tx.programme.findMany({
      where: { supportingInstitutions: { has: from } },
      select: { id: true, supportingInstitutions: true },
    });
    for (const programme of programmes) {
      await tx.programme.update({
        where: { id: programme.id },
        data: { supportingInstitutions: programme.supportingInstitutions.map((name) => (name === from ? to : name)) },
      });
    }
  }

  async deleteInstitution(id: string) {
    const existing = await this.prisma.institution.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            submissions: true,
            dataCustodians: true,
            ownedDatasets: true,
            obligations: true,
            kpiSources: true,
            ledProgrammes: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Unknown institution.");

    const relatedRecords = Object.values(existing._count).reduce((sum, count) => sum + count, 0);
    if (relatedRecords > 0) {
      throw new ConflictException(
        `${existing.name} cannot be removed while it has users, datasets, submissions, assignments, or delivery records.`,
      );
    }

    await this.prisma.institution.delete({ where: { id } });
    return { message: `${existing.name} removed.` };
  }

  findDataCustodians() {
    return this.prisma.dataCustodian.findMany({ include: { institution: true } });
  }

  async createDataCustodian(dto: CreateDataCustodianDto) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: dto.institutionId },
      select: { id: true, name: true },
    });
    if (!institution) throw new NotFoundException("Unknown institution.");

    const email = dto.contactEmail.trim().toLowerCase();
    const duplicate = await this.prisma.dataCustodian.findFirst({
      where: { institutionId: institution.id, contactEmail: email },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(`${email} is already a data custodian for ${institution.name}.`);
    }

    const custodian = await this.prisma.dataCustodian.create({
      data: {
        institutionId: institution.id,
        contactName: dto.contactName.trim(),
        contactEmail: email,
        scope: dto.scope.trim(),
      },
      include: { institution: true },
    });

    return { custodian, message: `${custodian.contactName} added as a data custodian for ${institution.name}.` };
  }

  async updateDataCustodian(id: string, dto: UpdateDataCustodianDto) {
    const existing = await this.prisma.dataCustodian.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Unknown data custodian.");

    const email = dto.contactEmail?.trim().toLowerCase();
    if (email && email !== existing.contactEmail) {
      const duplicate = await this.prisma.dataCustodian.findFirst({
        where: { institutionId: existing.institutionId, contactEmail: email, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException(`${email} is already a data custodian for this institution.`);
    }

    const custodian = await this.prisma.dataCustodian.update({
      where: { id },
      data: {
        contactName: dto.contactName?.trim(),
        contactEmail: email,
        scope: dto.scope?.trim(),
      },
      include: { institution: true },
    });

    return { custodian, message: `${custodian.contactName} updated.` };
  }

  async deleteDataCustodian(id: string) {
    const existing = await this.prisma.dataCustodian.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Unknown data custodian.");

    await this.prisma.dataCustodian.delete({ where: { id } });
    return { message: `${existing.contactName} removed as a data custodian.` };
  }

  async getOverview(query: StakeholdersQueryDto) {
    const [institutionRows, custodianRows, programmes, datasets, kpis, approvedSubmissions, publishedValues, performanceRecords] = await Promise.all([
      this.prisma.institution.findMany({ include: INSTITUTION_INCLUDE, orderBy: { name: "asc" } }),
      this.prisma.dataCustodian.findMany({ include: { institution: true } }),
      this.prisma.programme.findMany({ select: { name: true, leadInstitution: true } }),
      this.prisma.dataset.findMany({ select: { name: true, frequency: true, templateFileName: true } }),
      this.prisma.kpiDefinition.findMany({ select: { code: true, name: true }, orderBy: { code: "asc" } }),
      this.prisma.submission.groupBy({
        by: ["institutionId"],
        where: { status: { in: ["APPROVED", "PROVISIONALLY_APPROVED"] } },
      }),
      this.prisma.kpiValue.groupBy({ by: ["institutionId"] }),
      this.prisma.discoPerformanceRecord.groupBy({ by: ["institutionId"] }),
    ]);
    const institutionsWithData = new Set([
      ...approvedSubmissions.map((row) => row.institutionId),
      ...publishedValues.map((row) => row.institutionId),
      ...performanceRecords.map((row) => row.institutionId),
    ]);

    const datasetsByName = new Map(datasets.map((dataset) => [dataset.name, dataset]));

    const institutions = institutionRows.map((institution) => {
      const roles = uniqueSorted(
        institution.users.flatMap((user) => (user.roles.length ? user.roles : [user.role]).map((role) => ROLE_LABELS[role] ?? role)),
      );
      const institutionDatasets = uniqueSorted([
        ...institution.ownedDatasets.map((dataset) => dataset.name),
        ...institution.obligations.map((obligation) => obligation.dataset.name),
      ]);
      const institutionProgrammes = uniqueSorted(
        programmes
          .filter((programme) => programme.leadInstitution.trim() === institution.name.trim())
          .map((programme) => programme.name),
      );

      return {
        id: institution.id,
        name: institution.name,
        shortName: toShortName(institution.name),
        type: toInstitutionType(institution.type),
        status: institutionStatus({
          userStatuses: institution.users.map((user) => user.status),
          hasApprovedData: institutionsWithData.has(institution.id),
          datasetOrObligationCount: institution.ownedDatasets.length + institution.obligations.length,
        }),
        coverage: "Not specified",
        roles: roles.length > 0 ? roles : ["No platform user assigned"],
        datasets: institutionDatasets,
        programmes: institutionProgrammes,
        lastUpdated: institution.updatedAt.toISOString(),
      };
    });

    const custodians = custodianRows.map((custodian) => {
      const dataset = datasetsByName.get(custodian.scope);
      return {
        id: custodian.id,
        institutionId: custodian.institutionId,
        dataset: custodian.scope,
        custodian: custodian.institution.name,
        focalPerson: custodian.contactName,
        contactEmail: custodian.contactEmail,
        frequency: dataset?.frequency ?? "Not specified",
        template: dataset?.templateFileName ?? "Not specified",
        reviewer: "Unassigned",
        validator: "Unassigned",
        status: "active",
      };
    });

    const search = query.search?.trim().toLowerCase() ?? "";
    const filtered = institutions.filter((institution) => {
      if (query.institutionType && query.institutionType !== "all" && institution.type !== query.institutionType) {
        return false;
      }
      if (query.status && query.status !== "all" && institution.status !== query.status) return false;
      if (query.role && query.role !== "all" && !institution.roles.includes(query.role)) return false;
      if (query.dataset && query.dataset !== "all" && !institution.datasets.includes(query.dataset)) return false;
      if (query.programme && query.programme !== "all" && !institution.programmes.includes(query.programme)) {
        return false;
      }
      if (query.coverage && query.coverage !== "all" && institution.coverage !== query.coverage) return false;
      if (
        search &&
        ![institution.name, institution.shortName, ...institution.roles].join(" ").toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });

    const filteredCustodians = search
      ? custodians.filter((custodian) =>
          [custodian.custodian, custodian.dataset, custodian.focalPerson]
            .join(" ")
            .toLowerCase()
            .includes(search),
        )
      : custodians;

    return {
      summary: {
        activeInstitutions: institutions.filter((institution) => institution.status === "active").length,
        dataCustodians: institutions.filter((institution) => institution.datasets.length > 0).length,
        pendingOnboarding: institutions.filter((institution) => institution.status !== "active").length,
      },
      institutions: filtered,
      custodians: filteredCustodians,
      filters: {
        institutionTypes: withAll(
          "types",
          uniqueSorted(institutions.map((institution) => institution.type)).map((type) => ({
            value: type,
            label: type
              .split("-")
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" "),
          })),
        ),
        roles: withAll(
          "roles",
          uniqueSorted(institutions.flatMap((institution) => institution.roles)).map((role) => ({
            value: role,
            label: role,
          })),
        ),
        statuses: withAll(
          "statuses",
          uniqueSorted(institutions.map((institution) => institution.status)).map((status) => ({
            value: status,
            label: status
              .split("-")
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" "),
          })),
        ),
        datasets: withAll(
          "datasets",
          uniqueSorted(datasets.map((dataset) => dataset.name)).map((name) => ({ value: name, label: name })),
        ),
        kpis: withAll(
          "indicators",
          kpis.map((kpi) => ({ value: kpi.code, label: `${kpi.code} — ${kpi.name}` })),
        ),
        programmes: withAll(
          "programmes",
          uniqueSorted(programmes.map((programme) => programme.name)).map((name) => ({ value: name, label: name })),
        ),
        coverageAreas: withAll(
          "coverage areas",
          uniqueSorted(institutions.map((institution) => institution.coverage)).map((coverage) => ({
            value: coverage,
            label: coverage,
          })),
        ),
      },
      lastUpdated: new Date().toISOString(),
    };
  }
}
