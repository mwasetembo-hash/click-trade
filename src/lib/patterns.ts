// Pattern engine: turns ticks into candles and scores chart, candlestick,
// market-structure, SMC and indicator patterns. Runs in well under a millisecond.
// Output is an estimate from past prices, never a guarantee.

export type Candle = { o: number; h: number; l: number; c: number };
export type Hit = { name: string; group: string; bias: 0 | 1; weight: number };
export type PatternResult = { side: 0 | 1 | null; confidence: number; score: number; hits: Hit[]; trend: "up" | "down" | "range" };

/** Group ticks into candles of `size` ticks each. */
export function toCandles(prices: number[], size = 5): Candle[] {
  const out: Candle[] = [];
  const start = prices.length % size;
  for (let i = start; i + size <= prices.length; i += size) {
    const s = prices.slice(i, i + size);
    out.push({ o: s[0]!, c: s[s.length - 1]!, h: Math.max(...s), l: Math.min(...s) });
  }
  return out;
}

export function ema(v: number[], n: number) {
  const k = 2 / (n + 1);
  const out: number[] = [];
  v.forEach((x, i) => out.push(i === 0 ? x : x * k + out[i - 1]! * (1 - k)));
  return out;
}

export function rsi(v: number[], n = 14) {
  if (v.length <= n) return 50;
  let g = 0, l = 0;
  for (let i = v.length - n; i < v.length; i++) { const d = v[i]! - v[i - 1]!; if (d > 0) g += d; else l -= d; }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

/** Swing highs/lows (fractal of `w` bars each side). */
export function swings(c: Candle[], w = 2) {
  const hi: { i: number; p: number }[] = [], lo: { i: number; p: number }[] = [];
  for (let i = w; i < c.length - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (c[j]!.h >= c[i]!.h) isH = false;
      if (c[j]!.l <= c[i]!.l) isL = false;
    }
    if (isH) hi.push({ i, p: c[i]!.h });
    if (isL) lo.push({ i, p: c[i]!.l });
  }
  return { hi, lo };
}

const body = (k: Candle) => Math.abs(k.c - k.o);
const range = (k: Candle) => k.h - k.l || 1e-12;
const bull = (k: Candle) => k.c > k.o;
const bear = (k: Candle) => k.c < k.o;

export function candlePatterns(c: Candle[]): Hit[] {
  const h: Hit[] = [];
  if (c.length < 4) return h;
  const [a, b, x] = [c.at(-3)!, c.at(-2)!, c.at(-1)!];
  const avg = c.slice(-20).reduce((s, k) => s + body(k), 0) / Math.min(20, c.length) || 1e-12;
  const down = c.at(-4)!.c > b.c, up = c.at(-4)!.c < b.c;
  const add = (name: string, bias: 0 | 1, weight: number) => h.push({ name, group: "Candlestick", bias, weight });
  const lowW = Math.min(x.o, x.c) - x.l, upW = x.h - Math.max(x.o, x.c);

  if (bull(x) && bear(b) && x.c >= b.o && x.o <= b.c) add("Bullish Engulfing", 0, 2);
  if (bear(x) && bull(b) && x.c <= b.o && x.o >= b.c) add("Bearish Engulfing", 1, 2);
  if (lowW > body(x) * 2 && upW < body(x) && down) add("Hammer", 0, 1.5);
  if (lowW > body(x) * 2 && upW < body(x) && up) add("Hanging Man", 1, 1);
  if (upW > body(x) * 2 && lowW < body(x) && up) add("Shooting Star", 1, 1.5);
  if (upW > body(x) * 2 && lowW < body(x) && down) add("Inverted Hammer", 0, 1);
  if (bear(a) && body(b) < avg * 0.5 && bull(x) && x.c > (a.o + a.c) / 2) add("Morning Star", 0, 2);
  if (bull(a) && body(b) < avg * 0.5 && bear(x) && x.c < (a.o + a.c) / 2) add("Evening Star", 1, 2);
  if (bull(a) && bull(b) && bull(x) && b.c > a.c && x.c > b.c && body(x) > avg) add("Three White Soldiers", 0, 2);
  if (bear(a) && bear(b) && bear(x) && b.c < a.c && x.c < b.c && body(x) > avg) add("Three Black Crows", 1, 2);
  if (bear(b) && bull(x) && x.o < b.c && x.c > (b.o + b.c) / 2 && x.c < b.o) add("Piercing Line", 0, 1.5);
  if (bull(b) && bear(x) && x.o > b.c && x.c < (b.o + b.c) / 2 && x.c > b.o) add("Dark Cloud Cover", 1, 1.5);
  const tol = avg * 0.15;
  if (Math.abs(x.l - b.l) < tol && bear(b) && bull(x)) add("Tweezer Bottom", 0, 1);
  if (Math.abs(x.h - b.h) < tol && bull(b) && bear(x)) add("Tweezer Top", 1, 1);
  if (bear(b) && body(x) < body(b) * 0.5 && Math.max(x.o, x.c) < b.o && Math.min(x.o, x.c) > b.c) add("Bullish Harami", 0, 1);
  if (bull(b) && body(x) < body(b) * 0.5 && Math.max(x.o, x.c) < b.c && Math.min(x.o, x.c) > b.o) add("Bearish Harami", 1, 1);
  if (body(x) > range(x) * 0.9 && body(x) > avg * 1.3) add(bull(x) ? "Bullish Marubozu" : "Bearish Marubozu", bull(x) ? 0 : 1, 1.5);
  if (body(x) < range(x) * 0.1) {
    if (lowW > range(x) * 0.6) add("Dragonfly Doji", 0, 0.8);
    else if (upW > range(x) * 0.6) add("Gravestone Doji", 1, 0.8);
  }
  return h;
}

export function structurePatterns(c: Candle[]): { hits: Hit[]; trend: PatternResult["trend"] } {
  const hits: Hit[] = [];
  const add = (name: string, group: string, bias: 0 | 1, weight: number) => hits.push({ name, group, bias, weight });
  const { hi, lo } = swings(c);
  const last = c.at(-1)!, prev = c.at(-2)!;
  let trend: PatternResult["trend"] = "range";
  if (hi.length >= 2 && lo.length >= 2) {
    const [h1, h2] = [hi.at(-2)!.p, hi.at(-1)!.p], [l1, l2] = [lo.at(-2)!.p, lo.at(-1)!.p];
    if (h2 > h1 && l2 > l1) { trend = "up"; add("Higher Highs & Higher Lows", "Structure", 0, 2); }
    else if (h2 < h1 && l2 < l1) { trend = "down"; add("Lower Highs & Lower Lows", "Structure", 1, 2); }
    const tol = (Math.max(...c.map((k) => k.h)) - Math.min(...c.map((k) => k.l))) * 0.03;
    if (Math.abs(h2 - h1) < tol && last.c < Math.min(l2, l1)) add("Double Top (neckline break)", "Chart", 1, 2.5);
    if (Math.abs(l2 - l1) < tol && last.c > Math.max(h2, h1)) add("Double Bottom (neckline break)", "Chart", 0, 2.5);
    if (Math.abs(h2 - h1) < tol && l2 > l1) add("Ascending Triangle", "Chart", 0, 1.5);
    if (Math.abs(l2 - l1) < tol && h2 < h1) add("Descending Triangle", "Chart", 1, 1.5);
    if (hi.length >= 3) {
      const [a, b, d] = hi.slice(-3).map((s) => s.p) as [number, number, number];
      if (b > a && b > d && Math.abs(a - d) < tol * 2 && last.c < lo.at(-1)!.p) add("Head & Shoulders", "Chart", 1, 3);
    }
    if (lo.length >= 3) {
      const [a, b, d] = lo.slice(-3).map((s) => s.p) as [number, number, number];
      if (b < a && b < d && Math.abs(a - d) < tol * 2 && last.c > hi.at(-1)!.p) add("Inverse Head & Shoulders", "Chart", 0, 3);
    }
  }
  const sh = hi.at(-1), sl = lo.at(-1);
  if (sh && last.c > sh.p && prev.c <= sh.p) add(trend === "down" ? "CHOCH bullish" : "Break of Structure up", "Structure", 0, 2);
  if (sl && last.c < sl.p && prev.c >= sl.p) add(trend === "up" ? "CHOCH bearish" : "Break of Structure down", "Structure", 1, 2);
  // Liquidity sweep: wick beyond swing, close back inside
  if (sh && last.h > sh.p && last.c < sh.p) add("Buy-side liquidity sweep", "SMC", 1, 2);
  if (sl && last.l < sl.p && last.c > sl.p) add("Sell-side liquidity sweep", "SMC", 0, 2);
  // Fair value gap in last 6 candles, price returning into it
  for (let i = c.length - 1; i >= Math.max(2, c.length - 6); i--) {
    const k0 = c[i - 2]!, k2 = c[i]!;
    if (k2.l > k0.h && last.l <= k2.l && last.c > k0.h) { add("Bullish FVG retest", "SMC", 0, 1.5); break; }
    if (k2.h < k0.l && last.h >= k2.h && last.c < k0.l) { add("Bearish FVG retest", "SMC", 1, 1.5); break; }
  }
  // Fibonacci golden zone pullback within trend
  if (sh && sl && trend !== "range") {
    const span = sh.p - sl.p, pos = (last.c - sl.p) / (span || 1e-12);
    if (trend === "up" && pos > 0.382 && pos < 0.618 && bull(last)) add("Fib 38–62% pullback (up)", "Fibonacci", 0, 1.5);
    if (trend === "down" && pos > 0.382 && pos < 0.618 && bear(last)) add("Fib 38–62% pullback (down)", "Fibonacci", 1, 1.5);
  }
  return { hits, trend };
}

export function indicatorPatterns(prices: number[]): Hit[] {
  const hits: Hit[] = [];
  const add = (name: string, bias: 0 | 1, weight: number) => hits.push({ name, group: "Indicator", bias, weight });
  const e9 = ema(prices, 9), e21 = ema(prices, 21), e50 = ema(prices, 50);
  const n = prices.length - 1;
  if (e9[n]! > e21[n]! && e21[n]! > e50[n]!) add("EMA 9/21/50 aligned up", 0, 2);
  if (e9[n]! < e21[n]! && e21[n]! < e50[n]!) add("EMA 9/21/50 aligned down", 1, 2);
  if (e9[n]! > e21[n]! && e9[n - 3]! <= e21[n - 3]!) add("EMA cross up", 0, 1.5);
  if (e9[n]! < e21[n]! && e9[n - 3]! >= e21[n - 3]!) add("EMA cross down", 1, 1.5);
  const macd = ema(prices, 12).map((v, i) => v - ema(prices, 26)[i]!);
  const sigl = ema(macd, 9);
  if (macd[n]! > sigl[n]! && macd[n - 1]! <= sigl[n - 1]!) add("MACD bullish cross", 0, 1.5);
  if (macd[n]! < sigl[n]! && macd[n - 1]! >= sigl[n - 1]!) add("MACD bearish cross", 1, 1.5);
  const r = rsi(prices);
  if (r < 25) add(`RSI oversold ${r.toFixed(0)}`, 0, 1);
  if (r > 75) add(`RSI overbought ${r.toFixed(0)}`, 1, 1);
  // RSI divergence over last 30 ticks
  const rPrev = rsi(prices.slice(0, -15));
  const pNow = prices[n]!, pPrev = prices[n - 15]!;
  if (pNow < pPrev && r > rPrev + 5) add("Bullish RSI divergence", 0, 1.5);
  if (pNow > pPrev && r < rPrev - 5) add("Bearish RSI divergence", 1, 1.5);
  // Bollinger breakout after squeeze
  const w = prices.slice(-20), m = w.reduce((a, b) => a + b, 0) / 20;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  const w2 = prices.slice(-60, -20), m2 = w2.reduce((a, b) => a + b, 0) / (w2.length || 1);
  const sd2 = Math.sqrt(w2.reduce((a, b) => a + (b - m2) ** 2, 0) / (w2.length || 1)) || 1e-12;
  if (sd < sd2 * 0.8) {
    if (pNow > m + 2 * sd) add("Bollinger squeeze breakout up", 0, 2);
    if (pNow < m - 2 * sd) add("Bollinger squeeze breakout down", 1, 2);
  }
  return hits;
}

/** Full hybrid analysis. Sensitivity 1 (strict) .. 5 (acts on weak setups). */
export function analyzePatterns(prices: number[], sensitivity = 3): PatternResult {
  if (prices.length < 60) return { side: null, confidence: 0, score: 0, hits: [], trend: "range" };
  const recent = prices.slice(-600);
  const candles = toCandles(recent, 5);
  const st = structurePatterns(candles);
  const hits = [...candlePatterns(candles), ...st.hits, ...indicatorPatterns(recent)];
  let up = 0, dn = 0;
  for (const h of hits) {
    // Confluence: patterns that agree with the trend count more, counter-trend less
    const f = st.trend === "range" ? 1 : (h.bias === 0) === (st.trend === "up") ? 1.3 : 0.7;
    if (h.bias === 0) up += h.weight * f; else dn += h.weight * f;
  }
  const score = up - dn;
  const need = [0, 4, 3, 2, 1.2, 0.5][Math.max(1, Math.min(5, Math.round(sensitivity)))]!;
  const side: 0 | 1 | null = score >= need ? 0 : score <= -need ? 1 : null;
  const total = up + dn || 1;
  const confidence = side === null ? 0 : Math.round(Math.min(95, 40 + (Math.abs(score) / total) * 35 + Math.min(20, Math.abs(score) * 2)));
  return { side, confidence, score, hits, trend: st.trend };
}

export type Setup = { side: 0 | 1 | null; confidence: number; note: string; checks: { trend: boolean; ema: boolean; trigger: boolean; score: boolean } };

/**
 * The single "Trend-Confirmed Pattern" setup. Fires only when ALL agree:
 * 1. Market structure trend (HH/HL or LH/LL)  2. EMA 9/21/50 stacked the same way
 * 3. A trigger pattern in that direction (candlestick, BOS/CHOCH, SMC, Fib, chart)
 * 4. Net pattern score points the same way.
 */
export function patternSetup(prices: number[], sensitivity = 3): Setup {
  const none = { trend: false, ema: false, trigger: false, score: false };
  if (prices.length < 60) return { side: null, confidence: 0, note: "Collecting ticks…", checks: none };
  const r = analyzePatterns(prices, sensitivity);
  const side: 0 | 1 | null = efficiency(prices) < 0.12 ? null : r.trend === "up" ? 0 : r.trend === "down" ? 1 : null;
  const e9 = ema(prices, 9).at(-1)!, e21 = ema(prices, 21).at(-1)!, e50 = ema(prices, 50).at(-1)!;
  const emaSide = e9 > e21 && e21 > e50 ? 0 : e9 < e21 && e21 < e50 ? 1 : null;
  const trig = r.hits.filter((h) => h.bias === side && h.group !== "Indicator" && !/Higher Highs|Lower Highs/.test(h.name));
  const checks = { trend: side !== null, ema: side !== null && emaSide === side, trigger: trig.length > 0, score: side !== null && (side === 0 ? r.score > 0 : r.score < 0) };
  const passed = Object.values(checks).filter(Boolean).length;
  if (passed < 4 || side === null) {
    const miss = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(", ");
    return { side: null, confidence: passed * 20, note: `Setup waiting — missing: ${miss} (trend ${r.trend})`, checks };
  }
  const conf = Math.round(Math.min(95, 60 + Math.abs(r.score) * 3 + trig.length * 4));
  const names = trig.sort((a, b) => b.weight - a.weight).slice(0, 2).map((h) => h.name).join(" + ");
  return { side, confidence: conf, note: `Setup A ${side === 0 ? "▲" : "▼"} CONFIRMED: trend ${r.trend} + EMA stack + ${names}`, checks };
}

/** Directional efficiency over last n ticks: |net move| / path length (0..1). */
export function efficiency(prices: number[], n = 100) {
  const w = prices.slice(-n);
  let path = 0;
  for (let i = 1; i < w.length; i++) path += Math.abs(w[i]! - w[i - 1]!);
  return path ? Math.abs(w.at(-1)! - w[0]!) / path : 0;
}

export type SetupId = "A" | "B" | "C";
export const SETUPS: Record<SetupId, string> = {
  A: "Trend-Confirmed Pattern",
  B: "Trendline Breakout-Retest",
  C: "Fib Pullback + Support",
};

/**
 * Setup B "Trendline Breakout-Retest". Fires only when ALL agree:
 * 1. Trend: structure HH/HL or LH/LL with real directional efficiency
 * 2. Trendline: line through the last two swing lows (up) / highs (down) slopes with
 *    the trend and price is holding on the correct side of it
 * 3. Breakout: a BOS/CHOCH, liquidity sweep, FVG retest or neckline break in the trend direction
 * 4. Momentum: last candle closes in the trend direction and price is beyond EMA 21
 */
export function trendlineSetup(prices: number[], sensitivity = 3): Setup {
  const none = { trend: false, ema: false, trigger: false, score: false };
  if (prices.length < 60) return { side: null, confidence: 0, note: "Collecting ticks…", checks: none };
  const r = analyzePatterns(prices, sensitivity);
  const eff = efficiency(prices);
  const side: 0 | 1 | null = eff < 0.12 ? null : r.trend === "up" ? 0 : r.trend === "down" ? 1 : null;
  const c = toCandles(prices.slice(-600), 5);
  const { hi, lo } = swings(c);
  const pts = side === 0 ? lo.slice(-2) : side === 1 ? hi.slice(-2) : [];
  let line = false;
  if (pts.length === 2) {
    const [p1, p2] = pts as [{ i: number; p: number }, { i: number; p: number }];
    const slope = (p2.p - p1.p) / (p2.i - p1.i || 1);
    const at = p2.p + slope * (c.length - 1 - p2.i);
    const last = c.at(-1)!.c;
    line = side === 0 ? slope > 0 && last > at : slope < 0 && last < at;
  }
  const trig = r.hits.filter((h) => h.bias === side && /Structure|CHOCH|sweep|FVG|neckline|Triangle/.test(h.name));
  const lastC = c.at(-1)!, e21 = ema(prices, 21).at(-1)!, p = prices.at(-1)!;
  const mom = side === 0 ? lastC.c > lastC.o && p > e21 : side === 1 ? lastC.c < lastC.o && p < e21 : false;
  const checks = { trend: side !== null, ema: line, trigger: trig.length > 0, score: mom };
  const passed = Object.values(checks).filter(Boolean).length;
  if (passed < 4 || side === null) {
    const label: Record<string, string> = { trend: "trend", ema: "trendline", trigger: "breakout", score: "momentum" };
    const miss = Object.entries(checks).filter(([, v]) => !v).map(([k]) => label[k]).join(", ");
    return { side: null, confidence: passed * 20, note: `Setup B waiting — missing: ${miss} (trend ${r.trend}, eff ${Math.round(eff * 100)}%)`, checks };
  }
  const conf = Math.round(Math.min(95, 62 + eff * 40 + trig.length * 4));
  const names = trig.sort((a, b) => b.weight - a.weight).slice(0, 2).map((h) => h.name).join(" + ");
  return { side, confidence: conf, note: `Setup B ${side === 0 ? "▲" : "▼"} CONFIRMED: trendline holding + ${names}`, checks };
}

export function runSetup(id: SetupId, prices: number[], sensitivity = 3): Setup {
  if (id === "C") return fibSetup(prices, sensitivity);
  return id === "B" ? trendlineSetup(prices, sensitivity) : patternSetup(prices, sensitivity);
}

/**
 * Setup C "Fib Pullback + Support". Fires only when ALL agree:
 * 1. Trend: structure HH/HL or LH/LL with real directional efficiency
 * 2. Pullback: price retraced into the 38.2–61.8% zone of the last swing
 * 3. Support/resistance: the pullback held above the last swing low (up) / below swing high (down)
 * 4. Rejection: last candle closes back in the trend direction
 */
export function fibSetup(prices: number[], sensitivity = 3): Setup {
  const none = { trend: false, ema: false, trigger: false, score: false };
  if (prices.length < 60) return { side: null, confidence: 0, note: "Collecting ticks…", checks: none };
  const r = analyzePatterns(prices, sensitivity);
  const eff = efficiency(prices);
  const side: 0 | 1 | null = eff < 0.12 ? null : r.trend === "up" ? 0 : r.trend === "down" ? 1 : null;
  const c = toCandles(prices.slice(-600), 5);
  const { hi, lo } = swings(c);
  const sh = hi.at(-1), sl = lo.at(-1), last = c.at(-1)!;
  let zone = false, held = false;
  if (sh && sl && side !== null) {
    const span = sh.p - sl.p || 1e-12;
    // Retracement measured from the swing extreme back toward the origin
    const recent = c.slice(-4);
    const extreme = side === 0 ? Math.min(...recent.map((k) => k.l)) : Math.max(...recent.map((k) => k.h));
    const retr = side === 0 ? (sh.p - extreme) / span : (extreme - sl.p) / span;
    zone = retr >= 0.382 && retr <= 0.618;
    held = side === 0 ? extreme > sl.p : extreme < sh.p;
  }
  const rej = side === 0 ? last.c > last.o : side === 1 ? last.c < last.o : false;
  const checks = { trend: side !== null, ema: zone, trigger: held, score: rej };
  const passed = Object.values(checks).filter(Boolean).length;
  if (passed < 4 || side === null) {
    const label: Record<string, string> = { trend: "trend", ema: "fib zone", trigger: "support hold", score: "rejection" };
    const miss = Object.entries(checks).filter(([, v]) => !v).map(([k]) => label[k]).join(", ");
    return { side: null, confidence: passed * 20, note: `Setup C waiting — missing: ${miss} (trend ${r.trend})`, checks };
  }
  const conf = Math.round(Math.min(95, 64 + eff * 40));
  return { side, confidence: conf, note: `Setup C ${side === 0 ? "▲" : "▼"} CONFIRMED: Fib 38–62% pullback held ${side === 0 ? "support" : "resistance"}`, checks };
}
