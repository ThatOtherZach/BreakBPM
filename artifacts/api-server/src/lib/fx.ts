import { logger } from "./logger";

/**
 * USD → CAD foreign-exchange, sourced from the Bank of Canada (the rate the CRA
 * expects for tax filings). Every sale in this app is priced in USD (Stripe
 * `currency: "usd"`, USDC ≈ USD, ETH quoted off an ETH/USD feed), but the
 * accountant's ledger must be in CAD. We fetch the BoC daily USD/CAD rate, FREEZE
 * it onto each sale row at sale time, and store both the source USD amount and
 * the rate used so every CAD figure is reproducible and auditable.
 *
 * Reliability rule: a sale must NEVER fail because an FX lookup failed. Every
 * function here resolves to *some* rate — fresh BoC → last-good cached → env
 * fallback → a hardcoded sane default — and reports which source it used.
 */

/** USD→CAD rate, scaled by 1e6 to keep it an exact integer (1.3712 → 1_371_200). */
export interface UsdCadRate {
  rateMicros: number;
  /** BoC observation date (YYYY-MM-DD), or the as-of date for a fallback. */
  rateDate: string;
  source: "bank_of_canada" | "fallback";
}

const RATE_SCALE = 1_000_000;
/** Last-resort rate if BoC is unreachable and no env override is set. */
const HARDCODED_FALLBACK_MICROS = 1_370_000; // ~1.37 USD→CAD
/** Re-fetch "today" at most this often; BoC publishes once per business day. */
const TODAY_TTL_MS = 60 * 60 * 1000; // 1h
const BOC_BASE = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";

interface BocObservation {
  d: string;
  FXUSDCAD?: { v?: string };
}
interface BocResponse {
  observations?: BocObservation[];
}

/** In-memory cache of today's rate (TTL) + the most recent good rate seen. */
let todayCache: { at: number; rate: UsdCadRate } | null = null;
let lastGoodRate: UsdCadRate | null = null;
/** Historical rates by requested date (immutable once known). */
const historicalCache = new Map<string, UsdCadRate>();

/** Convert a USD amount in cents to CAD cents using a scaled rate. Pure. */
export function convertUsdToCad(usdCents: number, rateMicros: number): number {
  return Math.round((usdCents * rateMicros) / RATE_SCALE);
}

/** YYYY-MM-DD for a Date in UTC (matches BoC observation keys). */
function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a decimal rate string ("1.3712") into scaled micros, or null. */
function parseRateMicros(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * RATE_SCALE);
}

/** Pick the latest observation with a usable value from a BoC payload. */
function latestUsable(
  observations: BocObservation[],
): { rateMicros: number; rateDate: string } | null {
  // BoC returns ascending by date; walk from the end for the most recent.
  for (let i = observations.length - 1; i >= 0; i--) {
    const obs = observations[i];
    const micros = parseRateMicros(obs?.FXUSDCAD?.v);
    if (micros !== null && obs?.d) return { rateMicros: micros, rateDate: obs.d };
  }
  return null;
}

/** The configured/last-good/hardcoded fallback, as-of the given date. */
function fallbackRate(asOf: string): UsdCadRate {
  if (lastGoodRate) {
    return { ...lastGoodRate, source: "fallback", rateDate: lastGoodRate.rateDate };
  }
  const envMicros = parseRateMicros(process.env.BREAKBPM_USD_CAD_FALLBACK_RATE);
  return {
    rateMicros: envMicros ?? HARDCODED_FALLBACK_MICROS,
    rateDate: asOf,
    source: "fallback",
  };
}

async function fetchBoc(url: string): Promise<BocObservation[] | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "BoC FX fetch non-2xx");
      return null;
    }
    const body = (await res.json()) as BocResponse;
    return body.observations ?? [];
  } catch (err) {
    logger.warn({ url, err }, "BoC FX fetch failed");
    return null;
  }
}

/**
 * Today's USD→CAD rate (cached, TTL). Used by live sale-recording paths. Always
 * resolves — on any failure it returns the last-good/env/hardcoded fallback.
 */
export async function getUsdToCadRate(): Promise<UsdCadRate> {
  const now = Date.now();
  if (todayCache && now - todayCache.at < TODAY_TTL_MS) return todayCache.rate;

  const observations = await fetchBoc(`${BOC_BASE}?recent=1`);
  const picked = observations ? latestUsable(observations) : null;
  if (picked) {
    const rate: UsdCadRate = { ...picked, source: "bank_of_canada" };
    todayCache = { at: now, rate };
    lastGoodRate = rate;
    return rate;
  }
  return fallbackRate(ymdUtc(new Date()));
}

/**
 * The USD→CAD rate as of a PAST date (for the back-fill). BoC only publishes on
 * business days, so we request a short trailing window and take the most recent
 * observation on or before the target date. Cached per target date.
 */
export async function getUsdToCadRateForDate(date: Date): Promise<UsdCadRate> {
  const target = ymdUtc(date);
  const cached = historicalCache.get(target);
  if (cached) return cached;

  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - 7); // cover weekends/holidays
  const url = `${BOC_BASE}?start_date=${ymdUtc(start)}&end_date=${target}`;
  const observations = await fetchBoc(url);
  const picked = observations ? latestUsable(observations) : null;
  const rate: UsdCadRate = picked
    ? { ...picked, source: "bank_of_canada" }
    : fallbackRate(target);
  historicalCache.set(target, rate);
  if (picked) lastGoodRate = rate;
  return rate;
}
