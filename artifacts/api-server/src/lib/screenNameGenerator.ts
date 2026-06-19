import { sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const COLOURS = [
  "Crimson", "Scarlet", "Ruby", "Coral", "Salmon", "Amber", "Saffron", "Gold",
  "Lemon", "Lime", "Olive", "Emerald", "Mint", "Teal", "Aqua", "Cyan",
  "Azure", "Cobalt", "Navy", "Indigo", "Violet", "Magenta", "Plum", "Orchid",
  "Rose", "Pink", "Maroon", "Sepia", "Bronze", "Copper", "Sienna", "Chestnut",
  "Cocoa", "Mocha", "Tan", "Beige", "Ivory", "Pearl", "Silver", "Slate",
  "Ash", "Charcoal", "Onyx", "Jade", "Sage", "Fern", "Pine", "Lavender",
  "Peach", "Tangerine",
];

const ADJECTIVES = [
  "Swift", "Sly", "Bold", "Brave", "Calm", "Clever", "Crafty", "Cunning",
  "Daring", "Eager", "Fierce", "Gentle", "Grand", "Happy", "Lucky", "Mighty",
  "Nimble", "Noble", "Proud", "Quick", "Quiet", "Rapid", "Royal", "Sharp",
  "Silent", "Sleek", "Smooth", "Sneaky", "Steady", "Stoic", "Strong", "Sunny",
  "Tough", "Vivid", "Wild", "Wise", "Witty", "Zesty", "Lively", "Merry",
  "Jolly", "Frosty", "Stormy", "Breezy", "Cosmic", "Lunar", "Solar", "Mystic",
  "Epic", "Prime",
];

const NOUNS = [
  "Cue", "Break", "Rack", "Pocket", "Bank", "Spin", "Chalk", "Felt",
  "Stripe", "Solid", "Shark", "Hawk", "Fox", "Wolf", "Lion", "Tiger",
  "Bear", "Eagle", "Falcon", "Raven", "Otter", "Lynx", "Panda", "Jaguar",
  "Cobra", "Viper", "Bison", "Stag", "Moose", "Heron", "Comet", "Nova",
  "Pulsar", "Quasar", "Photon", "Proton", "Vector", "Cipher", "Pixel", "Glitch",
  "Echo", "Pulse", "Drift", "Phantom", "Specter", "Mirage", "Oracle", "Sage",
  "Knight", "Rogue",
];

if (COLOURS.length !== 50 || ADJECTIVES.length !== 50 || NOUNS.length !== 50) {
  throw new Error("Screen name word lists must each contain exactly 50 entries");
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mmyy(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  return `${mm}${yy}`;
}

/** Build one candidate name: AdjectiveNounMMYY (the two-word default). */
export function generateScreenName(now: Date = new Date()): string {
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${mmyy(now)}`;
}

/** Build one three-word candidate: ColourAdjectiveNounMMYY (fallback tier). */
function generateThreeWordScreenName(now: Date = new Date()): string {
  return `${pick(COLOURS)}${pick(ADJECTIVES)}${pick(NOUNS)}${mmyy(now)}`;
}

async function isTaken(name: string): Promise<boolean> {
  // Case-insensitive: screen names double as the public /watch/{name} handle
  // and are enforced unique on lower(screen_name).
  const [hit] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.screenName}) = ${name.toLowerCase()}`)
    .limit(1);
  return !!hit;
}

/**
 * Fetch the lowercased set of screen names that end with this month's MMYY
 * suffix in a single query. Bounded by the number of users created that month,
 * so it lets us decide "the two-word space is genuinely full" without one DB
 * round-trip per candidate.
 */
async function takenNamesEndingWith(suffix: string): Promise<Set<string>> {
  const needle = `%${suffix.toLowerCase()}`;
  const rows = await db
    .select({ name: usersTable.screenName })
    .from(usersTable)
    .where(sql`lower(${usersTable.screenName}) like ${needle}`);
  return new Set(rows.map((r) => r.name.toLowerCase()));
}

/**
 * Produce a unique screen name, preferring the shortest namespace:
 *   1. two-word  Adjective + Noun + MMYY              (e.g. SwiftShark0626)
 *   2. three-word Colour + Adjective + Noun + MMYY    (once two-word is full)
 *   3. two-word base + alphanumeric suffix            (guaranteed-unique tail)
 *
 * The two-word space is small (50x50 = 2500/month), so a few random rerolls
 * cover the common case. When those collide we pull the month's taken set once
 * and enumerate the full two-word space (shuffled) before escalating, so we
 * only fall back to longer forms when the short namespace is truly exhausted.
 */
export async function generateUniqueScreenName(now: Date = new Date()): Promise<string> {
  const suffix = mmyy(now);

  // Fast path: a handful of random two-word candidates. One DB check each;
  // the first usually wins.
  const QUICK_TRIES = 8;
  for (let i = 0; i < QUICK_TRIES; i++) {
    const candidate = generateScreenName(now);
    if (!(await isTaken(candidate))) return candidate;
  }

  // The fast path kept colliding. Pull the whole month's taken set once and
  // make all remaining decisions in memory, keeping DB work bounded.
  const taken = await takenNamesEndingWith(suffix);

  // Tier 1: exhaustively try every two-word combination (shuffled for variety).
  const twoWord = shuffle(
    ADJECTIVES.flatMap((adj) => NOUNS.map((noun) => `${adj}${noun}${suffix}`)),
  );
  for (const candidate of twoWord) {
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  // Tier 2: two-word space is full — fall back to three-word. 50^3 = 125k
  // combos, so random tries against the in-memory set find a free name almost
  // immediately without further DB queries.
  const THREE_WORD_TRIES = 10000;
  for (let i = 0; i < THREE_WORD_TRIES; i++) {
    const candidate = generateThreeWordScreenName(now);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  // Tier 3: both word spaces are (astronomically improbably) full. Append an
  // alphanumeric suffix to a two-word base for a guaranteed-unique name.
  const base = generateScreenName(now);
  for (let n = 0; n < 100000; n++) {
    const candidate = `${base}${n.toString(36)}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Unreachable in practice; final timestamp tail.
  return `${base}${Date.now().toString(36)}`;
}
