import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateLearningLogEntryDto } from "@/modules/learning-log/dto/create-learning-log-entry.dto";
import { LearningLogService } from "@/modules/learning-log/learning-log.service";
import { statusProblem } from "@/modules/learning-log/learning-log-status";
import { toLearningLogEntry } from "@/modules/learning-log/learning-log.mappers";

jest.setTimeout(30000);

const base = { title: "A useful title", area: "data-governance", reviewCycle: "Q4 2026 review" };
const problemsOf = async (plain: object) =>
  (await validate(plainToInstance(CreateLearningLogEntryDto, plain))).flatMap((error) => Object.values(error.constraints ?? {}));

describe("what a decision needs", () => {
  it("is the default and needs a decision and a rationale", async () => {
    const problems = await problemsOf({ ...base, status: "proposed" });
    expect(problems).toEqual(expect.arrayContaining(["Describe what was decided or proposed", "Describe why"]));
  });

  it("is accepted with both", async () => {
    expect(
      await problemsOf({ ...base, status: "decided", entryType: "decision", decision: "Split the KPI in two", rationale: "It mixed two measures" }),
    ).toEqual([]);
  });
});

describe("what a learning needs", () => {
  it("needs what happened and what was learned, not a decision", async () => {
    const problems = await problemsOf({ ...base, entryType: "learning", status: "captured" });
    expect(problems).toEqual(expect.arrayContaining(["Describe what happened", "Describe what was learned"]));
    expect(problems).not.toContain("Describe what was decided or proposed");
  });

  it("is accepted with context and lesson, and the extras stay optional", async () => {
    expect(
      await problemsOf({ ...base, entryType: "learning", status: "captured", context: "Two DisCos sent late files", lesson: "Late files delay the roll-up" }),
    ).toEqual([]);
  });
});

describe("which statuses fit each kind of entry", () => {
  it("lets a decision be proposed, decided or superseded", () => {
    for (const status of ["PROPOSED", "DECIDED", "SUPERSEDED"] as const) expect(statusProblem("DECISION", status)).toBeNull();
  });

  it("lets a learning be captured, applied or superseded", () => {
    for (const status of ["CAPTURED", "APPLIED", "SUPERSEDED"] as const) expect(statusProblem("LEARNING", status)).toBeNull();
  });

  it("refuses a status from the other kind", () => {
    expect(statusProblem("DECISION", "CAPTURED")).toMatch(/decision cannot have the status captured/);
    expect(statusProblem("LEARNING", "DECIDED")).toMatch(/learning cannot have the status decided/);
  });
});

describe("saving entries", () => {
  function build(existing: object | null = null) {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "e1",
      decidedAt: new Date("2026-10-20T00:00:00Z"),
      decidedBy: { fullName: "Admin" },
      relatedRecord: null,
      ...data,
    }));
    const update = jest.fn();
    const prisma = { learningLogEntry: { create, update, findUnique: jest.fn().mockResolvedValue(existing), findMany: jest.fn().mockResolvedValue([]) } };
    return { service: new LearningLogService(prisma as never), create, update, findMany: prisma.learningLogEntry.findMany };
  }
  const user = { id: "u1" } as never;

  it("stores a learning with its own fields and leaves the decision fields empty", async () => {
    const { service, create } = build();
    await service.create(user, {
      ...base,
      entryType: "LEARNING",
      area: "DATA_GOVERNANCE",
      status: "CAPTURED",
      context: " Two DisCos sent late files ",
      lesson: "Late files delay the roll-up",
      recommendation: "Set an earlier cut-off",
    } as never);
    expect(create.mock.calls[0][0].data).toMatchObject({
      entryType: "LEARNING",
      context: "Two DisCos sent late files",
      lesson: "Late files delay the roll-up",
      recommendation: "Set an earlier cut-off",
      decision: "",
      rationale: "",
    });
  });

  it("refuses a learning that is marked decided", async () => {
    const { service, create } = build();
    await expect(
      service.create(user, { ...base, entryType: "LEARNING", area: "OTHER", status: "DECIDED", context: "x".repeat(12), lesson: "y".repeat(12) } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it("treats an entry with no type as a decision, as before", async () => {
    const { service, create } = build();
    await service.create(user, { ...base, area: "OTHER", status: "PROPOSED", decision: "d".repeat(12), rationale: "r".repeat(12) } as never);
    expect(create.mock.calls[0][0].data.entryType).toBe("DECISION");
  });

  it("checks a status change against the entry's own type", async () => {
    const { service, update } = build({ id: "e1", entryType: "LEARNING" });
    await expect(service.update("e1", { status: "DECIDED" } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("filters the list by kind", async () => {
    const { service, findMany } = build();
    await service.getOverview({ entryType: "learning" } as never);
    expect(findMany.mock.calls[0][0].where).toEqual({ entryType: "LEARNING" });
    await service.getOverview({} as never);
    expect(findMany.mock.calls[1][0].where).toEqual({});
  });
});

describe("what the list shows", () => {
  it("reports the kind and the learning fields", () => {
    const entry = toLearningLogEntry({
      id: "e1",
      title: "t",
      area: "DATA_GOVERNANCE",
      entryType: "LEARNING",
      decision: "",
      rationale: "",
      context: "c",
      lesson: "l",
      recommendation: "r",
      evidence: "ev",
      relatedRecord: null,
      reviewCycle: "Q4",
      status: "CAPTURED",
      decidedAt: new Date("2026-10-20T00:00:00Z"),
      decidedBy: { fullName: "Admin" },
    } as never);
    expect(entry).toMatchObject({ entryType: "learning", status: "captured", lesson: "l", evidence: "ev" });
  });
});
