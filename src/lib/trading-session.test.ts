import { describe, expect, it } from "vitest";
import { balanceStakeCap, demoStrategyStats, stakeProtection } from "./trading-session";

describe("balance-based account protection", () => {
  it("caps a 100 balance at 1 when risk is 1 percent", () => expect(balanceStakeCap(100, 1, 10)).toBe(1));
  it("keeps the existing maximum stake cap", () => expect(balanceStakeCap(2000, 1, 10)).toBe(10));
  it("rounds down rather than exceeding the risk budget", () => expect(balanceStakeCap(35.99, 1, 10)).toBe(.35));
  it("blocks an order above the balance cap", () => expect(stakeProtection(1.01, 100, 1, 10)).toContain("exceeds"));
  it("permits an order exactly at the balance cap", () => expect(stakeProtection(1, 100, 1, 10)).toBeNull());
  it("blocks orders without a known balance", () => expect(stakeProtection(1, null, 1, 10)).not.toBeNull());
  it("rejects invalid percentages", () => expect(stakeProtection(1, 100, -1, 10)).not.toBeNull());
  it("rejects nonfinite stakes", () => expect(stakeProtection(Infinity, 100, 1, 10)).not.toBeNull());
});
describe("demo strategy comparison", () => {
  const trades = [
    { demo: true, accountId: "demo1", setup: "A", stake: 1, profit: .8 },
    { demo: true, accountId: "demo1", setup: "A", stake: 1, profit: -1 },
    { demo: true, accountId: "demo1", setup: "A", stake: 1, profit: 0 },
    { demo: true, accountId: "demo1", setup: "A", stake: 1, profit: null },
    { demo: false, accountId: "demo1", setup: "A", stake: 1, profit: 100 },
    { demo: true, accountId: "other", setup: "A", stake: 1, profit: 100 },
    { demo: true, accountId: "demo1", setup: "B", stake: 1, profit: 100 },
  ];
  it("counts only the selected strategy and demo account", () => expect(demoStrategyStats(trades, "A", "demo1").settled).toBe(3));
  it("does not invent a result for unresolved orders", () => expect(demoStrategyStats(trades, "A", "demo1").pending).toBe(1));
  it("separates break-even results from losses", () => expect(demoStrategyStats(trades, "A", "demo1").losses).toBe(1));
  it("reports actual net and expectancy", () => { const s = demoStrategyStats(trades, "A", "demo1"); expect(s.net).toBeCloseTo(-.2); expect(s.expectancy).toBeCloseTo(-.2 / 3); });
});