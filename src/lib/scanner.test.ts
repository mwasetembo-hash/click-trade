import { describe, expect, it } from "vitest";
import { digitStudio, evaluateDigit, fairPayoutRatio, rankRows, scanInstrument } from "./scanner";

describe("digit studio", () => {
  const prices = [1.1, 1.2, 1.2, 1.3, 1.5, 1.5, 1.5, 1.8, 1.9, 1.0];
  const st = digitStudio(prices, 1, 10, 4);
  it("finds digit 5 as hot", () => expect(st.hot).toBe(5));
  it("counts 5 at 30 percent", () => expect(st.pct[5]).toBeCloseTo(30));
  it("splits even 40 / odd 60", () => { expect(st.even).toBeCloseTo(40); expect(st.odd).toBeCloseTo(60); });
  it("measures over 4 at 60 percent", () => expect(st.over).toBeCloseTo(60));
  it("only uses the chosen window", () => expect(digitStudio(prices, 1, 3, 4).total).toBe(3));
});

describe("digit contract evaluation", () => {
  it("Over 4 loses on 4", () => expect(evaluateDigit("DIGITOVER", 4, 4)).toBe(false));
  it("Under 4 wins on 3", () => expect(evaluateDigit("DIGITUNDER", 3, 4)).toBe(true));
  it("Matches pays 10x at fair odds", () => expect(fairPayoutRatio("DIGITMATCH", 7)).toBe(10));
  it("Even pays 2x at fair odds", () => expect(fairPayoutRatio("DIGITEVEN", 0)).toBe(2));
});

describe("scanner", () => {
  it("returns no ranked signal before 60 ticks", () => expect(rankRows(scanInstrument("R_10", "V10", [1, 2, 3], 2))).toHaveLength(0));
  it("scores all 14 contract types", () => expect(scanInstrument("R_10", "V10", Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i) + i * 0.01), 2)).toHaveLength(14));
});
