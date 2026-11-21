import { describe, expect, it } from "vitest";
import { isLocalOnlySender } from "../src/outbound";

describe("outbound sender checks", () => {
  it("flags development-only domains as local senders", () => {
    for (const address of [
      "demo@localhost",
      "demo@mail.localhost",
      "demo@nyxmail.local",
      "demo@nyxmail.internal",
      "demo@example.test",
      "demo@example.invalid",
      "demo@intranet",
    ]) {
      expect(isLocalOnlySender(address), address).toBe(true);
    }
  });

  it("allows public sender domains", () => {
    for (const address of [
      "person@example.net",
      "person@example.com",
      "person@mail.example.co.uk",
    ]) {
      expect(isLocalOnlySender(address), address).toBe(false);
    }
  });
});
