import { describe, expect, it } from "vitest";
import { analyzePatterns, candlePatterns, toCandles } from "./patterns";

describe("pattern engine", () => {
  it("groups ticks into 5-tick candles", () => {
    const c = toCandles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(c).toEqual([{ o: 1, c: 5, h: 5, l: 1 }, { o: 6, c: 10, h: 10, l: 6 }]);
  });
  it("detects bullish engulfing", () => {
    const c = [{ o: 5, c: 5, h: 5, l: 5 }, { o: 6, c: 6, h: 6, l: 6 }, { o: 10, c: 8, h: 10, l: 8 }, { o: 7.9, c: 10.5, h: 10.5, l: 7.9 }];
    expect(candlePatterns(c).some((h) => h.name === "Bullish Engulfing")).toBe(true);
  });
  it("calls a steady uptrend Up and a downtrend Down", () => {
    const upT = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1 + Math.sin(i) * 0.3);
    const dnT = upT.map((p) => 200 - p);
    expect(analyzePatterns(upT, 3).side).toBe(0);
    expect(analyzePatterns(dnT, 3).side).toBe(1);
  });
  it("waits with too few ticks", () => {
    expect(analyzePatterns([1, 2, 3], 3).side).toBe(null);
  });
});

import { patternSetup } from "./patterns";
describe("trend-confirmed setup", () => {
  it("never fires in a flat market", () => {
    const flat = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i) * 0.3);
    expect(patternSetup(flat).side).toBe(null);
  });
  it("never fires against the trend", () => {
    const upT = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1 + Math.sin(i) * 0.3);
    expect(patternSetup(upT).side).not.toBe(1);
  });
});

import { trendlineSetup } from "./patterns";
describe("setup B trendline breakout-retest", () => {
  const flat = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i) * 0.3);
  const upT = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1 + Math.sin(i) * 0.3);
  it("never fires in a flat market", () => { expect(trendlineSetup(flat).side).toBe(null); });
  it("never fires against the trend", () => { expect(trendlineSetup(upT).side).not.toBe(1); });
  it("never fires against a downtrend", () => { expect(trendlineSetup(upT.map((p) => 200 - p)).side).not.toBe(0); });
});

import { fibSetup } from "./patterns";
describe("setup C fib pullback", () => {
  const flat = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i) * 0.3);
  const upT = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1 + Math.sin(i) * 0.3);
  it("never fires in a flat market", () => { expect(fibSetup(flat).side).toBe(null); });
  it("never fires against the trend", () => { expect(fibSetup(upT).side).not.toBe(1); });
});
