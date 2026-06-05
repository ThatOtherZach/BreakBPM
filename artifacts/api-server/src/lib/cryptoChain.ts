/**
 * On-chain layer for the self-custody crypto checkout. Everything that talks to
 * Base L2 (network constants, the viem public client, the ETH/USD oracle read,
 * the quote math, and the transaction verifier) lives here so the route handler
 * stays a thin orchestrator.
 *
 * Design notes:
 *   - Amounts are ATOMIC bigints (wei for ETH, 6-dec base units for USDC) and
 *     are compared with `>=` so an overpayment still settles (we never refund).
 *   - A payment is bound to the order's `payerAddress`: the on-chain sender must
 *     match, so a leaked public tx hash can't be replayed against someone
 *     else's order. (Caveat: native-ETH sends from smart-contract wallets, where
 *     tx.from is a bundler/entrypoint rather than the smart account, will not
 *     match — those users should pay with USDC, whose ERC-20 `from` is the
 *     account itself.)
 *   - Network, RPC URL, and the oracle/USDC addresses are env-overridable so the
 *     same code runs on Base Sepolia for testing and Base mainnet in production.
 */

import {
  createPublicClient,
  http,
  getAddress,
  parseAbiItem,
  decodeEventLog,
  recoverMessageAddress,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { CryptoAsset, CryptoNetwork } from "@workspace/db";

export interface NetworkConfig {
  network: CryptoNetwork;
  chainId: number;
  usdcAddress: `0x${string}`;
  usdcDecimals: number;
  ethUsdFeed: `0x${string}`;
  rpcUrl: string;
}

/** Circle-issued USDC on each network. */
const USDC: Record<CryptoNetwork, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

/** Chainlink ETH/USD price feeds. Overridable via env if Chainlink moves them. */
const ETH_USD_FEED: Record<CryptoNetwork, `0x${string}`> = {
  base: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  "base-sepolia": "0x4aDC67696bA383F43DD60A9e78F2C97FbbFc7cb1",
};

const DEFAULT_RPC: Record<CryptoNetwork, string> = {
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
};

const CHAIN_ID: Record<CryptoNetwork, number> = {
  base: base.id,
  "base-sepolia": baseSepolia.id,
};

function readNetwork(): CryptoNetwork {
  const raw = (process.env.BREAKBPM_CRYPTO_NETWORK ?? "base").trim();
  return raw === "base-sepolia" ? "base-sepolia" : "base";
}

/** Resolve the active network config, applying any env overrides. */
export function getNetworkConfig(): NetworkConfig {
  const network = readNetwork();
  const feedOverride = process.env.BREAKBPM_CRYPTO_ETH_USD_FEED?.trim();
  const rpcOverride = process.env.BREAKBPM_CRYPTO_RPC_URL?.trim();
  return {
    network,
    chainId: CHAIN_ID[network],
    usdcAddress: USDC[network],
    usdcDecimals: 6,
    ethUsdFeed: (feedOverride
      ? getAddress(feedOverride)
      : ETH_USD_FEED[network]) as `0x${string}`,
    rpcUrl: rpcOverride && rpcOverride.length > 0 ? rpcOverride : DEFAULT_RPC[network],
  };
}

/**
 * Our receiving wallet, checksummed. Returns null when unset — the routes treat
 * "no address" as "crypto not open yet" even if the feature flag is on, so the
 * address can be added safely near go-live.
 */
export function getReceivingAddress(): `0x${string}` | null {
  const raw = process.env.BREAKBPM_CRYPTO_RECEIVING_ADDRESS?.trim();
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

/** Confirmations required before a payment is honored (default 2). */
export function getRequiredConfirmations(): number {
  const raw = process.env.BREAKBPM_CRYPTO_CONFIRMATIONS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

/** How long a quote (its locked ETH price) is valid for (default 15 min). */
export function getQuoteTtlSeconds(): number {
  const raw = process.env.BREAKBPM_CRYPTO_QUOTE_TTL_SECONDS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 60 ? Math.floor(n) : 900;
}

function makeClient(rpcUrl: string, network: CryptoNetwork) {
  return createPublicClient({
    chain: network === "base-sepolia" ? baseSepolia : base,
    transport: http(rpcUrl),
  });
}

let cachedClient: ReturnType<typeof makeClient> | null = null;
let cachedRpc = "";

export function getPublicClient(): ReturnType<typeof makeClient> {
  const cfg = getNetworkConfig();
  if (cachedClient && cachedRpc === cfg.rpcUrl) return cachedClient;
  cachedClient = makeClient(cfg.rpcUrl, cfg.network);
  cachedRpc = cfg.rpcUrl;
  return cachedClient;
}

const AGGREGATOR_ABI = [
  parseAbiItem(
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  ),
  parseAbiItem("function decimals() view returns (uint8)"),
] as const;

export interface EthUsdQuote {
  /** Raw oracle answer (integer, `decimals` places). */
  raw: bigint;
  decimals: number;
}

/** Read the latest ETH/USD price from the Chainlink feed on Base. */
export async function readEthUsd(): Promise<EthUsdQuote> {
  const cfg = getNetworkConfig();
  const client = getPublicClient();
  const [round, decimals] = await Promise.all([
    client.readContract({
      address: cfg.ethUsdFeed,
      abi: AGGREGATOR_ABI,
      functionName: "latestRoundData",
    }),
    client.readContract({
      address: cfg.ethUsdFeed,
      abi: AGGREGATOR_ABI,
      functionName: "decimals",
    }),
  ]);
  const answer = round[1] as bigint;
  if (answer <= 0n) throw new Error("ETH/USD oracle returned a non-positive price");
  return { raw: answer, decimals: Number(decimals) };
}

/**
 * Atomic units required for a given USD price.
 *   - USDC: priceCents * 10^(decimals-2).
 *   - ETH:  wei such that wei * (ethUsd) == priceUsd. Truncates toward zero;
 *     both quote and verify use the same value so the user always sends exactly
 *     this and `>=` matching makes truncation harmless.
 */
export function usdcAtomicAmount(priceCents: number, decimals: number): bigint {
  return BigInt(priceCents) * 10n ** BigInt(decimals - 2);
}

export function ethWeiAmount(priceCents: number, eth: EthUsdQuote): bigint {
  // wei = priceCents/100 USD ÷ (raw/10^dec USD per ETH) × 10^18 wei/ETH
  const numerator = BigInt(priceCents) * 10n ** BigInt(eth.decimals) * 10n ** 18n;
  const denominator = 100n * eth.raw;
  return numerator / denominator;
}

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export type VerifyOutcome =
  | { status: "granted"; blockTimestamp: number }
  | { status: "pending"; confirmations: number; needed: number }
  | { status: "not_found" }
  | { status: "mismatch"; reason: string }
  | { status: "failed"; reason: string };

export interface VerifyInput {
  txHash: string;
  asset: CryptoAsset;
  receivingAddress: `0x${string}`;
  payerAddress: `0x${string}`;
  tokenAddress: `0x${string}` | null;
  expectedAmount: bigint;
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Read the transaction on Base and decide whether it settles the order. Pure
 * read-only chain access — does NOT touch the DB. Returns a discriminated
 * outcome the caller maps to a response + (on "granted") a pass grant.
 */
export async function verifyPayment(input: VerifyInput): Promise<VerifyOutcome> {
  const client = getPublicClient();
  const hash = input.txHash as Hex;

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch {
    // Not mined yet (or unknown hash) — let the client keep polling.
    return { status: "not_found" };
  }

  if (receipt.status !== "success") {
    return { status: "failed", reason: "The transaction reverted on-chain." };
  }

  const needed = getRequiredConfirmations();
  let confirmations = 0;
  try {
    confirmations = Number(await client.getTransactionConfirmations({ hash }));
  } catch {
    confirmations = 0;
  }
  if (confirmations < needed) {
    return { status: "pending", confirmations, needed };
  }

  // Block timestamp (unix seconds) — used by the caller to enforce ETH quote
  // expiry against when the payment actually landed, not when it's verified.
  let blockTimestamp = 0;
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = Number(block.timestamp);
  } catch {
    blockTimestamp = 0;
  }

  if (input.asset === "eth") {
    const tx = await client.getTransaction({ hash });
    if (!tx.to || !eqAddr(tx.to, input.receivingAddress)) {
      return { status: "mismatch", reason: "Payment was not sent to our address." };
    }
    if (!eqAddr(tx.from, input.payerAddress)) {
      return {
        status: "mismatch",
        reason: "Payment came from a different wallet than the one you connected.",
      };
    }
    if (tx.value < input.expectedAmount) {
      return { status: "mismatch", reason: "The amount paid was too low." };
    }
    return { status: "granted", blockTimestamp };
  }

  // USDC: sum Transfer(value) logs emitted by the token contract that move
  // funds from the payer to our receiving address.
  if (!input.tokenAddress) {
    return { status: "failed", reason: "Missing token address for a USDC order." };
  }
  let received = 0n;
  let sawFromPayer = false;
  for (const log of receipt.logs) {
    if (!eqAddr(log.address, input.tokenAddress)) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    const { from, to, value } = decoded.args as {
      from: string;
      to: string;
      value: bigint;
    };
    if (!eqAddr(to, input.receivingAddress)) continue;
    if (!eqAddr(from, input.payerAddress)) continue;
    sawFromPayer = true;
    received += value;
  }
  if (!sawFromPayer) {
    return {
      status: "mismatch",
      reason: "No USDC transfer to our address from your wallet was found.",
    };
  }
  if (received < input.expectedAmount) {
    return { status: "mismatch", reason: "The USDC amount paid was too low." };
  }
  return { status: "granted", blockTimestamp };
}

/** Crypto checkout is open only when the flag is on AND a wallet is configured. */
export function cryptoConfigured(enabled: boolean): boolean {
  return enabled && getReceivingAddress() !== null;
}

/** How long a signed checkout authorization is accepted for (default 10 min). */
const CHECKOUT_SIGNATURE_TTL_SECONDS = 600;

/**
 * The exact message a buyer signs to prove they control `payerAddress` before
 * we issue a quote. The client MUST build this identically. Binding the wallet,
 * pass, and asset stops an attacker from quoting a victim's address and racing
 * to claim a victim's public on-chain payment (the receiving address + USDC
 * amounts are fixed and public, so without this proof a watcher could steal
 * grants). Smart-contract (ERC-1271) wallets won't recover off-chain — those
 * users should pay from an EOA, consistent with the ETH `tx.from` caveat above.
 */
export function buildCheckoutMessage(p: {
  payerAddress: string;
  passKind: string;
  asset: string;
  issuedAt: number;
}): string {
  return [
    "BreakBPM crypto checkout",
    "Authorize this wallet to pay for a pass.",
    `Wallet: ${p.payerAddress}`,
    `Pass: ${p.passKind}`,
    `Asset: ${p.asset}`,
    `Issued: ${p.issuedAt}`,
  ].join("\n");
}

/** Recover the signer of a checkout authorization and confirm it's the payer
 * and recent. Returns false on any malformed/expired/mismatched input. */
export async function verifyPayerSignature(p: {
  payerAddress: `0x${string}`;
  passKind: string;
  asset: string;
  issuedAt: number;
  signature: string;
}): Promise<boolean> {
  if (!Number.isFinite(p.issuedAt)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - p.issuedAt) > CHECKOUT_SIGNATURE_TTL_SECONDS) return false;
  try {
    const recovered = await recoverMessageAddress({
      message: buildCheckoutMessage(p),
      signature: p.signature as Hex,
    });
    return eqAddr(recovered, p.payerAddress);
  } catch {
    return false;
  }
}
