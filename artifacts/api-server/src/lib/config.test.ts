import { afterEach, describe, expect, it } from "vitest";
import { adminEmails, isAdminEmail } from "./config";

const ORIGINAL = process.env.BREAKBPM_ADMIN_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BREAKBPM_ADMIN_EMAILS;
  else process.env.BREAKBPM_ADMIN_EMAILS = ORIGINAL;
});

describe("adminEmails / isAdminEmail", () => {
  it("returns an empty set and never matches when the env var is unset", () => {
    delete process.env.BREAKBPM_ADMIN_EMAILS;
    expect(adminEmails().size).toBe(0);
    expect(isAdminEmail("anyone@example.com")).toBe(false);
  });

  it("parses a comma-separated list, trimming and lowercasing entries", () => {
    process.env.BREAKBPM_ADMIN_EMAILS = " Admin@Example.com , second@Example.com ";
    const set = adminEmails();
    expect(set.has("admin@example.com")).toBe(true);
    expect(set.has("second@example.com")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    process.env.BREAKBPM_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail("ADMIN@example.com")).toBe(true);
    expect(isAdminEmail("  admin@example.com  ")).toBe(true);
    expect(isAdminEmail("other@example.com")).toBe(false);
  });

  it("treats null/undefined/empty as non-admin", () => {
    process.env.BREAKBPM_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("drops empty entries from a sloppy list", () => {
    process.env.BREAKBPM_ADMIN_EMAILS = "admin@example.com,, ,";
    expect(adminEmails().size).toBe(1);
  });
});
