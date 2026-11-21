import { describe, expect, it } from "vitest";
import { isFolderType } from "../../src/lib/folders";

describe("folder selectors", () => {
  it("accepts system folder names", () => {
    for (const type of ["INBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH", "CUSTOM"]) {
      expect(isFolderType(type), type).toBe(true);
    }
  });

  it("rejects database ids and unknown names", () => {
    for (const value of [
      "cmwo8kvx900cnojq6jy72tzen",
      "inbox",
      "ALL",
      "STARRED",
      "",
    ]) {
      expect(isFolderType(value), value).toBe(false);
    }
  });
});
