import { DataSubmissionsService } from "@/modules/data-submissions/data-submissions.service";

jest.setTimeout(60000);

function build(institutionReviewers: object[], platformReviewers: object[]) {
  const findMany = jest.fn(async ({ where }: { where: { reviewsAllInstitutions?: boolean } }) =>
    where.reviewsAllInstitutions ? platformReviewers : institutionReviewers,
  );
  const prisma = { user: { findMany } };
  const security = { get: jest.fn().mockResolvedValue({ allowSelfReview: false }) };
  const service = new DataSubmissionsService(prisma as never, {} as never, {} as never, security as never);
  const pick = (submitter: string, institution: string) =>
    (service as unknown as { pickReviewer: (a: string, b: string) => Promise<string | null> }).pickReviewer(submitter, institution);
  return { pick, findMany };
}

const reviewer = (id: string, pending: number) => ({ id, _count: { reviewingSubmissions: pending } });

describe("who a new submission is assigned to", () => {
  it("prefers the least busy reviewer from the submitter's own institution", async () => {
    const { pick, findMany } = build([reviewer("a", 3), reviewer("b", 1)], [reviewer("p", 0)]);
    expect(await pick("sub", "inst")).toBe("b");
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("falls back to the least busy platform-wide reviewer when the institution has none", async () => {
    const { pick } = build([], [reviewer("p1", 4), reviewer("p2", 2)]);
    expect(await pick("sub", "inst")).toBe("p2");
  });

  it("assigns nobody when there is no reviewer at all", async () => {
    const { pick } = build([], []);
    expect(await pick("sub", "inst")).toBeNull();
  });

  it("never picks the submitter when self-review is off", async () => {
    const { pick, findMany } = build([], []);
    await pick("sub-1", "inst");
    expect(findMany.mock.calls[1][0].where).toMatchObject({ reviewsAllInstitutions: true, id: { not: "sub-1" } });
  });
});
