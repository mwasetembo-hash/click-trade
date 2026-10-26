import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight, BarChart3, CircleStop, Radio, RefreshCw, ShieldCheck, Terminal, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMarketFeed } from "@/hooks/use-market-feed";
import { CONTRACTS, lastDigit, type Kind } from "@/lib/contracts";
import { digitStudio, scanInstrument } from "@/lib/scanner";
import { contractParameterError, progressedStake, riskBlock, settlePaperTick, signalFresh, threeDigitTrigger, type PaperOrder, type RiskLimits } from "@/lib/terminal-engine";
import emblem from "@/assets/terminal-emblem.jpeg.asset.json";

type QuoteTicket = { symbol: string; kind: Kind; side: 0 | 1; stake: number; payout: number; duration: number; barrier: number; entry: number; decimals: number; expires: number };
const PAPER_KINDS: Kind[] = ["RISE_FALL", "HIGHER_LOWER", "MATCH_DIFF", "OVER_UNDER", "EVEN_ODD"];
const FILTERS = ["All Markets", "Synthetic", "Forex", "Commodities", "Crypto", "Stock Indices"];

export function UnifiedTerminal({ onBroker, matrix = false }: { onBroker?: () => void; matrix?: boolean }) {
  const marketData = useMarketFeed();
  const { markets, feeds, contracts, status, request, addEvent } = marketData;
  const [filter, setFilter] = useState("All Markets");
  const [symbol, setSymbol] = useState("R_50");
  const [kind, setKind] = useState<Kind>("EVEN_ODD");
  const [digit, setDigit] = useState(4);
  const [offset, setOffset] = useState(0.61);
  const [windowSize, setWindowSize] = useState(100);
  const [minimum, setMinimum] = useState(100);
  const [triple, setTriple] = useState(false);
  const [duration, setDuration] = useState(5);
  const [stake, setStake] = useState(1);
  const [progression, setProgression] = useState(false);
  const [multiplier, setMultiplier] = useState(2.1);
  const [steps, setSteps] = useState(2);
  const [limits, setLimits] = useState<RiskLimits>({ stopLoss: 20, takeProfit: 10, dailyCap: 30, maxOpen: 20, maxLosses: 3, cooldown: 5, maxStake: 10 });
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(false);
  autoRef.current = auto;
  const [ticket, setTicket] = useState<QuoteTicket | null>(null);
  const [quoting, setQuoting] = useState(false);
  const quoteLock = useRef(false);
  const stopEpoch = useRef(0);
  const lastAuto = useRef(0);
  const lastTick = useRef(new Map<string, number>());
  const nextId = useRef(1);
  const [message, setMessage] = useState("");
  const [posts, setPosts] = useState<{ text: string; time: string }[]>([]);
  const [post, setPost] = useState("");
  const [clock, setClock] = useState(0);
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t); }, []);
  const feed = feeds[symbol];
  const market = markets.find(m => m.symbol === symbol);
  const definition = CONTRACTS[kind];
  const studio = feed ? digitStudio(feed.prices, feed.decimals, windowSize, digit) : null;
  const selected = feed ? scanInstrument(symbol, market?.name ?? symbol, feed.prices, feed.decimals).find(r => r.kind === kind) : undefined;
  const last = feed?.prices.at(-1);
  const signalSide = selected?.side === definition.sides[0] ? 0 : selected?.side === definition.sides[1] ? 1 : null;
  const trigger = feed && triple && kind === "EVEN_ODD" ? threeDigitTrigger(feed.prices, feed.decimals, minimum) : signalSide;
  const fresh = feed && signalFresh(feed.timestamp, clock || Date.now());
  const filtered = markets.filter(m => filter === "All Markets" || (filter === "Synthetic" ? m.group === "Derived" : filter === "Commodities" ? ["Commodities", "Gold & Metals"].includes(m.group) : m.group === filter));
  const rows = useMemo(() => filtered.flatMap(m => {
    const f = feeds[m.symbol];
    if (!f) return [];
    return scanInstrument(m.symbol, m.name, f.prices, f.decimals).filter(r => CONTRACTS[r.kind].types.some(ct => contracts[m.symbol]?.includes(ct))).map(r => ({ ...r, timestamp: f.timestamp }));
  }).sort((a, b) => b.confidence - a.confidence), [filtered, feeds, contracts]);
  const completed = orders.filter(o => o.profit !== null);
  const net = completed.reduce((sum, o) => sum + (o.profit ?? 0), 0);
  const reserved = orders.filter(o => o.profit === null).reduce((sum, o) => sum + o.stake, 0);
  const virtualBalance = 10000 + net - reserved;
  const wins = completed.filter(o => (o.profit ?? 0) > 0).length;
  const getRisk = () => {
    const current = ordersRef.current;
    const finished = current.filter(o => o.profit !== null).sort((a, b) => (b.settled ?? 0) - (a.settled ?? 0));
    let losses = 0;
    for (const o of finished) { if ((o.profit ?? 0) < 0) losses++; else break; }
    const today = new Date().toISOString().slice(0, 10);
    return { net: finished.reduce((s, o) => s + (o.profit ?? 0), 0), dailyLoss: finished.filter(o => o.settled && new Date(o.settled).toISOString().slice(0, 10) === today).reduce((s, o) => s + Math.max(0, -(o.profit ?? 0)), 0), losses, open: current.length - finished.length, lastSettlement: finished[0]?.settled ?? 0 };
  };
  const actualStake = progressedStake(stake, multiplier, getRisk().losses, steps, limits.maxStake, progression);

  useEffect(() => {
    const current = ordersRef.current;
    let updated = current;
    for (const [s, f] of Object.entries(feeds)) {
      if (!signalFresh(f.timestamp) || (lastTick.current.get(s) ?? 0) >= f.timestamp) continue;
      lastTick.current.set(s, f.timestamp);
      const quote = f.prices.at(-1);
      if (quote === undefined) continue;
      updated = updated.map(o => {
        if (o.symbol !== s || o.profit !== null || f.timestamp <= o.created) return o;
        const next = settlePaperTick(o, quote, f.timestamp);
        if (next.profit !== null) addEvent(`VIRTUAL SETTLEMENT #${o.id}: ${next.profit.toFixed(2)} USD`);
        return next;
      });
    }
    if (updated !== current) { ordersRef.current = updated; setOrders(updated); }
  }, [feeds, addEvent]);

  const barrierFor = (side: 0 | 1) => definition.barrier === "digit" ? digit : kind === "HIGHER_LOWER" ? (side === 0 ? Math.abs(offset) : -Math.abs(offset)) : 0;
  const prepare = async (side: 0 | 1, automatic = false) => {
    if (quoteLock.current) return;
    const epoch = stopEpoch.current;
    const amount = actualStake;
    const barrier = barrierFor(side);
    const ct = definition.types[side];
    const parameter = contractParameterError(kind, side, definition.barrier === "digit" ? String(barrier) : definition.barrier === "offset" ? `${barrier >= 0 ? "+" : ""}${barrier}` : undefined, duration, "t");
    const block = riskBlock(limits, getRisk(), amount);
    const problem = block ?? parameter ?? (status !== "Connected" ? "Market feed disconnected" : !fresh ? "Waiting for fresh market ticks" : !contracts[symbol]?.includes(ct) ? "Contract availability not confirmed for this market" : (feed?.prices.length ?? 0) < minimum ? "Not enough ticks for the chosen minimum sample" : null);
    if (problem || last === undefined || !feed) { setMessage(problem ?? "No market price"); if (automatic) setAuto(false); return; }
    quoteLock.current = true; setQuoting(true); setMessage("");
    try {
      const params: Record<string, unknown> = { proposal: 1, amount, basis: "stake", currency: "USD", contract_type: ct, symbol, duration, duration_unit: "t" };
      if (definition.barrier !== "none") params.barrier = definition.barrier === "digit" ? String(barrier) : `${barrier >= 0 ? "+" : ""}${barrier}`;
      const response = await request(params);
      const payout = Number(response.proposal?.payout);
      if (!Number.isFinite(payout) || payout <= 0) throw new Error("Deriv did not return a valid proposal payout");
      const quoted = { symbol, kind, side, stake: amount, payout, duration, barrier, entry: last, decimals: feed.decimals, expires: Date.now() + 10000 };
      addEvent(`PROPOSAL ${ct} on ${symbol}: stake ${amount.toFixed(2)}, payout ${payout.toFixed(2)} — virtual only`);
      if (epoch !== stopEpoch.current) return;
      if (automatic && autoRef.current) execute(quoted); else if (!automatic) setTicket(quoted);
    } catch (e) { const text = e instanceof Error ? e.message : "Proposal failed"; setMessage(text); addEvent(`PROPOSAL ERROR: ${text}`); if (automatic) setAuto(false); }
    finally { quoteLock.current = false; setQuoting(false); }
  };
  const execute = (quote: QuoteTicket) => {
    const currentFeed = feeds[quote.symbol];
    const block = riskBlock(limits, getRisk(), quote.stake);
    if (block || Date.now() > quote.expires || !currentFeed || !signalFresh(currentFeed.timestamp) || status !== "Connected") { setTicket(null); setMessage(block ?? "Quote expired or market disconnected — request a new proposal"); return; }
    const entry = currentFeed.prices.at(-1);
    if (entry === undefined) return;
    const o: PaperOrder = { id: nextId.current++, symbol: quote.symbol, kind: quote.kind, contract: CONTRACTS[quote.kind].types[quote.side], barrier: quote.barrier, entry, decimals: quote.decimals, remaining: quote.duration, stake: quote.stake, payout: quote.payout, profit: null, created: Date.now(), day: new Date().toISOString().slice(0, 10) };
    ordersRef.current = [o, ...ordersRef.current]; setOrders(ordersRef.current); setTicket(null);
    addEvent(`VIRTUAL OPEN #${o.id}: ${o.contract}, ${o.remaining} ticks, ${o.stake.toFixed(2)} USD`);
  };
  useEffect(() => {
    if (!auto) return;
    const block = riskBlock(limits, getRisk(), actualStake);
    if (block && block !== "Cooldown active" && block !== "Maximum open trades reached") { setAuto(false); setMessage(block); addEvent(`VIRTUAL BOT STOP: ${block}`); return; }
    if (block || quoteLock.current || trigger === null || !feed || !fresh || lastAuto.current === feed.timestamp) return;
    lastAuto.current = feed.timestamp;
    if (trigger === 0 || trigger === 1) void prepare(trigger, true);
  }, [auto, feeds, clock]); // Risk and quote gates are checked again immediately before opening.

  const number = (label: string, value: number, change: (n: number) => void, step = 1) => <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">{label}<input type="number" aria-label={label} className="terminal-input" value={value} step={step} onChange={e => change(Number(e.target.value))} /></label>;
  const chart = feed?.prices.slice(-100) ?? [];
  const min = Math.min(...chart), max = Math.max(...chart);
  const points = chart.map((p, i) => `${i / Math.max(1, chart.length - 1) * 600},${150 - (p - min) / (max - min || 1) * 130}`).join(" ");
  return <main className="unified-terminal min-h-screen bg-background font-sans text-foreground">
    <header className="terminal-header flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
      <div className="flex items-center gap-3"><img src={emblem.url} className="h-12 w-12 rounded-sm object-cover" alt="Jaguar emblem" /><div><h1 className="text-lg font-bold sm:text-xl">MWASE <span className="text-primary">HACKING BOT</span></h1><p className="text-[10px] text-muted-foreground sm:text-xs">Universal Deriv Signal & Automation Engine</p></div></div>
      <nav className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" asChild><Link to={matrix ? "/" : "/scanner"}><BarChart3 />{matrix ? "Dashboard" : "Signal matrix"}</Link></Button>{onBroker && <Button size="sm" onClick={onBroker}><ShieldCheck />Broker terminal<ArrowRight /></Button>}<Button variant="outline" size="icon" title="Reconnect public market feed" aria-label="Reconnect public market feed" onClick={marketData.reconnect}><RefreshCw /></Button></nav>
    </header>
    <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 font-mono text-xs sm:px-8"><span className={status === "Connected" ? "text-up" : "text-warning"}><Radio size={12} className="mr-2 inline" />PUBLIC DATA · {status.toUpperCase()}</span><span className="text-muted-foreground">{markets.length} discovered · {Object.keys(feeds).length} receiving ticks</span><span className="ml-auto text-warning">PAPER MODE · NO BROKER PURCHASES</span></div>
    <div className="ticker-band flex gap-6 overflow-hidden border-b border-border px-4 py-3 font-mono text-xs">{markets.filter(m => feeds[m.symbol]).slice(0, 12).map(m => <span key={m.symbol} className="shrink-0"><span className="text-muted-foreground">{m.name} </span><b className="text-primary">{feeds[m.symbol]?.prices.at(-1)?.toFixed(m.decimals)}</b></span>)}{!Object.keys(feeds).length && <span className="text-muted-foreground">No market prices received</span>}</div>
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-8">
      <section className="grid grid-cols-2 gap-3 border-b border-border pb-5 lg:grid-cols-5">{[["VIRTUAL BALANCE", `$${virtualBalance.toFixed(2)}`], ["VIRTUAL SESSION P/L", `${net >= 0 ? "+" : ""}$${net.toFixed(2)}`], ["COMPLETED WIN RATE", completed.length ? `${(wins / completed.length * 100).toFixed(1)}%` : "—"], ["VIRTUAL STAKE", `$${actualStake.toFixed(2)}`], ["ENGINE STATE", quoting ? "QUOTING" : auto ? "PAPER AUTO" : "STANDBY"]].map(([label, value]) => <div key={label} className="border-l-2 border-primary px-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-2 break-words font-mono text-lg font-semibold">{value}</p></div>)}</section>
      <div className="flex flex-wrap gap-2">{FILTERS.map(f => <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</Button>)}</div>
      {(message || marketData.error) && <p role="alert" className="border-l-2 border-warning bg-secondary p-3 text-sm text-warning">{message || marketData.error}</p>}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-semibold"><Activity className="text-primary" size={18} />Market monitor</h2><select aria-label="Market" value={symbol} onChange={e => { setSymbol(e.target.value); setAuto(false); setTicket(null); }} className="terminal-input max-w-full">{!markets.length && <option value="R_50">Waiting for instruments</option>}{markets.map(m => <option key={m.symbol} value={m.symbol}>{m.name}{!m.open ? " · closed" : ""}</option>)}</select></div>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-mono text-2xl text-primary">{last?.toFixed(feed?.decimals ?? 2) ?? "—"}</span><span className="font-mono text-xs text-muted-foreground">{feed ? `${fresh ? "LIVE TICK" : "STALE"} · ${new Date(feed.timestamp).toLocaleTimeString()}` : "AWAITING DATA"}</span></div>
            <div className="market-chart relative h-52 border-y border-border"><svg viewBox="0 0 600 170" className="h-full w-full" preserveAspectRatio="none" aria-label="Received market ticks"><polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="2" /></svg>{!chart.length && <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-muted-foreground">NO RECEIVED MARKET TICKS</div>}</div>
          </section>
          <section className="space-y-4 border-t border-border pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Digit analysis <span className="ml-2 font-mono text-xs text-primary">0–9</span></h2><select aria-label="Digit analysis window" className="terminal-input" value={windowSize} onChange={e => setWindowSize(Number(e.target.value))}>{[50, 100, 200].map(n => <option key={n} value={n}>{n} ticks</option>)}</select></div>
            <div className="grid h-40 grid-cols-10 items-end gap-2">{Array.from({ length: 10 }, (_, d) => { const pct = studio?.pct[d] ?? 0; return <div key={d} className="flex h-full flex-col items-center justify-end gap-2 font-mono text-[10px]"><span>{pct.toFixed(0)}%</span><div className={`w-full ${d === studio?.hot ? "bg-up" : d === studio?.cold ? "bg-down" : "bg-primary/60"}`} style={{ height: `${Math.min(80, Math.max(2, pct * 3))}%` }} /><span className="text-sm">{d}</span></div>; })}</div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><span className="text-up">Even {studio?.even.toFixed(1) ?? "—"}%</span><span className="text-down">Odd {studio?.odd.toFixed(1) ?? "—"}%</span><span>Over {digit}: {studio?.over.toFixed(1) ?? "—"}%</span><span>Under {digit}: {studio?.under.toFixed(1) ?? "—"}%</span></div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs"><span className="text-muted-foreground">LAST 10</span>{feed?.prices.slice(-10).map((p, i) => <span key={i} className="flex h-7 w-7 items-center justify-center border border-border text-primary">{lastDigit(p, feed.decimals)}</span>)}</div><p className="text-xs text-muted-foreground">Received digit frequencies are descriptive, not predictions of the next digit.</p>
          </section>
          <section className="space-y-3 border-t border-border pt-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Universal signal matrix</h2><span className="font-mono text-xs text-muted-foreground">{rows.length} supported analyses</span></div><div className="max-h-96 overflow-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="sticky top-0 bg-background text-muted-foreground"><tr>{["Instrument", "Strategy", "Bias", "Rule score", "Evidence", "Tick time"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{rows.slice(0, matrix ? 150 : 40).map(r => <tr key={r.symbol + r.kind} className="border-t border-border"><td className="p-3"><Button size="sm" variant="link" onClick={() => { setSymbol(r.symbol); if (PAPER_KINDS.includes(r.kind)) setKind(r.kind); setAuto(false); }}>{r.name}</Button></td><td>{r.label}</td><td className={signalFresh(r.timestamp, clock || Date.now()) ? "text-primary" : "text-muted-foreground"}>{signalFresh(r.timestamp, clock || Date.now()) ? r.side ?? "NO TRADE" : "STALE"}</td><td className="font-mono">{r.confidence}/100</td><td className="max-w-64 p-3 text-muted-foreground">{r.note}</td><td className="font-mono">{new Date(r.timestamp).toLocaleTimeString()}</td></tr>)}</tbody></table>{!rows.length && <p className="py-6 text-sm text-muted-foreground">Waiting for broker-discovered contracts and received tick history.</p>}</div><p className="text-xs text-muted-foreground">Scores summarize rule agreement, not win probability. Expected financial edge is uncalibrated.</p></section>
        </div>
        <aside className="space-y-6 border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <section className="space-y-4"><h2 className="flex items-center gap-2 font-semibold"><Zap size={17} className="text-primary" />Virtual order engine</h2><div className="border-l-2 border-warning pl-3 text-xs text-warning">PAPER · virtual $10,000 · no real orders</div><label className="flex flex-col gap-1 text-xs text-muted-foreground">Strategy<select aria-label="Paper strategy" className="terminal-input" value={kind} onChange={e => { setKind(e.target.value as Kind); setAuto(false); }}>{PAPER_KINDS.map(k => <option key={k} value={k}>{CONTRACTS[k].label}</option>)}</select></label><div className="grid grid-cols-2 gap-3">{number("Base stake", stake, setStake, 0.01)}{number("Expiry ticks", duration, setDuration)}{definition.barrier === "digit" && number("Prediction digit", digit, setDigit)}{kind === "HIGHER_LOWER" && number("Barrier magnitude", offset, setOffset, 0.1)}{number("Minimum sample", minimum, setMinimum)}</div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={triple} onChange={e => setTriple(e.target.checked)} />Three consecutive parity trigger</label><div className="border-y border-border py-3"><p className="text-xs text-muted-foreground">{fresh && trigger !== null ? definition.sides[trigger] : "NO TRADE"} · rule score {selected?.confidence ?? 0}/100</p><p className="mt-1 text-xs text-muted-foreground">{selected?.note ?? "Awaiting sufficient ticks"}</p></div><div className="grid grid-cols-2 gap-2">{([0, 1] as const).map(side => <Button key={side} size="sm" variant="outline" disabled={quoting || status !== "Connected" || !fresh} onClick={() => void prepare(side)}>{definition.sides[side]}</Button>)}</div>
            <Button className="w-full" variant={auto ? "destructive" : "default"} disabled={!auto && status !== "Connected"} onClick={() => { if (auto) { stopEpoch.current++; setAuto(false); addEvent("VIRTUAL BOT STOP requested"); } else { setAuto(true); addEvent("VIRTUAL BOT enabled — demo only"); } }}>{auto ? <CircleStop /> : <Zap />}{auto ? "Stop paper bot" : "Enable paper auto"}</Button><Button className="w-full" variant="destructive" onClick={() => { stopEpoch.current++; autoRef.current = false; setAuto(false); setTicket(null); addEvent("EMERGENCY STOP — no new virtual orders; open orders remain tracked"); }}><CircleStop />Emergency stop</Button>
          </section>
          <section className="space-y-3 border-t border-border pt-5"><h2 className="font-semibold">Risk safeguards</h2><div className="grid grid-cols-2 gap-3">{(Object.keys(limits) as (keyof RiskLimits)[]).map(key => number(({ stopLoss: "Stop loss $", takeProfit: "Take profit $", dailyCap: "Daily loss cap $", maxOpen: "Max open trades", maxLosses: "Max loss streak", cooldown: "Cooldown seconds", maxStake: "Maximum stake $" } as const)[key], limits[key], n => setLimits(l => ({ ...l, [key]: n })))}</div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={progression} onChange={e => setProgression(e.target.checked)} />Capped progression · high risk</label>{progression && <><div className="grid grid-cols-2 gap-3">{number("Loss multiplier", multiplier, setMultiplier, 0.1)}{number("Progression steps", steps, setSteps)}</div><p className="text-xs text-down">Progression increases exposure after losses and can rapidly exhaust your balance.</p></>}</section>
          <section className="space-y-3 border-t border-border pt-5"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Terminal size={17} />Engine terminal</h2><Button size="icon" variant="ghost" aria-label="Clear engine log" title="Clear engine log" onClick={marketData.clearEvents}><Trash2 /></Button></div><div className="max-h-64 space-y-2 overflow-auto font-mono text-[10px] text-muted-foreground">{marketData.events.map((e, i) => <p key={i}>{e}</p>)}</div></section>
        </aside>
      </div>
      <section className="border-t border-border pt-5"><h2 className="mb-3 font-semibold">Virtual trade journal</h2><div className="max-h-64 overflow-auto"><table className="w-full min-w-[550px] text-left font-mono text-xs"><thead className="text-muted-foreground"><tr>{["Order", "Market", "Contract", "Stake", "Status", "Virtual P/L"].map(h => <th key={h} className="py-3">{h}</th>)}</tr></thead><tbody>{orders.map(o => <tr key={o.id} className="border-t border-border"><td className="py-3">VIRTUAL #{o.id}</td><td>{o.symbol}</td><td>{o.contract}</td><td>{o.stake.toFixed(2)}</td><td>{o.profit === null ? `${o.remaining} ticks remaining` : "Settled"}</td><td className={o.profit === null ? "text-muted-foreground" : o.profit >= 0 ? "text-up" : "text-down"}>{o.profit?.toFixed(2) ?? "—"}</td></tr>)}</tbody></table>{!orders.length && <p className="py-3 text-sm text-muted-foreground">No virtual trades in this session.</p>}</div></section>
      <section className="grid gap-6 border-t border-border pt-5 md:grid-cols-2"><div className="space-y-3"><h2 className="font-semibold">Local demo community</h2><form onSubmit={e => { e.preventDefault(); const text = post.trim(); if (!text || text.length > 500) { setMessage("Message must contain 1–500 characters"); return; } setPosts(p => [{ text, time: new Date().toLocaleTimeString() }, ...p].slice(0, 30)); setPost(""); }} className="flex gap-2"><input className="terminal-input min-w-0 flex-1" aria-label="Local demo message" value={post} maxLength={500} onChange={e => setPost(e.target.value)} placeholder="Local demo message" /><Button type="submit" size="sm">Post</Button></form>{posts.map((p, i) => <div key={i} className="border-b border-border py-2 text-sm"><p className="text-[10px] text-muted-foreground">LOCAL DEMO · {p.time}</p><p className="break-words">{p.text}</p></div>)}<p className="text-xs text-muted-foreground">Session-only posts. No shared community or testimonials.</p></div><div className="space-y-3"><h2 className="font-semibold">Help & account access</h2><Button asChild variant="outline" size="sm"><a href="https://developers.deriv.com/" target="_blank" rel="noreferrer">Deriv developer help<ArrowRight /></a></Button><p className="text-xs text-muted-foreground">Public data access is separate from account authorization. Broker execution, paired ±0.5 batches and account switching are available in the broker terminal.</p><p className="text-xs text-warning">Revoke previously exposed tokens. Enter replacement credentials only in the broker terminal.</p></div></section>
    </div>
    {ticket && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4"><section role="dialog" aria-modal="true" aria-label="Confirm virtual order" className="w-full max-w-md space-y-4 rounded-sm border border-primary bg-card p-6"><h2 className="text-lg font-semibold">Confirm virtual order</h2><p className="text-xs text-warning">PAPER ONLY · no Deriv purchase</p><dl className="space-y-2 text-sm">{[["Market", ticket.symbol], ["Contract", CONTRACTS[ticket.kind].sides[ticket.side]], ["Stake", `${ticket.stake.toFixed(2)} USD`], ["Broker proposal payout", `${ticket.payout.toFixed(2)} USD`], ["Expiry", `${ticket.duration} ticks`], ["Barrier", String(ticket.barrier)]].map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="font-mono">{v}</dd></div>)}</dl><p className="text-xs text-muted-foreground">The quote sizes a virtual result. Paper fills are not broker fills.</p><div className="flex gap-3"><Button variant="outline" onClick={() => setTicket(null)}>Cancel</Button><Button disabled={clock > ticket.expires} onClick={() => execute(ticket)}>Confirm paper trade</Button></div></section></div>}
  </main>;
}