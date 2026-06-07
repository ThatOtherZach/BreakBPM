import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts logs a warning via pino on invalid odds; stub it so the tests don't
// spin up a real transport and stay quiet on valid input.
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  adminEmails,
  isAdminEmail,
  luckyBreakLifetimeProbability,
} from "./config";
import { LUCKY_BREAK_LIFETIME_PROBABILITY } from "./luckyBreak";

const ORIGINAL = process.env.BREAKBPM_ADMIN_EMAILS;
const ORIGINAL_ODDS = process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BREAKBPM_ADMIN_EMAILS;
  else process.env.BREAKBPM_ADMIN_EMAILS = ORIGINAL;
  if (ORIGINAL_ODDS === undefined)
    delete process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY;
  else process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY = ORIGINAL_ODDS;
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

describe("luckyBreakLifetimeProbability", () => {
  it("defaults to the engine constant when unset or blank", () => {
    delete process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY;
    expect(luckyBreakLifetimeProbability()).toBe(LUCKY_BREAK_LIFETIME_PROBABILITY);
    process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY = "   ";
    expect(luckyBreakLifetimeProbability()).toBe(LUCKY_BREAK_LIFETIME_PROBABILITY);
  });

  it("parses a valid fraction in [0,1], trimming whitespace", () => {
    process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY = " 0.35 ";
    expect(luckyBreakLifetimeProbability()).toBe(0.35);
  });

  it("accepts the inclusive bounds 0 and 1", () => {
    process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY = "0";
    expect(luckyBreakLifetimeProbability()).toBe(0);
    process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY = "1";
    expect(luckyBreakLifetimeProbability()).toBe(1);
  });

  it("falls back to the default on non-numeric, negative, or >1 values", () => {
    for (const bad of ["abc", "-0.1", "1.5", "NaN", "20%"]) {
      process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY = bad;
      expect(luckyBreakLifetimeProbability()).toBe(LUCKY_BREAK_LIFETIME_PROBABILITY);
    }
  });
});
