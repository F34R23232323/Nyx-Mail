import { describe, expect, it } from "vitest";
import { isIgnoredMailbox, protonFolderName, protonLabelName } from "../src/importers/proton";

describe("Proton Bridge mailbox mapping", () => {
  it("maps Label mailboxes to label names", () => {
    expect(protonLabelName("Labels/Work")).toBe("Work");
    expect(protonLabelName("Labels/Projects/NyxMail")).toBe("Projects / NyxMail");
    expect(protonLabelName("Labels/Receipts")).toBe("Receipts");
  });

  it("preserves nested Proton folder names", () => {
    expect(protonFolderName("Folders/Projects")).toBe("Projects");
    expect(protonFolderName("Folders/Projects/NyxMail")).toBe("Projects / NyxMail");
    expect(protonFolderName("Inbox")).toBeNull();
  });

  it("does not treat folders as labels", () => {
    expect(protonLabelName("Folders/Projects")).toBeNull();
    expect(protonLabelName("Inbox")).toBeNull();
    expect(protonLabelName("Labels")).toBeNull();
  });

  it("skips Proton aggregate mailboxes that would duplicate messages", () => {
    expect(isIgnoredMailbox("All Mail", "\\All")).toBe(true);
    expect(isIgnoredMailbox("Starred", "\\Flagged")).toBe(true);
    expect(isIgnoredMailbox("Inbox", "\\Inbox")).toBe(false);
    expect(isIgnoredMailbox("Labels/Work")).toBe(false);
  });
});

import {
  parseProtonLabelsJson,
  parseProtonMetadata,
  resolveProtonExportRoute,
} from "../src/importers/proton-export";

describe("Proton Export Tool metadata", () => {
  const labelsJson = {
    Version: 1,
    Payload: [
      { ID: "0", Name: "Inbox", Path: "Inbox", Type: 1, Color: "#8080FF" },
      { ID: "7", Name: "Sent", Path: "Sent", Type: 1 },
      { ID: "10", Name: "Starred", Path: "Starred", Type: 1 },
      { ID: "folder1", Name: "2024", Path: "Work/2024", Type: 3 },
      { ID: "tag1", Name: "Important", Path: "Important", Type: 1, Color: "#22C55E" },
    ],
  };

  it("parses Proton labels, folders and colors", () => {
    const parsed = parseProtonLabelsJson(labelsJson);
    expect(parsed.find((label) => label.id === "folder1")).toMatchObject({
      path: "Work/2024",
      type: 3,
    });
    expect(parsed.find((label) => label.id === "tag1")?.color).toBe("#22C55E");
  });

  it("parses unread state and starred labels", () => {
    expect(parseProtonMetadata({ Payload: { LabelIDs: ["0", "10"], Unread: 1 } })).toMatchObject({
      labelIds: ["0", "10"],
      unread: true,
    });
    expect(parseProtonMetadata({ Payload: { LabelIDs: [], Unread: 0 } }).unread).toBe(false);
    expect(parseProtonMetadata({ Payload: { LabelIDs: [] } }).unread).toBeNull();
    const map = new Map(parseProtonLabelsJson(labelsJson).map((label) => [label.id, label]));
    const route = resolveProtonExportRoute(["0", "10", "tag1"], map, false);
    expect(route.folderType).toBe("INBOX");
    expect(route.starred).toBe(true);
    expect(route.tags.map((tag) => tag.name)).toEqual(["Important"]);
  });

  it("preserves custom Proton folders over the Inbox fallback", () => {
    const map = new Map(parseProtonLabelsJson(labelsJson).map((label) => [label.id, label]));
    const route = resolveProtonExportRoute(["folder1", "tag1"], map, null);
    expect(route.folderType).toBe("CUSTOM");
    expect(route.folderName).toBe("Work/2024");
    expect(route.tags.map((tag) => tag.name)).toEqual(["Important"]);
    const fallback = resolveProtonExportRoute([], new Map(), null);
    expect(fallback.folderType).toBe("INBOX");
  });
});
