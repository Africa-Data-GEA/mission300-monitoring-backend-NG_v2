import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@/common/decorators/current-user.decorator";
import { ReformActionsService } from "@/modules/reform-actions/reform-actions.service";
import { summariseReformActions } from "@/modules/reform-actions/reform-actions-summary";

const admin = { id: "u1", role: "SYSTEM_ADMINISTRATOR", roles: [], institutionId: null } as unknown as AuthenticatedUser;

describe("summariseReformActions", () => {
  it("counts priority and other actions by pillar and status", () => {
    const summary = summariseReformActions([
      { pillarSlug: "generation-network", isPriority: true, status: "DELAYED" },
      { pillarSlug: "generation-network", isPriority: false, status: "COMPLETED" },
      { pillarSlug: "last-mile-access", isPriority: false, status: "IN_PROGRESS_ON_TRACK" },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.priorityTotal).toBe(1);
    expect(summary.byPillar).toEqual([
      { pillar: "generation-network", priority: 1, other: 1 },
      { pillar: "last-mile-access", priority: 0, other: 1 },
    ]);
    expect(summary.byStatus.priority.delayed).toBe(1);
    expect(summary.byStatus.other.completed).toBe(1);
    expect(summary.byStatus.other["in-progress-on-track"]).toBe(1);
  });

  it("lists every status even when none are used", () => {
    const summary = summariseReformActions([]);
    expect(Object.keys(summary.byStatus.priority)).toEqual([
      "not-yet-due",
      "in-progress-on-track",
      "in-progress-minor-delays",
      "in-progress-at-risk",
      "delayed",
      "completed",
    ]);
  });
});

function build(existing: { id: string; status: string } | null = { id: "ra-1", status: "DELAYED" }) {
  const tx = {
    reformAction: {
      create: jest.fn().mockResolvedValue({ id: "ra-new" }),
      update: jest.fn().mockResolvedValue({}),
    },
    reformActionStatusChange: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    pillar: { findUnique: jest.fn(async ({ where }: { where: { slug: string } }) => (where.slug === "generation-network" ? { id: "p1" } : null)) },
    programme: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === "prog-1" ? { id: "prog-1" } : null)) },
    reformAction: {
      findUnique: jest.fn(async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        if (!existing || where.id !== existing.id) return null;
        return include ? { ...existing, pillar: { slug: "generation-network" }, programme: null, history: [] , createdAt: new Date(), updatedAt: new Date(), referenceDueDate: null, dueDate: null, completedAt: null, previousStatus: null, isPriority: false, commitment: "c", action: "a", leadInstitution: "", comment: "" } : existing;
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx, service: new ReformActionsService(prisma as never) };
}

describe("ReformActionsService", () => {
  it("records the first status when an action is created", async () => {
    const { tx, service } = build({ id: "ra-new", status: "NOT_YET_DUE" });
    await service.create(admin, { pillar: "generation-network", commitment: "Commitment", action: "Do the reform" });
    expect(tx.reformActionStatusChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reformActionId: "ra-new", fromStatus: null, toStatus: "NOT_YET_DUE", changedById: "u1" }),
    });
  });

  it("refuses an unknown pillar or programme", async () => {
    const { service } = build();
    await expect(service.create(admin, { pillar: "nope", commitment: "Commitment", action: "Do the reform" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(admin, { pillar: "generation-network", commitment: "Commitment", action: "Do the reform", programmeId: "missing" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("keeps the previous status and a history entry when the status changes", async () => {
    const { tx, service } = build();
    await service.update(admin, "ra-1", { status: "COMPLETED" as never, statusNote: "Signed off" });
    expect(tx.reformAction.update).toHaveBeenCalledWith({
      where: { id: "ra-1" },
      data: expect.objectContaining({ status: "COMPLETED", previousStatus: "DELAYED", completedAt: expect.any(Date) }),
    });
    expect(tx.reformActionStatusChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: "DELAYED", toStatus: "COMPLETED", comment: "Signed off" }),
    });
  });

  it("adds no history entry when the status is unchanged", async () => {
    const { tx, service } = build();
    await service.update(admin, "ra-1", { comment: "Update" });
    expect(tx.reformActionStatusChange.create).not.toHaveBeenCalled();
    expect(tx.reformAction.update).toHaveBeenCalledWith({
      where: { id: "ra-1" },
      data: expect.not.objectContaining({ previousStatus: expect.anything() }),
    });
  });

  it("reports an unknown action", async () => {
    const { service } = build(null);
    await expect(service.update(admin, "nope", { comment: "x" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete("nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});
