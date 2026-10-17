import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { DerivClient, computeSignal, fetchAccounts, fetchOtpUrl, type DerivAccount } from "@/lib/deriv";
import { CATALOG, CONTRACTS, digitStats, groupOf, kindSignal, trendStrength, type Inst, type Kind } from "@/lib/contracts";
import { DiagnosePanel } from "@/components/DiagnosePanel";
import { BrainPanel } from "@/components/BrainPanel";
import { MatrixBackground } from "@/components/MatrixBackground";
import type { BrainVerdict } from "@/lib/brain-providers";
import { runsSignal } from "@/lib/runs";
import { analyzePatterns, runSetup, SETUPS, type SetupId } from "@/lib/patterns";
import { Journal } from "@/components/Journal";
import { Profiles } from "@/components/Profiles";
import { Button } from "@/components/ui/button";
import { Activity, Cpu, ShieldCheck, Terminal, Zap } from "lucide-react";
import terminalEmblem from "@/assets/terminal-emblem.jpeg.asset.json";
import { ExecutionConsole } from "@/components/ExecutionConsole";
import { balanceStakeCap, stakeProtection, demoStrategyStats } from "@/lib/trading-session";
import { canCloseCompanion, dispatchTogether } from "@/lib/paired-execution";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MWASE HYBRID_EXEC — Cyber Trading Terminal" },
      { name: "description", content: "Mwase Signal Forge: three trend-confirmed strategies, demo performance comparison, balance-based stake protection and confirmed Deriv trading results." },
      { property: "og:title", content: "MWASE HYBRID_EXEC — Cyber Trading Terminal" },
      { property: "og:description", content: "A cyber trading console with demo strategy comparison, balance-based protection and real order states. No guaranteed profits." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type Mode = "SIDE_A" | "SIDE_B" | "SIGNAL";
type Trade = { id: number; label: string; stake: number; profit: number | null; symbol: string; time: string; setup?: string | undefined; demo?: boolean; accountId?: string };
type ScanRow = { symbol: string; name: string; group: string; trend: number; conf: number; dir: string };
type Unit = "t" | "s" | "m";

const LS = "mwase-deriv-config";
const GROUPS = ["Forex", "Gold & Metals", "Commodities", "Stock Indices", "Crypto", "Derived"];

function Dashboard() {
  const client = useRef<DerivClient | null>(null);
  const [appId, setAppId] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"off" | "connecting" | "on">("off");
  const [error, setError] = useState("");
  const [account, setAccount] = useState<{ loginid: string; currency: string; isVirtual: boolean } | null>(null);
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [instruments, setInstruments] = useState<(Inst & { open?: boolean; pip?: number | undefined })[]>(CATALOG);
  const [symbol, setSymbol] = useState("R_50");
  const [prices, setPrices] = useState<number[]>([]);
  const [kind, setKind] = useState<Kind>("RUNS");
  const [mode, setMode] = useState<Mode>("SIGNAL");
  const [stake, setStake] = useState(1);
  const [duration, setDuration] = useState(5);
  const [unit, setUnit] = useState<Unit>("t");
  const [digit, setDigit] = useState(5);
  const [doubleDigit, setDoubleDigit] = useState(5);
  const [autoDouble, setAutoDouble] = useState(false);
  const [offset, setOffset] = useState(0.5);
  const [hi, setHi] = useState(0.5);
  const [lo, setLo] = useState(-0.5);
  const [minConf, setMinConf] = useState(0);
  const [sensitivity, setSensitivity] = useState(3);
  const [setupId, setSetupId] = useState<SetupId>("A");
  const [cooldown, setCooldown] = useState(0);
  const [selectedTick, setSelectedTick] = useState(3);
  const [multiplier, setMultiplier] = useState(100);
  const [growthRate, setGrowthRate] = useState(0.01);
  const [tpAmt, setTpAmt] = useState(1);
  const [slAmt, setSlAmt] = useState(1);
  const [available, setAvailable] = useState<Set<string> | null>(null);
  const lastSettle = useRef(0);
  const lastWaitLog = useRef(0);
  const [maxLoss, setMaxLoss] = useState(20);
  const [takeProfit, setTakeProfit] = useState(10);
  const [maxTrades, setMaxTrades] = useState(50);
  const [maxStake, setMaxStake] = useState(10);
  const [riskPercent, setRiskPercent] = useState(1);
  const [reconciling, setReconciling] = useState(false);
  const orderLock = useRef(false);
  const [lossStreakStop, setLossStreakStop] = useState(3);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [scan, setScan] = useState<ScanRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [brain, setBrain] = useState<BrainVerdict | null>(null);
  const [brainGate, setBrainGate] = useState(false);
  const curStake = useRef(1);
  const streak = useRef(0);
  const tickSub = useRef<string | null>(null);

  const addLog = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 80));
  const def = CONTRACTS[kind];
  const inst = instruments.find((i) => i.symbol === symbol);
  const decimals = inst?.pip ? Math.max(0, Math.round(-Math.log10(inst.pip))) : 2;

  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(LS) || "{}");
      if (c.appId) setAppId(c.appId);
      if (c.token) setToken(c.token);
      if (c.accountId) setAccountId(c.accountId);
    } catch {}
  }, []);

  // Digit contracts need ticks
  useEffect(() => {
    if (def.digits) { setUnit("t"); setDuration((d) => Math.min(10, Math.max(1, d))); }
    if (def.ticks) { setUnit("t"); setDuration((d) => Math.min(def.ticks![1], Math.max(def.ticks![0], d))); }
    if (def.single) setMode("SIGNAL");
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const settings = { symbol, kind, mode, stake, duration, unit, digit, doubleDigit, autoDouble, offset, hi, lo, minConf, maxLoss, takeProfit, maxTrades, lossStreakStop, sensitivity, setupId, cooldown, selectedTick, multiplier, growthRate, tpAmt, slAmt, brainGate, riskPercent, maxStake };
  const applySettings = (c: Partial<typeof settings>) => {
    const set: Record<string, (v: any) => void> = { symbol: setSymbol, kind: setKind, mode: setMode, stake: setStake, duration: setDuration, unit: setUnit, digit: setDigit, doubleDigit: setDoubleDigit, autoDouble: setAutoDouble, offset: setOffset, hi: setHi, lo: setLo, minConf: setMinConf, maxLoss: setMaxLoss, takeProfit: setTakeProfit, maxTrades: setMaxTrades, lossStreakStop: setLossStreakStop, sensitivity: setSensitivity, setupId: setSetupId, cooldown: setCooldown, selectedTick: setSelectedTick, multiplier: setMultiplier, growthRate: setGrowthRate, tpAmt: setTpAmt, slAmt: setSlAmt, brainGate: setBrainGate, riskPercent: setRiskPercent, maxStake: setMaxStake };
    for (const [k, v] of Object.entries(c)) { const setter = set[k]; if (setter && v !== undefined) setter(v); }
  };

  const net = trades.reduce((s, t) => s + (t.profit ?? 0), 0);
  const settled = trades.filter((t) => t.profit !== null);
  const wins = settled.filter((t) => (t.profit ?? 0) > 0).length;
  const ticksEq = unit === "t" ? duration : unit === "s" ? duration / 2 : duration * 30;
  const sig = kindSignal(kind, prices, decimals, { digit, offset, hi, lo, ticks: ticksEq, sensitivity });
  const directional = ["RUNS", "RISE_FALL", "HIGHER_LOWER", "ASIANS", "RESET", "MULT"].includes(kind);
  const pat = directional ? analyzePatterns(prices, sensitivity) : null;
  const liveSetups = { A: runSetup("A", prices, sensitivity), B: runSetup("B", prices, sensitivity), C: runSetup("C", prices, sensitivity) };
  const setup = directional ? liveSetups[setupId] : null;
  // Directional contracts trade ONLY the single trend-confirmed pattern setup.
  if (setup) { sig.side = setup.side; sig.confidence = setup.confidence; sig.note = setup.note; }
  // Non-directional contracts: fall back to momentum so orders are not blocked.
  if (!directional && sig.side === null && prices.length > 4) {
    const m = prices[prices.length - 1]! - prices[prices.length - 4]!;
    sig.side = m >= 0 ? 0 : 1;
    sig.note = `Momentum mode (${m >= 0 ? "up" : "down"} over last 3 ticks) — ${sig.note}`;
  }
  const runs = kind === "RUNS" ? runsSignal(prices, duration, sensitivity) : null;
  const ctAvailable = (t: string) => !available || available.has(t);
  const base = computeSignal(prices);
  const stats = def.digits ? digitStats(prices, decimals) : null;

  const connect = async () => {
    setError("");
    setStatus("connecting");
    try {
      const id = appId.trim(), tk = token.trim();
      if (!id) throw new Error("Enter your App ID from developers.deriv.com.");
      if (!tk.startsWith("pat_")) throw new Error("Enter a Personal Access Token (starts with pat_) from developers.deriv.com.");
      addLog("Fetching Deriv accounts…");
      const list = (await fetchAccounts(id, tk)).filter((a) => a.status === "active");
      if (!list.length) throw new Error("No active Options accounts found for this token.");
      setAccounts(list);
      const acc = list.find((a) => a.account_id === accountId) ?? list.find((a) => a.account_type === "demo") ?? list[0]!;
      setAccountId(acc.account_id);
      localStorage.setItem(LS, JSON.stringify({ appId: id, token: tk, accountId: acc.account_id }));
      const url = await fetchOtpUrl(id, tk, acc.account_id);
      client.current?.close();
      const c = new DerivClient();
      client.current = c;
      c.onClose = () => { setStatus("off"); setAuto(false); addLog("Disconnected — press Connect to reopen"); };
      await c.connect(url);
      const isVirtual = acc.account_type === "demo";
      setAccount({ loginid: acc.account_id, currency: acc.currency, isVirtual });
      setBalance(Number(acc.balance));
      c.on("balance", (m) => setBalance(Number(m.balance.balance)));
      await c.send({ balance: 1, subscribe: 1 }).catch(() => {});
      try {
        const s = await c.send({ active_symbols: "brief" });
        const live = (s.active_symbols as any[]).map((x) => {
          const sym = x.underlying_symbol ?? x.symbol;
          return { symbol: sym, name: x.underlying_symbol_name ?? x.display_name ?? sym, group: groupOf(sym, String(x.market ?? "")), open: !!(x.exchange_is_open ?? true), pip: Number(x.pip ?? x.pip_size) || undefined };
        });
        if (live.length) setInstruments(live);
      } catch (e: any) { addLog(`Symbols list error: ${e.message} — using built-in list`); }
      c.on("tick", (m) => { if (m.tick?.symbol === undefined || m.tick.symbol === symbolRef.current) setPrices((p) => [...p, Number(m.tick.quote)].slice(-500)); });
      setStatus("on");
      addLog(`Connected ${acc.account_id} (${isVirtual ? "DEMO" : "REAL"})`);
    } catch (e: any) {
      setStatus("off");
      setError(e.message || "Connection failed");
    }
  };

  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  useEffect(() => {
    const c = client.current;
    if (status !== "on" || !c) return;
    (async () => {
      if (tickSub.current) await c.send({ forget: tickSub.current }).catch(() => {});
      tickSub.current = null;
      setPrices([]);
      try {
        const h = await c.send({ ticks_history: symbol, count: 500, end: "latest", style: "ticks" });
        setPrices((h.history.prices as number[]).map(Number));
        const r = await c.send({ ticks: symbol, subscribe: 1 });
        tickSub.current = r.subscription?.id ?? null;
      } catch (e: any) { addLog(`Ticks error on ${symbol}: ${e.message}`); }
      try {
        const cf = await c.send({ contracts_for: symbol });
        const list = (cf.contracts_for?.available ?? []) as any[];
        setAvailable(list.length ? new Set(list.map((x) => String(x.contract_type))) : null);
      } catch { setAvailable(null); }
    })();
  }, [symbol, status]);

  const runScan = async () => {
    const c = client.current;
    if (!c) return;
    setScanning(true);
    const rows: ScanRow[] = [];
    const list = instruments.filter((i) => i.open !== false);
    for (const i of list) {
      try {
        const h = await c.send({ ticks_history: i.symbol, count: 200, end: "latest", style: "ticks" });
        const p = (h.history.prices as number[]).map(Number);
        const s = computeSignal(p);
        rows.push({ symbol: i.symbol, name: i.name, group: i.group, trend: trendStrength(p), conf: s.confidence, dir: s.dir === "CALL" ? "UP" : s.dir === "PUT" ? "DOWN" : "—" });
        setScan([...rows].sort((a, b) => b.conf + b.trend - (a.conf + a.trend)));
      } catch {}
    }
    setScanning(false);
    addLog(`Scan done: ${rows.length} instruments ranked`);
  };

  // Pre-trade checks: every problem is reported before any order is sent.
  const preflight = (side: 0 | 1, amount: number): string[] => {
    const errs: string[] = [];
    if (status !== "on" || !client.current) errs.push("Not connected to Deriv");
    if (!account) errs.push("No account selected");
    if (!(amount > 0)) errs.push("Stake must be above 0");
    if (amount < 0.35) errs.push("Stake below Deriv minimum (0.35)");
    if (amount > maxStake) errs.push(`Stake ${amount} above your cap ${maxStake}`);
    const protection = stakeProtection(amount, balance, riskPercent, maxStake);
    if (protection) errs.push(protection);
    if (trades.some(t => t.accountId === account?.loginid && t.profit === null)) errs.push("An earlier order is unresolved; check it before trading again");
    if (balance != null && amount > balance) errs.push("Stake is larger than your balance");
    if (def.single && side === 1) errs.push(`${def.label} has only one side`);
    if (def.ticks && (duration < def.ticks[0] || duration > def.ticks[1])) errs.push(`${def.label} needs ${def.ticks[0]}-${def.ticks[1]} ticks`);
    if (!def.open && !(duration > 0)) errs.push("Duration must be above 0");
    if (def.barrier === "digit" && (digit < 0 || digit > 9)) errs.push("Digit must be 0-9");
    if (kind === "OVER_UNDER" && (doubleDigit < 0 || doubleDigit > 9)) errs.push("Under digit must be 0-9");
    if (kind === "RUNS" && !/^(R_|1HZ)/.test(symbol)) errs.push("Only Ups/Downs works on Volatility indices (R_ / 1s)");
    if (prices.length < 20) errs.push("Waiting for live ticks");
    return errs;
  };

  const placeTrade = useCallback(async (pick: 0 | 1 | "both", amount: number) => {
    const c = client.current;
    if (orderLock.current) return null;
    const sides: (0 | 1)[] = pick === "both" ? [0, 1] : [pick];
    const errs = [...new Set(sides.flatMap((sd) => preflight(sd, amount)))];
    if (sides.length === 2 && balance != null && amount * 2 > balance) errs.push("Both orders together exceed your balance");
    if (errs.length) { addLog(`Order blocked: ${errs.join("; ")}`); setError(errs.join(" · ")); return null; }
    if (!c || !account) return null;
    orderLock.current = true;
    setBusy(true);
    const paired = sides.length === 2;
    const pairIds = new Set<number>();
    const pairSettled = new Set<number>();
    const closeRequested = new Set<number>();
    const closeCompanion = async (id: number) => {
      if (!paired || !pairSettled.size || pairSettled.has(id) || closeRequested.has(id)) return;
      closeRequested.add(id);
      try {
        const response = await c.send({ proposal_open_contract: 1, contract_id: id });
        if (canCloseCompanion(response.proposal_open_contract ?? {}, id)) {
          await c.send({ sell: id, price: 0 });
          addLog(`PAIR closing companion #${id} — awaiting Deriv settlement`);
        } else {
          addLog(`PAIR #${id} cannot be sold now — awaiting Deriv expiry`);
        }
      } catch (e: any) {
        setAuto(false);
        addLog(`PAIR close not confirmed #${id}: ${e.message}; awaiting settlement`);
      }
    };
    const prepareOrder = (side: 0 | 1) => {
    const sideDigit = pick === "both" && side === 1 ? doubleDigit : digit;
    const ct = def.types[side];
    if (!ctAvailable(ct)) addLog(`Note: ${ct} not listed for ${symbol} — asking Deriv for a quote anyway`);
    const req: Record<string, unknown> = {
      proposal: 1, amount: Number(amount.toFixed(2)), basis: "stake", contract_type: ct,
      currency: account.currency, underlying_symbol: symbol,
    };
    if (!def.open) { req["duration"] = duration; req["duration_unit"] = unit; }
    if (def.extra === "selected_tick") req["selected_tick"] = selectedTick;
    if (def.extra === "multiplier") { req["multiplier"] = multiplier; req["limit_order"] = { take_profit: tpAmt, stop_loss: slAmt }; }
    if (def.extra === "growth_rate") { req["growth_rate"] = growthRate; req["limit_order"] = { take_profit: tpAmt }; }
    const sgn = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    if (def.barrier === "digit") req["barrier"] = String(sideDigit);
    if (def.barrier === "offset") req["barrier"] = sgn(offset);
    if (def.barrier === "range") { req["barrier"] = sgn(hi); req["barrier2"] = sgn(lo); }
    const label = `${def.sides[side]}${def.barrier === "digit" ? ` ${sideDigit}` : ""}`;
    return { req, label, ct };
    };
    // Prepare both sides completely before either buy leaves this browser.
    const prepared = sides.map(prepareOrder);
    const buyOrder = async ({ req, ct }: ReturnType<typeof prepareOrder>) => {
    const isRate = (e: any) => /rate limit|RateLimit/i.test(String(e?.message ?? e?.code ?? e));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const withBackoff = async <T,>(fn: () => Promise<T>): Promise<T> => {
      for (let i = 0; ; i++) {
        try { return await fn(); } catch (e) {
          if (!isRate(e) || i >= 5) throw e;
          const wait = Math.min(1000 * 2 ** i, 16000) + Math.random() * 300;
          addLog(`Rate limited, retrying in ${(wait / 1000).toFixed(1)}s`);
          await sleep(wait);
        }
      }
    };
      // Single-step order: buy directly with parameters (no separate quote step).
      const { proposal: _p, ...params } = req;
      let b: any = null;
      try {
        const send = () => c.send({ buy: 1, price: Number((amount * 1.05 + 0.01).toFixed(2)), parameters: params });
        b = await (paired ? send() : withBackoff(send));
      } catch (e: any) {
        throw new Error(`${ct} on ${symbol} rejected by Deriv: ${e.message}`);
      }
      const id = Number(b?.buy?.contract_id);
      if (!id) throw new Error("Deriv did not confirm the order");
      return id;
    };
    const trackOrder = async (id: number, label: string): Promise<number | null> => {
    try {
      setTrades((t) => [{ id, label, stake: amount, profit: null, symbol, setup: directional ? setupId : undefined, demo: account.isVirtual, accountId: account.loginid, time: new Date().toLocaleTimeString() }, ...t]);
      addLog(`BUY ${label} ${amount.toFixed(2)} on ${symbol} #${id}`);
      const result = await new Promise<number | null>((resolve) => {
        let done = false;
        const finish = (v: number | null) => { if (done) return; done = true; off(); clearInterval(poll); clearTimeout(cap); resolve(v); };
        const check = (poc: any) => {
          if (poc && Number(poc.contract_id) === id && (poc.is_sold || poc.status === "won" || poc.status === "lost") && poc.profit != null && Number.isFinite(Number(poc.profit))) {
            pairSettled.add(id);
            pairIds.forEach(other => { if (other !== id) void closeCompanion(other); });
            finish(Number(poc.profit));
          }
        };
        const off = c.on("proposal_open_contract", (m) => check(m.proposal_open_contract));
        c.send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 }).then((m) => check(m?.proposal_open_contract)).catch(() => {});
        // Poll every 3s in case the live stream drops; never leave the bot stuck.
        const poll = setInterval(() => { c.send({ proposal_open_contract: 1, contract_id: id }).then((m) => check(m?.proposal_open_contract)).catch(() => {}); }, 3000);
        const cap = setTimeout(() => { addLog(`#${id} settlement unconfirmed — autopilot paused; check unresolved orders`); setAuto(false); finish(null); }, def.open ? 30 * 60_000 : 180_000);
      });
      if (result === null) return null;
      lastSettle.current = Date.now();
      setTrades((t) => t.map((x) => (x.id === id ? { ...x, profit: result } : x)));
      addLog(`${result > 0 ? "WIN" : result < 0 ? "LOSS" : "FLAT"} #${id}: ${result.toFixed(2)}`);
      return result;
    } catch (e: any) {
      addLog(`Order error: ${e.message}`);
      setError(e.message);
      return null;
    }
    };
    try {
      if (paired) addLog(`PAIR dispatch together · ${duration}${unit} per side · Deriv controls exact timing`);
      const purchases = await dispatchTogether(prepared.map(order => () => buyOrder(order)));
      purchases.forEach(purchase => { if (purchase.status === "fulfilled") pairIds.add(purchase.value); });
      const failed = purchases.some(purchase => purchase.status === "rejected");
      if (failed) {
        setAuto(false);
        purchases.forEach(purchase => {
          if (purchase.status === "rejected") {
            const message = purchase.reason instanceof Error ? purchase.reason.message : "Order not confirmed";
            addLog(`Order error: ${message}`);
            setError(message);
          }
        });
        if (paired && pairIds.size) addLog("PAIR incomplete — autopilot paused; confirmed order remains tracked");
      }
      const results = await Promise.all(purchases.map((purchase, i) => {
        const order = prepared[i];
        return purchase.status === "fulfilled" && order ? trackOrder(purchase.value, order.label) : Promise.resolve(null);
      }));
      if (results.some((r) => r === null)) return null;
      return results.reduce<number>((a, r) => a + (r ?? 0), 0);
    } finally { orderLock.current = false; setBusy(false); }
  }, [account, duration, unit, symbol, def, digit, doubleDigit, offset, hi, lo, selectedTick, multiplier, growthRate, tpAmt, slAmt, available, status, balance, riskPercent, maxStake, trades, prices.length, setupId, directional]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rapid / burst execution: every order is independent and settles on its own (Deriv confirms each).
  const [inflight, setInflight] = useState<number[]>(() => Array(10).fill(0));
  const [burstOpen, setBurstOpen] = useState(0);
  const [autoBurst, setAutoBurst] = useState(false);
  const inflightTotal = useRef(0);
  type FireSpec = { ct: string; barrier?: string; label: string; digit?: number };
  const fireOne = async (spec: FireSpec): Promise<number | null> => {
    const c = client.current;
    if (!c || !account) return null;
    const bump = (n: number) => {
      inflightTotal.current += n; setBurstOpen(inflightTotal.current);
      if (spec.digit != null) setInflight((a) => a.map((v, i) => (i === spec.digit ? Math.max(0, v + n) : v)));
    };
    bump(1);
    try {
      const params: Record<string, unknown> = { amount: Number(stake.toFixed(2)), basis: "stake", contract_type: spec.ct, currency: account.currency, underlying_symbol: symbol, duration: def.digits ? Math.min(10, Math.max(1, duration)) : duration, duration_unit: def.digits ? "t" : unit };
      if (spec.barrier != null) params["barrier"] = spec.barrier;
      const b: any = await c.send({ buy: 1, price: Number((stake * 1.05 + 0.01).toFixed(2)), parameters: params });
      const id = Number(b?.buy?.contract_id);
      if (!id) throw new Error("Deriv did not confirm the order");
      setTrades((t) => [{ id, label: spec.label, stake, profit: null, symbol, demo: account.isVirtual, accountId: account.loginid, time: new Date().toLocaleTimeString() }, ...t]);
      addLog(`BURST BUY ${spec.label} ${stake.toFixed(2)} on ${symbol} #${id}`);
      const profit = await new Promise<number | null>((resolve) => {
        let done = false;
        const finish = (v: number | null) => { if (done) return; done = true; off(); clearInterval(poll); clearTimeout(cap); resolve(v); };
        const check = (poc: any) => {
          if (poc && Number(poc.contract_id) === id && (poc.is_sold || poc.status === "won" || poc.status === "lost") && poc.profit != null && Number.isFinite(Number(poc.profit))) finish(Number(poc.profit));
        };
        const off = c.on("proposal_open_contract", (m) => check(m.proposal_open_contract));
        c.send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 }).then((m) => check(m?.proposal_open_contract)).catch(() => {});
        const poll = setInterval(() => { c.send({ proposal_open_contract: 1, contract_id: id }).then((m) => check(m?.proposal_open_contract)).catch(() => {}); }, 3000);
        const cap = setTimeout(() => { addLog(`#${id} settlement unconfirmed — check unresolved orders`); finish(null); }, 180_000);
      });
      if (profit != null) {
        lastSettle.current = Date.now();
        setTrades((t) => t.map((x) => (x.id === id ? { ...x, profit } : x)));
        addLog(`${profit > 0 ? "WIN" : "LOSS"} ${spec.label} #${id}: ${profit.toFixed(2)}`);
      }
      return profit;
    } catch (e: any) {
      addLog(`Burst error: ${e.message}`);
      setError(e.message);
      return null;
    } finally { bump(-1); }
  };
  /** Sends every order in the same instant (no waiting between them), then tracks each one. */
  const fireMany = async (specs: FireSpec[]): Promise<number | null> => {
    if (!client.current || !account || status !== "on") return null;
    const prot = stakeProtection(stake, balance, riskPercent, maxStake);
    if (prot) { setError(prot); addLog(`Burst blocked: ${prot}`); return null; }
    if (prices.length < 20) { addLog("Burst blocked: waiting for live ticks"); return null; }
    if (balance != null && (inflightTotal.current + specs.length) * stake > balance) { addLog(`Burst blocked: ${specs.length} orders would exceed your balance`); setError("Burst would exceed your balance"); return null; }
    addLog(`BURST ×${specs.length} dispatched together`);
    const results = await Promise.all(specs.map(fireOne));
    if (results.some((r) => r === null)) return null;
    return results.reduce<number>((a, r) => a + (r ?? 0), 0);
  };
  const BURST = 9;
  const rapidMatch = (d: number) => fireMany([{ ct: "DIGITMATCH", barrier: String(d), label: `Matches ${d}`, digit: d }]);
  const burstMatch = (d: number) => fireMany(Array.from({ length: BURST }, () => ({ ct: "DIGITMATCH", barrier: String(d), label: `Matches ${d}`, digit: d })));
  const sideSpec = (side: 0 | 1): FireSpec => {
    const sgn = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const barrier = def.barrier === "digit" ? String(side === 1 && kind === "OVER_UNDER" ? doubleDigit : digit) : def.barrier === "offset" ? sgn(offset) : undefined;
    return { ct: def.types[side], ...(barrier != null ? { barrier } : {}), label: `${def.sides[side]}${barrier ? ` ${barrier}` : ""}` };
  };
  const burstSide = (pick: 0 | 1 | "both") => fireMany((pick === "both" ? [0, 1] as const : [pick]).flatMap((sd) => Array.from({ length: BURST }, () => sideSpec(sd))));
  const burstable = !def.open && !def.single && def.barrier !== "range";

  useEffect(() => {
    if (!auto || busy || status !== "on") return;
    if (net <= -maxLoss) { setAuto(false); addLog("Stopped: loss limit reached"); return; }
    if (net >= takeProfit) { setAuto(false); addLog("Stopped: profit target reached"); return; }
    if (trades.length >= maxTrades) { setAuto(false); addLog("Stopped: max trades reached"); return; }
    if (streak.current >= lossStreakStop) { setAuto(false); addLog(`Stopped: ${streak.current} losses in a row`); return; }
    if (!account?.isVirtual) { setAuto(false); addLog("Stopped: autopilot runs on DEMO accounts only"); return; }
    if (Date.now() - lastSettle.current < cooldown * 1000) return;
    const wait = (why: string) => { if (Date.now() - lastWaitLog.current > 15000) { lastWaitLog.current = Date.now(); addLog(`Waiting: ${why}`); } };
    if (sig.side === null) return wait("collecting ticks");
    if (minConf > 0 && sig.confidence < minConf) return wait(`confidence ${sig.confidence}% below your minimum ${minConf}%`);
    if (brainGate && (!brain || brain.side !== sig.side)) return wait("AI Brain does not agree yet");
    if (mode === "SIDE_A" && sig.side !== 0) return wait(`signal is ${def.sides[1]}, you chose ${def.sides[0]} only`);
    if (mode === "SIDE_B" && sig.side !== 1) return wait(`signal is ${def.sides[0]}, you chose ${def.sides[1]} only`);
    const amt = stake;
    const both = autoDouble && !def.single;
    const errors = [...new Set((both ? [0, 1] as const : [sig.side] as const).flatMap((sd) => preflight(sd, amt)))];
    if (both && balance != null && amt * 2 > balance) errors.push("Both orders together exceed your balance");
    if (errors.length) { setAuto(false); setError(errors.join(" · ")); addLog(`Autopilot paused: ${errors.join("; ")}`); return; }
    const onDone = (r: number | null) => {
      if (r == null) return;
      streak.current = r > 0 ? 0 : r < 0 ? streak.current + 1 : streak.current;
      curStake.current = Math.min(stake, maxStake); // fixed stake — no martingale
    };
    if (autoBurst && burstable) {
      if (inflightTotal.current > 0) return;
      setBusy(true);
      const pick = kind === "MATCH_DIFF" ? null : both ? "both" : sig.side;
      (pick === null ? burstMatch(digit) : burstSide(pick)).then(onDone).finally(() => setBusy(false));
      return;
    }
    placeTrade(both ? "both" : sig.side, amt).then(onDone);
  }, [auto, busy, prices, status, net, stake, maxStake, riskPercent, balance, maxLoss, takeProfit, maxTrades, lossStreakStop, cooldown, minConf, brainGate, brain, mode, trades.length, autoDouble, autoBurst, def.single]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAuto = () => {
    if (!account?.isVirtual) { setError("Autopilot is locked to DEMO accounts. Switch to your demo (VRTC) account to run it."); return; }
    const errors = preflight(sig.side ?? 0, stake);
    if (errors.length) { setError(errors.join(" · ")); return; }
    curStake.current = stake;
    setAuto(true);
    addLog(`Autopilot ON (${def.label})`);
  };

  const reconcileOrders = async () => {
    const c = client.current;
    if (!c || !account || reconciling || orderLock.current) return;
    setReconciling(true);
    try {
      for (const trade of trades.filter(t => t.accountId === account.loginid && t.profit === null)) {
        const response = await c.send({ proposal_open_contract: 1, contract_id: trade.id });
        const contract = response.proposal_open_contract;
        if (contract && (contract.is_sold || contract.status === "won" || contract.status === "lost") && contract.profit != null && Number.isFinite(Number(contract.profit))) {
          const profit = Number(contract.profit);
          setTrades(rows => rows.map(t => t.id === trade.id ? { ...t, profit } : t));
          streak.current = profit > 0 ? 0 : profit < 0 ? streak.current + 1 : streak.current;
          lastSettle.current = Date.now();
          addLog(`Settlement confirmed #${trade.id}: ${profit.toFixed(2)}`);
        } else addLog(`#${trade.id} still unresolved — no result recorded`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to check unresolved orders"); }
    finally { setReconciling(false); }
  };

  const last = prices[prices.length - 1];
  const view = prices.slice(-100);
  const min = Math.min(...view), max = Math.max(...view);
  const pts = view.map((p, i) => `${i * 4},${100 - ((p - min) / (max - min || 1)) * 100}`).join(" ");

  const field = "rounded-md border border-input bg-background px-2 py-1.5 font-mono text-sm text-foreground";
  const num = (v: number, set: (n: number) => void, label: string, step = 1) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input type="number" step={step} value={v} onChange={(e) => set(Number(e.target.value))} className={`w-full min-w-0 ${field}`} />
    </label>
  );

  return (
    <div className="relative isolate min-h-screen font-mono text-foreground">
      <MatrixBackground />
      <header className="terminal-header sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h1 className="text-glow text-base font-bold sm:text-xl"><span className="font-mono">root@mwase:~$</span> <span className="text-primary">HYBRID_EXEC</span><span className="animate-pulse text-primary">_</span></h1>
        <div className="hidden flex-1 justify-center gap-4 font-mono text-xs md:flex">
          <span>EQUITY <b>{balance != null ? balance.toFixed(2) : "—"}</b></span>
          <span>P/L <b className={net >= 0 ? "text-up" : "text-down"}>{net.toFixed(2)}</b></span>
          <span>SIGNAL <b className={sig.side === 0 ? "text-up" : sig.side === 1 ? "text-down" : ""}>{sig.side === null ? "WAIT" : def.sides[sig.side]}</b></span>
          <span className={`rounded px-2 ${account?.isVirtual ? "bg-up/20 text-up" : "bg-down/20 text-down"}`}>{account ? (account.isVirtual ? "DEMO-LOCK" : "REAL · AUTO LOCKED") : "OFFLINE"}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2.5 w-2.5 rounded-full ${status === "on" ? "bg-up" : status === "connecting" ? "bg-primary" : "bg-down"}`} />
          {status === "on" && account ? `${account.loginid} · ${account.isVirtual ? "DEMO" : "REAL"}` : status}
        </div>
      </header>

      <section className="terminal-identity">
        <img className="terminal-identity-image" src={terminalEmblem.url} alt="" aria-hidden />
        <div className="terminal-identity-inner">
          <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-9">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-telemetry"><Terminal size={15} /> MWASE / OPERATIONS TERMINAL <span className="text-muted-foreground">SYS.03</span></div>
            <h2 className="font-sans text-3xl font-bold sm:text-4xl">HYBRID<span className="text-primary">_EXEC</span></h2>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <span className="flex items-center gap-2"><Cpu size={14} className="text-primary" /> 3 STRATEGY ENGINES</span>
              <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-telemetry" /> TREND CONFIRMATION</span>
              <span className="flex items-center gap-2"><Zap size={14} className="text-primary" /> TICK EXECUTION</span>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-4 text-xs md:grid-cols-4">
              <div><div className="mb-1 text-muted-foreground">01 / MARKET FEED</div><div className={status === "on" ? "text-up" : "text-telemetry"}>{status === "on" ? `${prices.length} TICKS LOADED` : status === "connecting" ? "CONNECTING" : "AWAITING CONNECTION"}</div></div>
              <div><div className="mb-1 text-muted-foreground">02 / PATTERN ENGINE</div><div>{directional ? `SETUP ${setupId} · ${pat?.hits.length ?? 0} PATTERNS` : def.label}</div></div>
              <div><div className="mb-1 text-muted-foreground">03 / CONFIRMATION</div><div className={sig.side === null ? "text-telemetry" : "text-up"}>{sig.side === null ? "WAITING FOR SETUP" : `${def.sides[sig.side]} · ${sig.confidence}% SCORE`}</div></div>
              <div><div className="mb-1 text-muted-foreground">04 / ORDER ENGINE</div><div className="flex items-center gap-2"><Activity size={13} className={auto ? "text-up" : "text-telemetry"} />{busy ? "ORDER IN PROGRESS" : auto ? "AUTOPILOT ACTIVE" : "STANDBY"}</div></div>
            </div>
          </div>
        </div>
      </section>
      <main className="terminal-workspace mx-auto grid max-w-7xl grid-cols-1 items-start [&>*]:min-w-0 gap-4 p-4 lg:grid-cols-3">
        <ExecutionConsole trades={trades} accountId={account?.loginid} demo={account?.isVirtual ?? false} connected={status === "on"} auto={auto} busy={busy} balance={balance} riskPercent={riskPercent} maxStake={maxStake} setupId={setupId} setups={liveSetups} onSelect={setSetupId} onReconcile={reconcileOrders} reconciling={reconciling} />
        <section className="space-y-3 glass rounded-sm p-4">
          <h2 className="font-semibold">Deriv connection</h2>
          <label className="block text-xs text-muted-foreground">App ID
            <input value={appId} onChange={(e) => setAppId(e.target.value)} className={`mt-1 w-full ${field}`} />
          </label>
          <label className="block text-xs text-muted-foreground">Personal Access Token (pat_…, needs "trade" scope)
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className={`mt-1 w-full ${field}`} />
          </label>
          {accounts.length > 0 && (
            <label className="block text-xs text-muted-foreground">Account
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`mt-1 w-full ${field}`}>
                {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.account_id} · {a.account_type.toUpperCase()} · {a.currency}</option>)}
              </select>
            </label>
          )}
          <p className="text-xs text-muted-foreground">Get both from developers.deriv.com. Saved only in this browser. Use a demo token to test.</p>
          <Button variant="ghost" onClick={connect} disabled={status === "connecting"} className="w-full rounded-md bg-primary py-2 font-semibold text-primary-foreground disabled:opacity-50">
            {status === "on" ? "Reconnect" : status === "connecting" ? "Connecting…" : "Connect"}
          </Button>
          {error && <p className="text-sm text-down">{error}</p>}
        </section>

        <section className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-4">
          {[
            ["Balance", balance != null ? `${balance.toFixed(2)} ${account?.currency ?? ""}` : "—"],
            ["Session P/L", net.toFixed(2)],
            ["Win rate", settled.length ? `${Math.round((wins / settled.length) * 100)}%` : "—"],
            ["Trades", `${trades.length}/${maxTrades}`],
          ].map(([k, v]) => (
            <div key={k} className="glass rounded-sm p-4">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className={`mt-1 font-mono text-xl font-semibold ${k === "Session P/L" ? (net >= 0 ? "text-up" : "text-down") : ""}`}>{v}</div>
            </div>
          ))}

          <div className="col-span-2 glass rounded-sm p-4 lg:col-span-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={field}>
                {GROUPS.map((g) => {
                  const items = instruments.filter((i) => i.group === g);
                  return items.length ? (
                    <optgroup key={g} label={`${g} (${items.length})`}>
                      {items.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}{i.open === false ? " (closed)" : ""}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={field}>
                {(Object.keys(CONTRACTS) as Kind[]).map((k) => <option key={k} value={k}>{CONTRACTS[k].label}</option>)}
              </select>
              <span className="ml-auto font-mono text-lg">{last?.toFixed(decimals) ?? "—"}</span>
            </div>
            <div className="chart-3d relative">{!view.length && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">AWAITING LIVE MARKET DATA</div>}<svg viewBox="0 0 400 100" preserveAspectRatio="none" className="h-48 w-full">
              <defs><linearGradient id="fillg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--up)" stopOpacity="0.35" /><stop offset="100%" stopColor="var(--up)" stopOpacity="0" /></linearGradient></defs>
              {pts && <polygon points={`0,100 ${pts} ${(view.length - 1) * 4},100`} fill="url(#fillg)" />}
              {def.barrier === "offset" && last != null && <line x1="0" x2="400" y1={100 - ((last + offset - min) / (max - min || 1)) * 100} y2={100 - ((last + offset - min) / (max - min || 1)) * 100} stroke="var(--primary)" strokeDasharray="4 3" strokeWidth="0.8" />}
              {def.barrier === "range" && last != null && [hi, lo].map((b) => { const y = 100 - ((last + b - min) / (max - min || 1)) * 100; return <line key={b} x1="0" x2="400" y1={y} y2={y} stroke="var(--primary)" strokeDasharray="4 3" strokeWidth="0.8" />; })}
              <polyline points={pts} fill="none" stroke="var(--up)" strokeWidth="1.5" />
            </svg></div>
            {available && <p className="mt-1 text-xs text-muted-foreground">On this market: {def.types.filter((t, i) => !(def.single && i)).map((t) => <span key={t} className={ctAvailable(t) ? "text-up" : "text-down"}>{t} {ctAvailable(t) ? "✓" : "✗ not offered"} </span>)}</p>}
            {runs && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {runs.parts.map((p) => (
                  <div key={p.name} className="rounded-lg border border-border bg-background/30 p-2 text-xs">
                    <div className="text-muted-foreground">{p.name}</div>
                    <div className={`font-mono font-semibold ${p.bias === 0 ? "text-up" : p.bias === 1 ? "text-down" : ""}`}>{p.bias === 0 ? "▲ " : p.bias === 1 ? "▼ " : ""}{p.value}</div>
                  </div>
                ))}
              </div>
            )}

            {stats && (
              <div className="mt-2 space-y-2">
                {kind === "OVER_UNDER" ? (
                  <>
                    <div>
                      <div className="mb-1 text-xs text-telemetry">▲ OVER THAN →</div>
                      <div className="grid grid-cols-10 gap-1 text-center font-mono text-xs">
                        {stats.counts.map((c, d) => {
                          const p = stats.total ? (c / stats.total) * 100 : 0;
                          const over = stats.counts.slice(d + 1).reduce((a, b) => a + b, 0) / (stats.total || 1) * 100;
                          return (
                            <Button variant="ghost" key={d} onClick={() => setDigit(d)} aria-pressed={d === digit} className={`rounded border py-1 ${d === digit ? "border-primary bg-primary/20" : "border-border"} ${over >= 55 ? "text-up" : over <= 45 ? "text-down" : ""}`}>
                              <div className="font-bold">{d}</div><div>{over.toFixed(0)}%</div>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-telemetry">▼ UNDER THAN →</div>
                      <div className="grid grid-cols-10 gap-1 text-center font-mono text-xs">
                        {stats.counts.map((c, d) => {
                          const p = stats.total ? (c / stats.total) * 100 : 0;
                          const under = stats.counts.slice(0, d).reduce((a, b) => a + b, 0) / (stats.total || 1) * 100;
                          return (
                            <Button variant="ghost" key={d} onClick={() => setDoubleDigit(d)} aria-pressed={d === doubleDigit} className={`rounded border py-1 ${d === doubleDigit ? "border-primary bg-primary/20" : "border-border"} ${under >= 55 ? "text-up" : under <= 45 ? "text-down" : ""}`}>
                              <div className="font-bold">{d}</div><div>{under.toFixed(0)}%</div>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : kind === "MATCH_DIFF" ? (
                  <div className="space-y-1.5 font-mono text-xs">
                    <div className="text-telemetry">TAP TO FIRE MATCHES · each tap = 1 order at stake {stake} · 9× = burst of 9</div>
                    {stats.counts.map((c, d) => {
                      const p = stats.total ? (c / stats.total) * 100 : 0;
                      const max = Math.max(...stats.counts, 1);
                      return (
                        <div key={d} className={`flex items-center gap-2 rounded border p-1.5 ${d === digit ? "border-primary bg-primary/10" : "border-border"}`}>
                          <button type="button" onClick={() => setDigit(d)} className="w-6 text-lg font-bold">{d}</button>
                          <div className="flex-1">
                            <div className="flex justify-between"><span className={p >= 12 ? "text-up" : p <= 8 ? "text-down" : ""}>{p.toFixed(0)}% {p >= 12 ? "HOT" : p <= 8 ? "COLD" : ""}</span>{inflight[d]! > 0 && <span className="text-primary">{inflight[d]} open</span>}</div>
                            <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${(c / max) * 100}%` }} /></div>
                          </div>
                          <Button variant="ghost" disabled={status !== "on"} onClick={() => void rapidMatch(d)} className="h-10 rounded-md bg-up px-4 font-bold text-primary-foreground active:scale-95 disabled:opacity-40">TAP</Button>
                          <Button variant="ghost" disabled={status !== "on"} onClick={() => burstMatch(d)} className="h-10 rounded-md border border-primary px-3 font-bold text-primary active:scale-95 disabled:opacity-40">9×</Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-10 gap-1 text-center font-mono text-xs">
                    {stats.counts.map((c, d) => {
                      const p = stats.total ? (c / stats.total) * 100 : 0;
                      return (
                        <Button variant="ghost" key={d} onClick={() => setDigit(d)} className={`rounded border py-1 ${d === digit ? "border-primary bg-primary/20" : "border-border"} ${p >= 12 ? "text-up" : p <= 8 ? "text-down" : ""}`}>
                          <div className="font-bold">{d}</div><div>{p.toFixed(0)}%</div>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">{def.label} signal</div>
                <div className={`text-2xl font-bold ${sig.side === 0 ? "text-up" : sig.side === 1 ? "text-down" : ""}`}>
                  {sig.side === null ? "WAIT" : def.sides[sig.side]} <span className="font-mono text-base">{sig.confidence}%</span>
                </div>
                <div className="text-xs text-muted-foreground">{sig.note}</div>
                {!def.digits && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {base.parts.map((p) => (
                      <li key={p.name} className="flex gap-2">
                        <span className={p.bias === "CALL" ? "text-up" : p.bias === "PUT" ? "text-down" : "text-muted-foreground"}>{p.bias === "CALL" ? "▲" : p.bias === "PUT" ? "▼" : "•"}</span>
                        <span className="text-muted-foreground">{p.name}:</span><span>{p.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={status !== "on" || busy} onClick={() => placeTrade(0, stake)} className="rounded-md bg-up px-5 py-3 font-bold text-primary-foreground disabled:opacity-40">{def.sides[0]}</Button>
                <Button variant="ghost" hidden={!!def.single} disabled={status !== "on" || busy} onClick={() => placeTrade(1, stake)} className="rounded-md bg-down px-5 py-3 font-bold text-primary-foreground disabled:opacity-40">{def.sides[1]}</Button>
                <Button variant="ghost" hidden={!!def.single} disabled={status !== "on" || busy} onClick={() => placeTrade("both", stake)} className="col-span-full rounded-md border border-primary px-5 py-3 font-bold text-primary disabled:opacity-40">⚡ Double execute: {def.sides[0]} + {def.sides[1]}</Button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3 glass rounded-sm p-4">
          <h2 className="font-semibold">Trade parameters & risk</h2>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1 text-xs">
            {(def.single ? (["SIGNAL"] as Mode[]) : (["SIDE_A", "SIDE_B", "SIGNAL"] as Mode[])).map((m) => (
              <Button variant="ghost" key={m} onClick={() => setMode(m)} className={`rounded py-1.5 ${mode === m ? "bg-primary text-primary-foreground" : ""}`}>
                {m === "SIDE_A" ? `Always ${def.sides[0].replace(/[▲▼] /, "")}` : m === "SIDE_B" ? `Always ${def.sides[1].replace(/[▲▼] /, "")}` : "Auto direction"}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
            {num(stake, setStake, "Stake", 0.01)}
            {!def.open && <div className="flex min-w-0 gap-1">
              <div className="min-w-0 flex-1">{num(duration, (n) => setDuration(def.ticks ? Math.min(def.ticks[1], Math.max(def.ticks[0], Math.round(n))) : n), def.ticks ? `Ticks (${def.ticks[0]}-${def.ticks[1]})` : "Duration")}</div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">Unit
                <select value={unit} disabled={def.digits || !!def.ticks} onChange={(e) => setUnit(e.target.value as Unit)} className={field}>
                  <option value="t">Ticks</option><option value="s">Seconds</option><option value="m">Minutes</option>
                </select>
              </label>
            </div>}
            {def.extra === "selected_tick" && num(selectedTick, (n) => setSelectedTick(Math.max(1, Math.min(5, Math.round(n)))), "Predicted tick (1-5)")}
            {def.extra === "multiplier" && num(multiplier, setMultiplier, "Multiplier (e.g. 100)")}
            {def.extra === "growth_rate" && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">Growth rate
                <select value={growthRate} onChange={(e) => setGrowthRate(Number(e.target.value))} className={field}>
                  {[0.01, 0.02, 0.03, 0.04, 0.05].map((g) => <option key={g} value={g}>{g * 100}%</option>)}
                </select>
              </label>
            )}
            {def.open && num(tpAmt, setTpAmt, "Take profit (amount)", 0.1)}
            {def.extra === "multiplier" && num(slAmt, setSlAmt, "Stop loss (amount)", 0.1)}
            {["RISE_FALL", "HIGHER_LOWER", "ASIANS", "RESET", "MULT", "RUNS"].includes(kind) && (
              <div className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground">Trade setup
                <div className="grid grid-cols-1 gap-1">
                  {(Object.keys(SETUPS) as SetupId[]).map((id) => (
                    <Button variant="ghost" key={id} type="button" onClick={() => setSetupId(id)} disabled={busy || auto} className={`flex-col items-stretch gap-1 rounded-md border px-3 py-2 text-left font-mono ${setupId === id ? "border-primary bg-primary/15 text-primary" : "border-border text-foreground"}`}><span className="block">{id}: {SETUPS[id]}</span><span className="block whitespace-normal text-xs text-muted-foreground">{liveSetups[id].note}</span><span className="block text-xs text-muted-foreground">{(() => { const s = demoStrategyStats(trades, id, account?.loginid); return `${s.wins}W / ${s.losses}L / ${s.flat} flat · demo net ${s.net.toFixed(2)}`; })()}</span></Button>
                  ))}
                </div>
              </div>
            )}
            {kind === "RUNS" && (
              <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground">Sensitivity: {["", "Very careful", "Careful", "Balanced", "Sensitive", "Very sensitive"][sensitivity]}
                <input type="range" min={1} max={5} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
              </label>
            )}
            {burstable && (
              <Button variant="ghost" onClick={() => setAutoBurst((v) => !v)} aria-pressed={autoBurst} className={`rounded border px-3 py-2 text-xs ${autoBurst ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}>
                {autoBurst ? `⚡ Auto 9× burst ON — every signal fires 9 orders at once${autoDouble ? " per side" : ""}` : "Auto 9× burst OFF — autopilot fires 1 order per signal"}
              </Button>
            )}
            {def.barrier === "digit" && num(digit, (n) => setDigit(Math.max(0, Math.min(9, Math.round(n)))), kind === "OVER_UNDER" ? "Over digit (1-9)" : "Prediction digit (0-9)")}
            {kind === "OVER_UNDER" && num(doubleDigit, (n) => setDoubleDigit(Math.max(0, Math.min(9, Math.round(n)))), "Under digit (0-9) — picks the ▼ UNDER line above")}
            {!def.single && (
              <Button variant="ghost" onClick={() => setAutoDouble((v) => !v)} aria-pressed={autoDouble} className={`rounded border px-3 py-2 text-xs ${autoDouble ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}>
                {autoDouble ? "⚡ Double auto execution ON — every signal buys both sides" : "Double auto execution OFF — autopilot buys one side"}
              </Button>
            )}
            {def.barrier === "offset" && num(offset, setOffset, "Barrier offset (+/-)", 0.01)}
            {def.barrier === "range" && <>{num(hi, setHi, "High barrier offset (+)", 0.01)}{num(lo, setLo, "Low barrier offset (-)", 0.01)}</>}
            {num(minConf, setMinConf, "Min confidence %")}
            {num(cooldown, setCooldown, "Pause after trade (sec)")}
            {num(maxStake, setMaxStake, "Max stake cap", 0.1)}
            {num(riskPercent, setRiskPercent, "Balance risk ceiling %", 0.1)}
            <div className="col-span-2 border-l-2 border-telemetry pl-3 text-xs text-telemetry">Protected stake ceiling: {balanceStakeCap(balance, riskPercent, maxStake)?.toFixed(2) ?? "awaiting balance"} {account?.currency ?? ""}</div>
            {num(lossStreakStop, setLossStreakStop, "Stop after N losses")}
            {num(maxLoss, setMaxLoss, "Loss limit")}
            {num(takeProfit, setTakeProfit, "Profit target")}
            {num(maxTrades, setMaxTrades, "Max trades")}
          </div>
          {auto ? (
            <Button variant="ghost" onClick={() => { setAuto(false); addLog("Autopilot OFF"); }} className="w-full rounded-md bg-down py-3 font-bold text-primary-foreground">STOP AUTOPILOT</Button>
          ) : (
            <Button variant="ghost" disabled={status !== "on"} onClick={startAuto} className="w-full rounded-md bg-up py-3 font-bold text-primary-foreground disabled:opacity-40">START AUTOPILOT</Button>
          )}
          <p className="text-xs text-muted-foreground">No guaranteed profit. Demo-only autopilot uses your fixed stake, capped by your balance risk ceiling. No martingale. Loss, profit, trade and streak limits stay active; unresolved orders pause trading.</p>
        </section>

        <section className="glass rounded-sm p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Market scanner</h2>
            <Button variant="ghost" disabled={status !== "on" || scanning} onClick={runScan} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              {scanning ? `Scanning… ${scan.length}` : "Scan all markets"}
            </Button>
          </div>
          {status !== "on" && <p className="text-xs text-muted-foreground">Connect to rank all {instruments.length} instruments by trend strength and signal confidence.</p>}
          <div className="max-h-80 overflow-auto">
            <table className="w-full font-mono text-xs">
              <thead className="text-muted-foreground"><tr><th className="text-left">#</th><th className="text-left">Instrument</th><th className="text-left">Group</th><th>Trend</th><th>Conf</th><th>Bias</th><th /></tr></thead>
              <tbody>
                {scan.map((r, i) => (
                  <tr key={r.symbol} className="border-t border-border">
                    <td>{i + 1}</td><td>{r.name}</td><td className="text-muted-foreground">{r.group}</td>
                    <td className="text-center">{r.trend}</td><td className="text-center">{r.conf}%</td>
                    <td className={`text-center font-bold ${r.dir === "UP" ? "text-up" : r.dir === "DOWN" ? "text-down" : ""}`}>{r.dir}</td>
                    <td><Button variant="ghost" onClick={() => setSymbol(r.symbol)} className="rounded border border-primary px-2 text-primary">Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass space-y-2 rounded-sm p-4">
          <h2 className="font-mono font-semibold text-primary">&gt;_ signal.ticket</h2>
          {(() => {
            const side = sig.side ?? 0;
            const checks = preflight(side, stake);
            const rows: [string, string][] = [
              ["Market", `${inst?.name ?? symbol}`],
              ["Contract", sig.side === null ? "—" : def.types[side]],
              ["Direction", sig.side === null ? "NO TRADE" : def.sides[side]],
              ["Entry", last != null ? `Market @ ${last.toFixed(decimals)}` : "—"],
              ["Stake / max loss", `${stake} (fixed)`],
              ["Duration", def.open ? `Until TP ${tpAmt}${def.extra === "multiplier" ? ` / SL ${slAmt}` : ""}` : `${duration}${unit}`],
              ["Confidence", `${sig.confidence}% (min ${minConf}%)`],
              ["Regime", base.parts.find((p) => p.name === "Market regime")?.detail ?? "—"],
              ["Reason", sig.note],
            ];
            const ready = sig.side !== null && (minConf <= 0 || sig.confidence >= minConf) && checks.length === 0;
            return (
              <>
                <div className="space-y-0.5 font-mono text-xs">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>)}</div>
                <div className={`rounded-md px-2 py-1 text-xs font-semibold ${ready ? "bg-up/20 text-up" : "bg-down/20 text-down"}`}>{ready ? "> ARMED — EXECUTE ON TICK" : "REJECTED — " + (checks[0] ?? (sig.side === null ? "no setup" : "confidence too low"))}</div>
                {checks.length > 1 && <ul className="list-disc pl-4 text-xs text-down">{checks.slice(1).map((c) => <li key={c}>{c}</li>)}</ul>}
              </>
            );
          })()}
        </section>
        {pat && (
          <section className="glass space-y-2 rounded-sm p-4">
            <h2 className="font-mono font-semibold text-primary">&gt;_ pattern.scan <span className="text-xs text-muted-foreground">trend {pat.trend} · score {pat.score.toFixed(1)}{setup && <> · setup {Object.entries(setup.checks).map(([k, v]) => `${v ? "✓" : "✗"}${k}`).join(" ")}</>}</span></h2>
            {pat.hits.length === 0 && <p className="font-mono text-xs text-muted-foreground">No patterns on the latest candles.</p>}
            <div className="max-h-60 space-y-0.5 overflow-auto font-mono text-xs">
              {pat.hits.map((h) => (
                <div key={h.name} className="flex justify-between gap-2">
                  <span><span className="text-muted-foreground">[{h.group}]</span> {h.name}</span>
                  <span className={h.bias === 0 ? "text-up" : "text-down"}>{h.bias === 0 ? "▲" : "▼"} {h.weight}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <Profiles settings={settings} onApply={applySettings} onLog={addLog} />
        <Journal trades={trades} />

        <section className="glass rounded-sm p-4">
          <h2 className="mb-2 font-semibold">Trade history</h2>
          <div className="max-h-80 space-y-1 overflow-auto font-mono text-xs">
            {trades.length === 0 && <p className="text-muted-foreground">No trades yet.</p>}
            {trades.map((t) => (
              <div key={t.id} className="flex justify-between border-b border-border py-1">
                <span>{t.time} {t.label} {t.symbol}</span>
                <span className={t.profit == null ? "text-muted-foreground" : t.profit > 0 ? "text-up" : "text-down"}>{t.profit == null ? "open" : t.profit.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="glass rounded-sm p-4 lg:col-span-2">
          <h2 className="mb-2 font-semibold">Activity log</h2>
          <div className="max-h-80 overflow-auto font-mono text-xs text-muted-foreground">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </section>

        <BrainPanel
          sides={def.sides}
          onVerdict={(v) => { setBrain(v); if (v) addLog(`Brain (${v.provider}): ${v.side === null ? "WAIT" : def.sides[v.side]} ${v.confidence}%`); }}
          getSnapshot={() => ({
            symbol, name: inst?.name, marketType: inst?.group, contract: def.label, sideA: def.sides[0], sideB: def.sides[1],
            duration: `${duration}${unit}`, barrier: def.barrier === "digit" ? digit : def.barrier === "offset" ? offset : def.barrier === "range" ? [hi, lo] : null,
            last: prices[prices.length - 1], localSignal: { side: sig.side === null ? "WAIT" : def.sides[sig.side], confidence: sig.confidence, note: sig.note },
            patterns: pat?.hits.map((h) => `${h.name} ${h.bias === 0 ? "bullish" : "bearish"}`),
            indicators: base.parts.map((p) => `${p.name}: ${p.detail} (${p.bias ?? "neutral"})`),
            digits: stats ? stats.counts : undefined,
            recentTicks: prices.slice(-120).filter((_, i) => i % 2 === 0),
            session: { trades: trades.length, net },
          })}
        />
        <label className="glass flex items-center gap-2 rounded-sm p-3 text-sm lg:col-span-3">
          <input type="checkbox" checked={brainGate} onChange={(e) => setBrainGate(e.target.checked)} />
          Autopilot only trades when the AI Brain agrees with the chart signal
        </label>
        <DiagnosePanel error={error} log={log} appId={appId} />
      </main>
    </div>
  );
}
