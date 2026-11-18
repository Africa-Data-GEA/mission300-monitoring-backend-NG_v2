import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service";

const LIST_LIMIT = 20;

export const AWAITING_REVIEW_TITLE = "Submission awaiting review";

export function awaitingReviewLink(submissionId: string) {
  return `/data-submissions/validation/${submissionId}`;
}

@Injectable()
export class NotificationsFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return { items, unreadCount };
  }

  async markRead(userId: string, id: string) {
    const existing = await this.prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException("Notification not found.");
    }
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { count };
  }

  async resolveAwaitingReview(submissionId: string, title: string, description: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { title: AWAITING_REVIEW_TITLE, link: awaitingReviewLink(submissionId) },
      data: { title, description, read: true },
    });
    return { count };
  }

  async create(userId: string, title: string, description: string, link: string) {
    return this.prisma.notification.create({ data: { userId, title, description, link } });
  }

  async createMany(userIds: readonly string[], title: string, description: string, link: string) {
    if (!userIds.length) return;
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, title, description, link })),
    });
  }
}
