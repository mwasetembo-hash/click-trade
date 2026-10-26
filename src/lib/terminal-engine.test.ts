import { describe, it, expect } from "vitest";
import {
  contractParameterError,
  progressedStake,
  restorePublicSettings,
  riskBlock,
  settlePaperTick,
  signalFresh,
  threeDigitTrigger,
  type PaperOrder,
} from "./terminal-engine";

const limits = {
  stopLoss: 20,
  takeProfit: 10,
  dailyCap: 30,
  maxOpen: 4,
  maxLosses: 3,
  cooldown: 5,
  maxStake: 10,
};
const state = { net: 0, dailyLoss: 0, open: 0, losses: 0, lastSettlement: 0 };
describe("guarded terminal", () => {
  it("removes legacy stored tokens while preserving public App ID", () => {
    let value = JSON.stringify({ appId: "public-id", token: "test-credential", accountId: "demo" });
    expect(
      restorePublicSettings({
        getItem: () => value,
        setItem: (_, v) => {
          value = v;
        },
      }).appId,
    ).toBe("public-id");
    expect(JSON.parse(value)).toEqual({ appId: "public-id", accountId: "demo" });
  });
  it("stops at a 20 dollar loss", () =>
    expect(riskBlock(limits, { ...state, net: -20 }, 1)).toBe("Stop loss reached"));
  it("stops at a 10 dollar profit", () =>
    expect(riskBlock(limits, { ...state, net: 10 }, 1)).toBe("Take profit reached"));
  it("stops at a 30 dollar daily loss", () =>
    expect(riskBlock(limits, { ...state, dailyLoss: 30 }, 1)).toBe("Daily loss cap reached"));
  it("caps four open orders including the proposed batch", () =>
    expect(riskBlock(limits, { ...state, open: 2 }, 1, 3)).toBe("Maximum open trades reached"));
  it("stops after three losses", () =>
    expect(riskBlock(limits, { ...state, losses: 3 }, 1)).toBe("Consecutive loss cap reached"));
  it("waits five seconds after settlement", () =>
    expect(riskBlock(limits, { ...state, lastSettlement: 10000 }, 1, 1, 14999)).toBe(
      "Cooldown active",
    ));
  it("progression defaults off", () => expect(progressedStake(1, 2.1, 3, 2, 10, false)).toBe(1));
  it("caps progression at two steps and ten dollars", () => {
    expect(progressedStake(1, 2.1, 3, 2, 10, true)).toBe(4.41);
    expect(progressedStake(5, 2.1, 3, 2, 10, true)).toBe(10);
  });
  it("rejects impossible Over 9 and Under 0", () => {
    expect(contractParameterError("OVER_UNDER", 0, "9", 5, "t")).toBeTruthy();
    expect(contractParameterError("OVER_UNDER", 1, "0", 5, "t")).toBeTruthy();
  });
  it("validates signed 0.5 barriers", () => {
    expect(contractParameterError("HIGHER_LOWER", 0, "+0.5", 5, "t")).toBeNull();
    expect(contractParameterError("HIGHER_LOWER", 1, "-0.5", 5, "t")).toBeNull();
    expect(contractParameterError("HIGHER_LOWER", 0, "0", 5, "t")).toBeTruthy();
  });
  it("does not execute signals older than 15 seconds", () =>
    expect(signalFresh(10000, 25001)).toBe(false));
  it("requires 100 ticks and three consecutive even digits", () => {
    expect(threeDigitTrigger([1.02, 1.04, 1.06], 2)).toBeNull();
    expect(threeDigitTrigger(Array(100).fill(1.02), 2)).toBe(0);
  });
});
describe("virtual settlement", () => {
  const order: PaperOrder = {
    id: 1,
    symbol: "R_50",
    kind: "MATCH_DIFF",
    contract: "DIGITMATCH",
    barrier: 0,
    entry: 100,
    decimals: 2,
    remaining: 2,
    stake: 1,
    payout: 9.5,
    profit: null,
    created: 1,
    day: "2026-10-22",
  };
  it("waits for all expiry ticks", () =>
    expect(settlePaperTick(order, 100.1, 2).profit).toBeNull());
  it("preserves trailing zero precision and calculates virtual quoted payout", () =>
    expect(settlePaperTick({ ...order, remaining: 1 }, 100.1, 3).profit).toBe(8.5));
  it("cannot settle an order twice", () =>
    expect(settlePaperTick({ ...order, profit: 8.5 }, 100.12, 4).profit).toBe(8.5));
});
