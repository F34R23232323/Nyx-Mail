import { describe, expect, it } from "vitest";
import { unreadMessageWhere } from "../../src/lib/unread";

describe("unreadMessageWhere", () => {
  it("matches only visible, non-draft unread messages", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(unreadMessageWhere("user-1", now)).toEqual({
      userId: "user-1",
      isRead: false,
      isDraft: false,
      OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }],
    });
  });

  it("excludes messages snoozed into the future", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const where = unreadMessageWhere("user-1", now);
    const snooze = (where.OR as Array<Record<string, unknown>>)[1] as {
      snoozeUntil: { lte: Date };
    };
    expect(snooze.snoozeUntil.lte.getTime()).toBe(now.getTime());
  });
});
