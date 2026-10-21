// Browser-safe digit studio + universal scanner helpers. Estimates only, never guarantees.
import { CONTRACTS, kindSignal, lastDigit, type Kind } from "@/lib/contracts";
import { analyzePatterns } from "@/lib/patterns";

export type DigitStudio = {
  pct: number[]; total: number; hot: number; cold: number;
  even: number; odd: number; over: number; under: number;
};

/** Digit histogram over the last `window` ticks with hot/cold, even/odd and over/under-barrier stats. */
export function digitStudio(prices: number[], decimals: number, window: number, barrier: number): DigitStudio {
  const s = prices.slice(-window);
  const counts = Array(10).fill(0) as number[];
  s.forEach(p => counts[lastDigit(p, decimals)]!++);
  const total = s.length;
  const pct = counts.map(c => (total ? (c / total) * 100 : 0));
  let hot = 0, cold = 0;
  pct.forEach((v, d) => { if (v > pct[hot]!) hot = d; if (v < pct[cold]!) cold = d; });
  const sum = (f: (d: number) => boolean) => pct.reduce((a, v, d) => (f(d) ? a + v : a), 0);
  return { pct, total, hot, cold, even: sum(d => d % 2 === 0), odd: sum(d => d % 2 === 1), over: sum(d => d > barrier), under: sum(d => d < barrier) };
}

export type DigitContract = "DIGITMATCH" | "DIGITDIFF" | "DIGITOVER" | "DIGITUNDER" | "DIGITEVEN" | "DIGITODD";

/** Whether a digit contract wins for a given exit digit. */
export function evaluateDigit(type: DigitContract, exit: number, barrier: number): boolean {
  switch (type) {
    case "DIGITMATCH": return exit === barrier;
    case "DIGITDIFF": return exit !== barrier;
    case "DIGITOVER": return exit > barrier;
    case "DIGITUNDER": return exit < barrier;
    case "DIGITEVEN": return exit % 2 === 0;
    case "DIGITODD": return exit % 2 === 1;
  }
}

/** Fair-odds payout ratio (stake multiple) for a uniform digit, before broker margin. */
export function fairPayoutRatio(type: DigitContract, barrier: number): number {
  const wins = Array.from({ length: 10 }, (_, d) => d).filter(d => evaluateDigit(type, d, barrier)).length;
  return wins ? 10 / wins : 0;
}

export type DigitSignal = { name: string; pick: string; confidence: number; note: string };

/** Mean reversion, over/under, matches/differs and even/odd momentum from the studio stats. */
export function digitSignals(st: DigitStudio, recent: DigitStudio, barrier: number): DigitSignal[] {
  const skew = st.pct[st.hot]! - st.pct[st.cold]!;
  return [
    { name: "Mean reversion", pick: `Differs ${st.hot}`, confidence: Math.round(Math.min(95, 50 + skew * 2)), note: `Hot ${st.hot} (${st.pct[st.hot]!.toFixed(0)}%) vs cold ${st.cold} (${st.pct[st.cold]!.toFixed(0)}%)` },
    st.over >= st.under
      ? { name: "Over/Under", pick: `Over ${barrier}`, confidence: Math.round(st.over), note: `Over ${st.over.toFixed(0)}% · last ticks ${recent.over.toFixed(0)}%` }
      : { name: "Over/Under", pick: `Under ${barrier}`, confidence: Math.round(st.under), note: `Under ${st.under.toFixed(0)}% · last ticks ${recent.under.toFixed(0)}%` },
    { name: "Matches/Differs", pick: st.pct[st.cold]! < 6 ? `Differs ${st.cold}` : `Differs ${st.hot}`, confidence: Math.round(100 - Math.min(st.pct[st.cold]!, st.pct[st.hot]!)), note: "Matches pays more but wins on one digit only" },
    recent.even >= 50
      ? { name: "Even/Odd momentum", pick: "Even", confidence: Math.round((st.even + recent.even) / 2), note: `Even ${st.even.toFixed(0)}% · recent ${recent.even.toFixed(0)}%` }
      : { name: "Even/Odd momentum", pick: "Odd", confidence: Math.round((st.odd + recent.odd) / 2), note: `Odd ${st.odd.toFixed(0)}% · recent ${recent.odd.toFixed(0)}%` },
  ];
}

export type ScanRow = { symbol: string; name: string; kind: Kind; label: string; side: string | null; confidence: number; edge: number; note: string };

/** Score every contract type on one instrument; confluence blends the per-kind signal with chart patterns. */
export function scanInstrument(symbol: string, name: string, prices: number[], decimals: number): ScanRow[] {
  const pat = analyzePatterns(prices);
  return (Object.keys(CONTRACTS) as Kind[]).map(kind => {
    const def = CONTRACTS[kind];
    const s = kindSignal(kind, prices, decimals, { digit: 5, offset: 0.5, hi: 1, lo: -1, ticks: 5 });
    const agrees = pat.side !== null && pat.side === s.side && !def.digits;
    const confidence = s.side === null ? 0 : Math.min(100, Math.round(s.confidence * 0.8 + (agrees ? pat.confidence * 0.2 : 0)));
    return { symbol, name, kind, label: def.label, side: s.side === null ? null : def.sides[s.side] ?? null, confidence, edge: Math.max(0, confidence - 50), note: s.note };
  });
}

export function rankRows(rows: ScanRow[]): ScanRow[] {
  return rows.filter(r => r.side !== null).sort((a, b) => b.confidence - a.confidence);
}
