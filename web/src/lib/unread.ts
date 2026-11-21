import type { Prisma } from "@nyxmail/db";

/**
 * Unread messages that the user can actually see right now. Snoozed messages
 * are excluded so the badge always matches what the unread views list.
 */
export function unreadMessageWhere(
  userId: string,
  now: Date = new Date(),
): Prisma.MessageWhereInput {
  return {
    userId,
    isRead: false,
    isDraft: false,
    OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }],
  };
}
