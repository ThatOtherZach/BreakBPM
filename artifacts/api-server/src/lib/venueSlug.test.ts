import { describe, it, expect } from "vitest";
import { slugifyText, buildVenueSlug } from "./venueSlug";

describe("slugifyText", () => {
  it("lowercases and kebab-cases a plain name", () => {
    expect(slugifyText("Sneaky Pete's")).toBe("sneaky-pete-s");
    expect(slugifyText("The Break Room")).toBe("the-break-room");
  });

  it("strips diacritics to ASCII", () => {
    expect(slugifyText("Café Olé")).toBe("cafe-ole");
  });

  it("collapses runs of punctuation/whitespace into a single hyphen", () => {
    expect(slugifyText("Q  &  A --- Billiards")).toBe("q-a-billiards");
  });

  it("trims leading/trailing separators", () => {
    expect(slugifyText("  !!Corner Pocket!!  ")).toBe("corner-pocket");
  });

  it("returns empty string when nothing survives", () => {
    expect(slugifyText("🎱🎱🎱")).toBe("");
    expect(slugifyText("---")).toBe("");
  });
});

describe("buildVenueSlug", () => {
  it("derives the base slug from the name when free", () => {
    expect(buildVenueSlug("Sneaky Pete's", "Portland, US", [])).toBe(
      "sneaky-pete-s",
    );
  });

  it("falls back to 'hall' when the name yields nothing", () => {
    expect(buildVenueSlug("🎱", null, [])).toBe("hall");
  });

  it("appends the city token when the base is taken", () => {
    expect(
      buildVenueSlug("Corner Pocket", "Portland, US", ["corner-pocket"]),
    ).toBe("corner-pocket-portland");
  });

  it("falls back to a numeric suffix when base and city are both taken", () => {
    const taken = ["corner-pocket", "corner-pocket-portland"];
    expect(buildVenueSlug("Corner Pocket", "Portland, US", taken)).toBe(
      "corner-pocket-2",
    );
  });

  it("uses a numeric suffix directly when there is no locality", () => {
    expect(buildVenueSlug("Corner Pocket", null, ["corner-pocket"])).toBe(
      "corner-pocket-2",
    );
  });

  it("keeps incrementing the numeric suffix until free", () => {
    const taken = [
      "corner-pocket",
      "corner-pocket-portland",
      "corner-pocket-2",
      "corner-pocket-3",
    ];
    expect(buildVenueSlug("Corner Pocket", "Portland, US", taken)).toBe(
      "corner-pocket-4",
    );
  });

  it("matches taken slugs case-insensitively", () => {
    expect(buildVenueSlug("Corner Pocket", null, ["CORNER-POCKET"])).toBe(
      "corner-pocket-2",
    );
  });

  it("ignores null/undefined entries in the taken set", () => {
    expect(buildVenueSlug("Corner Pocket", null, [null, undefined])).toBe(
      "corner-pocket",
    );
  });
});
