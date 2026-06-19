import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The generator queries Postgres only to learn which names are already taken
// (case-insensitively, via `lower(screen_name)`). We stub the DB layer with an
// in-memory Set of *lowercased* taken names — exactly the view `lower(...)`
// gives the real queries — so we can exercise the tiered fallback logic
// deterministically without a database.
const { state } = vi.hoisted(() => ({
  state: { taken: new Set<string>() },
}));

// `sql` builds an opaque query fragment in production. Stub it to simply capture
// its interpolated values so the DB mock can read back the queried name/needle.
vi.mock("drizzle-orm", () => ({
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({
    __values: values,
  }),
}));

vi.mock("@workspace/db", () => {
  // Column markers — non-string so the DB mock can pick the queried string out
  // of the captured `sql` interpolations.
  const usersTable = {
    id: { __col: "id" },
    screenName: { __col: "screenName" },
  };
  const db = {
    select() {
      let value: string | undefined;
      const chain = {
        from() {
          return chain;
        },
        where(cond: { __values: unknown[] }) {
          value = cond.__values.find((v) => typeof v === "string") as
            | string
            | undefined;
          return chain;
        },
        // isTaken(): existence check ending in `.limit(1)`. `value` is the exact
        // lowercased candidate.
        limit() {
          return Promise.resolve(
            value !== undefined && state.taken.has(value) ? [{ id: "x" }] : [],
          );
        },
        // takenNamesEndingWith(): the chain is awaited directly (thenable).
        // `value` is a `%<suffix>` LIKE needle.
        then(
          resolve: (rows: { name: string }[]) => unknown,
          reject?: (e: unknown) => unknown,
        ) {
          const suffix = (value ?? "").replace(/^%/, "");
          const rows = [...state.taken]
            .filter((n) => n.endsWith(suffix))
            .map((n) => ({ name: n }));
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db, usersTable };
});

import {
  generateUniqueScreenName,
  ADJECTIVES,
  NOUNS,
  COLOURS,
} from "./screenNameGenerator";

// Fixed clock: June 2026 -> MMYY suffix "0626".
const JUNE_2026 = new Date(2026, 5, 15);
const SUFFIX = "0626";

/** Count capitalized word-starts (== word count, since words are single-cap). */
function wordCount(name: string): number {
  return (name.match(/[A-Z]/g) ?? []).length;
}

function allTwoWord(suffix: string): string[] {
  return ADJECTIVES.flatMap((a) =>
    NOUNS.map((n) => `${a}${n}${suffix}`.toLowerCase()),
  );
}

function allThreeWord(suffix: string): string[] {
  return COLOURS.flatMap((c) =>
    ADJECTIVES.flatMap((a) =>
      NOUNS.map((n) => `${c}${a}${n}${suffix}`.toLowerCase()),
    ),
  );
}

beforeEach(() => {
  state.taken = new Set<string>();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateUniqueScreenName", () => {
  it("returns a two-word Adjective+Noun+MMYY name when the namespace is empty", async () => {
    const name = await generateUniqueScreenName(JUNE_2026);
    expect(name.endsWith(SUFFIX)).toBe(true);
    // Two capitalized words (adjective + noun), no colour prefix, no suffix tail.
    expect(wordCount(name)).toBe(2);
    expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+0626$/);
    expect(state.taken.has(name.toLowerCase())).toBe(false);
  });

  it("escalates to a three-word name once the whole two-word + MMYY space is taken", async () => {
    state.taken = new Set(allTwoWord(SUFFIX));

    const name = await generateUniqueScreenName(JUNE_2026);
    expect(name.endsWith(SUFFIX)).toBe(true);
    // Colour + Adjective + Noun => three capitalized words.
    expect(wordCount(name)).toBe(3);
    expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+[A-Z][a-z]+0626$/);
    // Still a genuinely fresh, uncollided name.
    expect(state.taken.has(name.toLowerCase())).toBe(false);
  });

  it("appends an alphanumeric suffix when both the two- and three-word spaces are exhausted", async () => {
    state.taken = new Set([...allTwoWord(SUFFIX), ...allThreeWord(SUFFIX)]);

    const name = await generateUniqueScreenName(JUNE_2026);
    // Falls through to <twoWordBase><MMYY><base36 tail>, e.g. SwiftShark06260.
    expect(name).toMatch(/0626[0-9a-z]+$/);
    expect(name).not.toMatch(/0626$/); // not a bare two/three-word name
    // Guaranteed unique against every taken name, case-insensitively.
    expect(state.taken.has(name.toLowerCase())).toBe(false);
  });

  it("never returns a name that collides case-insensitively with an existing lower(screen_name)", async () => {
    // Seed a large random slice of the two-word space (stored lowercased, the
    // way `lower(screen_name)` exposes it).
    const everyTwoWord = allTwoWord(SUFFIX);
    state.taken = new Set(
      everyTwoWord.filter(() => Math.random() < 0.4),
    );

    for (let i = 0; i < 100; i++) {
      const name = await generateUniqueScreenName(JUNE_2026);
      // The generator emits TitleCase names; a hit here would mean it failed to
      // compare case-insensitively against the stored lowercase set.
      expect(state.taken.has(name.toLowerCase())).toBe(false);
    }
  });

  it("treats a differently-cased existing name as taken and picks another", async () => {
    // Force the random fast path to always produce "SwiftCue0626".
    vi.spyOn(Math, "random").mockReturnValue(0);
    // Stored as lowercase, as if the DB row were "SwiftCue0626" / "SWIFTCUE0626".
    state.taken = new Set(["swiftcue0626"]);

    const name = await generateUniqueScreenName(JUNE_2026);
    expect(name.toLowerCase()).not.toBe("swiftcue0626");
    expect(state.taken.has(name.toLowerCase())).toBe(false);
    expect(name.endsWith(SUFFIX)).toBe(true);
  });
});
