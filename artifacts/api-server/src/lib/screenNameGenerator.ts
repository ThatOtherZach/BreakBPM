import { eq } from "drizzle-orm";
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

function mmyy(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  return `${mm}${yy}`;
}

/** Build one candidate name: ColourAdjectiveNounMMYY. */
export function generateScreenName(now: Date = new Date()): string {
  return `${pick(COLOURS)}${pick(ADJECTIVES)}${pick(NOUNS)}${mmyy(now)}`;
}

async function isTaken(name: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.screenName, name))
    .limit(1);
  return !!hit;
}

/**
 * Reroll until we find a screenName not already used. After MAX_TRIES,
 * append a 2-digit numeric suffix to a fresh candidate as the last resort.
 */
export async function generateUniqueScreenName(now: Date = new Date()): Promise<string> {
  const MAX_TRIES = 8;
  for (let i = 0; i < MAX_TRIES; i++) {
    const candidate = generateScreenName(now);
    if (!(await isTaken(candidate))) return candidate;
  }
  // Last-resort suffix loop. Bounded so we never loop forever.
  const base = generateScreenName(now);
  for (let n = 1; n < 100; n++) {
    const suffix = String(n).padStart(2, "0");
    const candidate = `${base}${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Astronomically unlikely; fall back to a timestamp tail.
  return `${base}${Date.now().toString(36).slice(-4)}`;
}
