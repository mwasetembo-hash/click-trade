import { CONTRACTS, lastDigit, type Kind } from "./contracts";
import { evaluateDigit, type DigitContract } from "./scanner";

export const DEFAULT_TRADING_APP_ID = "34ARk0NOmxpaMAqV6Bwgg";
// Public v3 data uses a legacy numeric app registration, not a modern PAT App ID.
export const PUBLIC_MARKET_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";
export const CREDENTIAL_STORAGE_KEY = "mwase-deriv-config";

export function restorePublicSettings(storage: Pick<Storage, "getItem" | "setItem">) {
  let settings: { appId?: string; accountId?: string } = {};
  try {
    const previous = JSON.parse(storage.getItem(CREDENTIAL_STORAGE_KEY) || "{}");
    settings = {
      appId: typeof previous.appId === "string" ? previous.appId : undefined,
      accountId: typeof previous.accountId === "string" ? previous.accountId : undefined,
    };
  } catch {
    /* Invalid old settings are discarded. */
  }
  storage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

export type RiskLimits = {
  stopLoss: number;
  takeProfit: number;
  dailyCap: number;
  maxOpen: number;
  maxLosses: number;
  cooldown: number;
  maxStake: number;
};
export type RiskState = {
  net: number;
  dailyLoss: number;
  open: number;
  losses: number;
  lastSettlement: number;
};
export function riskBlock(
  limits: RiskLimits,
  state: RiskState,
  stake: number,
  orders = 1,
  now = Date.now(),
): string | null {
  if (
    Object.values(limits).some((v) => !Number.isFinite(v)) ||
    limits.stopLoss <= 0 ||
    limits.takeProfit <= 0 ||
    limits.dailyCap <= 0 ||
    limits.maxOpen < 1 ||
    limits.maxLosses < 1 ||
    limits.cooldown < 0 ||
    limits.maxStake <= 0
  )
    return "Set valid positive risk limits";
  if (!Number.isFinite(stake) || stake <= 0 || stake > limits.maxStake)
    return "Stake exceeds the configured cap";
  if (!Number.isInteger(orders) || orders < 1 || state.open + orders > limits.maxOpen)
    return "Maximum open trades reached";
  if (state.net <= -limits.stopLoss) return "Stop loss reached";
  if (state.net >= limits.takeProfit) return "Take profit reached";
  if (state.dailyLoss >= limits.dailyCap) return "Daily loss cap reached";
  if (state.losses >= limits.maxLosses) return "Consecutive loss cap reached";
  if (now - state.lastSettlement < limits.cooldown * 1000) return "Cooldown active";
  return null;
}

export function progressedStake(
  base: number,
  multiplier: number,
  losses: number,
  steps: number,
  cap: number,
  enabled: boolean,
) {
  if (
    ![base, multiplier, losses, steps, cap].every(Number.isFinite) ||
    base <= 0 ||
    cap <= 0 ||
    multiplier < 1 ||
    steps < 0 ||
    losses < 0
  )
    return 0;
  return (
    Math.floor(Math.min(cap, enabled ? base * multiplier ** Math.min(losses, steps) : base) * 100) /
    100
  );
}

export function contractParameterError(
  kind: Kind,
  side: 0 | 1,
  barrier: string | undefined,
  duration: number,
  unit: string,
): string | null {
  const def = CONTRACTS[kind];
  if (!Number.isFinite(duration) || !Number.isInteger(duration) || duration < 1)
    return "Duration must be a positive whole number";
  if (def.ticks && (unit !== "t" || duration < def.ticks[0] || duration > def.ticks[1]))
    return `Contract requires ${def.ticks[0]}–${def.ticks[1]} ticks`;
  if (def.digits && (unit !== "t" || duration > 10)) return "Digit contracts require 1–10 ticks";
  if (def.barrier === "digit") {
    const digit = Number(barrier);
    if (barrier === undefined || !Number.isInteger(digit) || digit < 0 || digit > 9)
      return "Prediction must be a digit from 0–9";
    if (kind === "OVER_UNDER" && ((side === 0 && digit === 9) || (side === 1 && digit === 0)))
      return "This digit leaves no winning outcomes";
  }
  if (
    def.barrier === "offset" &&
    (barrier === undefined ||
      !/^[+-]/.test(barrier) ||
      !Number.isFinite(Number(barrier)) ||
      Number(barrier) === 0)
  )
    return "Use a finite, nonzero signed barrier offset";
  return null;
}

export type PaperOrder = {
  id: number;
  symbol: string;
  kind: Kind;
  contract: string;
  barrier: number;
  entry: number;
  decimals: number;
  remaining: number;
  stake: number;
  payout: number;
  profit: number | null;
  created: number;
  settled?: number;
  day: string;
};
export function settlePaperTick(order: PaperOrder, quote: number, now: number): PaperOrder {
  if (order.profit !== null || !Number.isFinite(quote)) return order;
  const remaining = order.remaining - 1;
  if (remaining > 0) return { ...order, remaining };
  let won: boolean;
  if (CONTRACTS[order.kind].digits)
    won = evaluateDigit(
      order.contract as DigitContract,
      lastDigit(quote, order.decimals),
      order.barrier,
    );
  else if (order.kind === "RISE_FALL" || order.kind === "HIGHER_LOWER")
    won =
      order.contract === "CALL"
        ? quote > order.entry + order.barrier
        : quote < order.entry + order.barrier;
  else return order;
  return {
    ...order,
    remaining: 0,
    profit: won ? order.payout - order.stake : -order.stake,
    settled: now,
  };
}

export function signalFresh(timestamp: number, now = Date.now()) {
  return timestamp > 0 && now - timestamp <= 15000 && timestamp <= now;
}

export function threeDigitTrigger(prices: number[], decimals: number, minimum = 100): 0 | 1 | null {
  if (prices.length < minimum || prices.length < 3) return null;
  const parity = prices.slice(-3).map((p) => lastDigit(p, decimals) % 2);
  return parity.every((p) => p === 0) ? 0 : parity.every((p) => p === 1) ? 1 : null;
}
