import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG } from "@/lib/contracts";
import { digitSignals, digitStudio, rankRows, scanInstrument, type ScanRow } from "@/lib/scanner";

export const Route = createFileRoute("/scanner")({
  head: () => ({
    meta: [
      { title: "Universal Signal Matrix · MWASE KING JAGUAR HACKING BOT" },
      { name: "description", content: "Live digit studio and confluence scanner ranking every Deriv instrument and contract type. Estimates only, no guaranteed profits." },
      { property: "og:title", content: "Universal Signal Matrix · MWASE KING JAGUAR" },
      { property: "og:description", content: "Rank all Deriv instruments and contract types by confluence confidence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Scanner,
});

// Public market data only — no account token is used on this page.
const WS = "wss://ws.derivws.com/websockets/v3?app_id=1089";
type Feed = { prices: number[]; decimals: number };

function Scanner() {
  const [feeds, setFeeds] = useState<Record<string, Feed>>({});
  const [status, setStatus] = useState("Connecting…");
  const [group, setGroup] = useState("All");
  const [focus, setFocus] = useState("R_100");
  const [win, setWin] = useState(100);
  const [barrier, setBarrier] = useState(4);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stop = false;
    const sock = new WebSocket(WS);
    ws.current = sock;
    const scanAll = () => CATALOG.forEach((inst, i) => setTimeout(() => {
      if (sock.readyState === 1) sock.send(JSON.stringify({ ticks_history: inst.symbol, end: "latest", count: 300, style: "ticks", passthrough: { s: inst.symbol } }));
    }, i * 120));
    sock.onopen = () => { setStatus("Scanning all instruments"); scanAll(); };
    sock.onerror = () => setStatus("Connection blocked — check ad-blocker or network");
    sock.onclose = () => { if (!stop) setStatus("Disconnected"); };
    sock.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.msg_type !== "history" || m.error) return;
      const prices: number[] = m.history.prices;
      const decimals = Math.max(...prices.slice(-50).map(p => (String(p).split(".")[1] ?? "").length));
      setFeeds(f => ({ ...f, [m.passthrough.s]: { prices, decimals } }));
    };
    const t = setInterval(scanAll, 45000);
    return () => { stop = true; clearInterval(t); sock.close(); };
  }, []);

  const rows = useMemo<ScanRow[]>(() => rankRows(CATALOG.filter(i => group === "All" || i.group === group)
    .flatMap(i => feeds[i.symbol] ? scanInstrument(i.symbol, i.name, feeds[i.symbol]!.prices, feeds[i.symbol]!.decimals) : [])).slice(0, 60), [feeds, group]);

  const f = feeds[focus];
  const st = f ? digitStudio(f.prices, f.decimals, win, barrier) : null;
  const sig = f && st ? digitSignals(st, digitStudio(f.prices, f.decimals, 20, barrier), barrier) : [];
  const groups = ["All", ...new Set(CATALOG.map(i => i.group))];
  const field = "rounded-sm border border-input bg-background px-2 py-1 text-xs";

  return <main className="min-h-screen space-y-6 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-glow text-lg font-bold sm:text-xl">UNIVERSAL <span className="text-primary">SIGNAL MATRIX</span></h1>
      <div className="flex items-center gap-3 text-xs"><span className="text-telemetry">● {status} · {Object.keys(feeds).length}/{CATALOG.length}</span><Link to="/" className="rounded-sm border border-primary px-3 py-1 text-primary">← Trading terminal</Link></div>
    </header>

    <section className="glass space-y-4 rounded-sm p-4">
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <h2 className="mr-auto text-base font-bold">Digit Signal Studio</h2>
        <label className="flex flex-col gap-1">Instrument<select value={focus} onChange={e => setFocus(e.target.value)} className={field}>{CATALOG.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</select></label>
        <label className="flex flex-col gap-1">Ticks<select value={win} onChange={e => setWin(Number(e.target.value))} className={field}>{[50, 100, 200].map(n => <option key={n}>{n}</option>)}</select></label>
        <label className="flex flex-col gap-1">Barrier<select value={barrier} onChange={e => setBarrier(Number(e.target.value))} className={field}>{Array.from({ length: 10 }, (_, d) => <option key={d}>{d}</option>)}</select></label>
      </div>
      {!st ? <p className="text-xs text-muted-foreground">Loading ticks…</p> : <>
        <div className="grid grid-cols-10 items-end gap-1" style={{ height: 140 }}>
          {st.pct.map((v, d) => <div key={d} className="flex h-full flex-col items-center justify-end gap-1 text-[10px]">
            <span>{v.toFixed(0)}%</span>
            <div className={`w-full rounded-t-sm ${d === st.hot ? "bg-up" : d === st.cold ? "bg-down" : "bg-primary/60"}`} style={{ height: `${Math.max(4, v * 4)}%` }} />
            <span className="font-bold">{d}</span>
          </div>)}
        </div>
        <div className="flex h-5 overflow-hidden rounded-sm text-[10px]">
          <div className="flex items-center justify-center bg-primary text-primary-foreground" style={{ width: `${st.even}%` }}>EVEN {st.even.toFixed(0)}%</div>
          <div className="flex flex-1 items-center justify-center bg-secondary">ODD {st.odd.toFixed(0)}%</div>
        </div>
        <p className="text-xs text-muted-foreground">Over {barrier}: {st.over.toFixed(0)}% · Under {barrier}: {st.under.toFixed(0)}% · Hot {st.hot} · Cold {st.cold} · {st.total} ticks</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{sig.map(s => <div key={s.name} className="rounded-sm border border-border p-3 text-xs">
          <div className="text-telemetry">{s.name}</div><div className="my-1 text-base font-bold">{s.pick} <span className="font-mono">{s.confidence}%</span></div><div className="text-muted-foreground">{s.note}</div>
        </div>)}</div>
      </>}
    </section>

    <section className="glass space-y-3 rounded-sm p-4">
      <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-base font-bold">All instruments × all contract types</h2>
        <select value={group} onChange={e => setGroup(e.target.value)} className={field}>{groups.map(g => <option key={g}>{g}</option>)}</select></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead className="text-muted-foreground"><tr><th className="p-2">#</th><th>Instrument</th><th>Contract</th><th>Bias</th><th>Confidence</th><th>Edge</th><th>Why</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.symbol + r.kind} className="border-t border-border">
          <td className="p-2">{i + 1}</td><td>{r.name}</td><td>{r.label}</td><td className="font-bold text-primary">{r.side}</td>
          <td><div className="flex items-center gap-2"><div className="h-1.5 w-16 bg-secondary"><div className="h-full bg-up" style={{ width: `${r.confidence}%` }} /></div>{r.confidence}%</div></td>
          <td>+{r.edge}</td><td className="text-muted-foreground">{r.note}</td></tr>)}</tbody>
      </table>{!rows.length && <p className="p-4 text-xs text-muted-foreground">Waiting for market data… closed markets (forex, stocks on weekends) show no signals.</p>}</div>
      <p className="text-xs text-muted-foreground">Confidence is a statistical estimate from recent ticks, not a win probability. Place orders from the trading terminal.</p>
    </section>
  </main>;
}
