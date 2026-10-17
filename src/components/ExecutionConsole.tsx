import { Activity, Cpu, Pickaxe, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SETUPS, type SetupId, type runSetup } from "@/lib/patterns";
import { balanceStakeCap, demoStrategyStats, type SessionTrade } from "@/lib/trading-session";

type Props = {
  trades: SessionTrade[]; accountId?: string | undefined; demo: boolean; connected: boolean;
  auto: boolean; busy: boolean; balance: number | null; riskPercent: number; maxStake: number;
  setupId: SetupId; setups: Record<SetupId, ReturnType<typeof runSetup>>;
  onSelect: (id: SetupId) => void; onReconcile: () => void; reconciling: boolean;
};

export function ExecutionConsole(p: Props) {
  const cap = balanceStakeCap(p.balance, p.riskPercent, p.maxStake);
  const pending = p.trades.filter(t => t.accountId === p.accountId && t.profit === null).length;
  const settled = p.trades.filter(t => t.accountId === p.accountId && t.profit !== null);
  const net = settled.reduce((s, t) => s + (t.profit ?? 0), 0);
  const active = p.setups[p.setupId];
  return <section className="col-span-full min-w-0 break-words border-y border-border bg-background/95 px-4 py-5 sm:px-6" aria-label="Execution mining console">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><div className="mb-2 flex items-center gap-2 text-xs text-telemetry"><Pickaxe size={16} /> MWASE / SIGNAL FORGE</div><h2 className="!mb-0 !border-0 !pb-0 !text-lg">Execution mining console</h2></div>
      <span className={p.busy ? "text-primary" : p.auto ? "text-up" : "text-muted-foreground"}>{p.busy ? "● CONTRACT ACTIVE" : p.auto ? "● SCANNING SETUPS" : "○ STANDBY"}</span>
    </div>
    <div className="mb-6 grid grid-cols-2 gap-4 border-b border-border pb-5 text-xs lg:grid-cols-4">
      <div><Cpu size={17} className="mb-2 text-telemetry" /><div className="text-muted-foreground">PATTERN → CONFIRMATION</div><div className="mt-1 text-base">{Object.values(active.checks).filter(Boolean).length}/{Object.keys(active.checks).length} checks</div></div>
      <div><Zap size={17} className="mb-2 text-primary" /><div className="text-muted-foreground">OPEN / SETTLED ORDERS</div><div className="mt-1 text-base">{pending} / {settled.length}</div></div>
      <div><ShieldCheck size={17} className="mb-2 text-telemetry" /><div className="text-muted-foreground">BALANCE STAKE CEILING</div><div className="mt-1 text-base">{cap === null ? "Awaiting balance" : cap.toFixed(2)} <span className="text-xs text-muted-foreground">/ {p.riskPercent}%</span></div></div>
      <div><Activity size={17} className="mb-2 text-primary" /><div className="text-muted-foreground">CONFIRMED SESSION P/L</div><div className={`mt-1 text-base ${net < 0 ? "text-down" : "text-up"}`}>{settled.length ? net.toFixed(2) : "—"}</div></div>
    </div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Demo strategy comparison</h3><span className="text-xs text-muted-foreground">{p.demo ? "CURRENT DEMO ACCOUNT · SESSION ONLY" : "DEMO ACCOUNT REQUIRED FOR RESULTS"}</span></div>
    <div className="grid gap-3 lg:grid-cols-3">
      {(Object.keys(SETUPS) as SetupId[]).map(id => {
        const s = demoStrategyStats(p.trades, id, p.accountId);
        const setup = p.setups[id];
        return <article key={id} className={`min-w-0 rounded-sm border p-4 ${id === p.setupId ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
          <div className="mb-2 flex items-center justify-between text-xs"><span className="text-telemetry">ENGINE_{id}</span><span className={setup.side === null ? "text-muted-foreground" : "text-up"}>{setup.side === null ? "WAITING" : "CONFIRMED"}</span></div>
          <h4 className="min-h-10 text-sm font-semibold">{SETUPS[id]}</h4>
          <div className="my-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">{Object.entries(setup.checks).map(([key, ok]) => <span key={key} className={ok ? "text-up" : "text-muted-foreground"}>{ok ? "✓" : "○"} {key}</span>)}</div>
          <div className="grid grid-cols-2 gap-2 border-y border-border py-3 text-xs">
            <span className="text-muted-foreground">Wins / losses / flat</span><span className="text-right">{s.wins} / {s.losses} / {s.flat}</span>
            <span className="text-muted-foreground">Net P/L</span><span className={`text-right ${s.net < 0 ? "text-down" : "text-up"}`}>{s.settled ? s.net.toFixed(2) : "—"}</span>
            <span className="text-muted-foreground">Win rate</span><span className="text-right">{s.winRate === null ? "—" : `${s.winRate.toFixed(1)}%`}</span>
            <span className="text-muted-foreground">Profit / trade</span><span className="text-right">{s.expectancy === null ? "—" : s.expectancy.toFixed(2)}</span>
            <span className="text-muted-foreground">Profit factor</span><span className="text-right">{s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)}</span>
            <span className="text-muted-foreground">Pending</span><span className="text-right">{s.pending}</span>
          </div>
          <p className="my-3 min-h-10 text-xs text-muted-foreground">{setup.note}</p>
          <Button variant={id === p.setupId ? "secondary" : "outline"} aria-pressed={id === p.setupId} onClick={() => p.onSelect(id)} disabled={p.busy || p.auto} className="w-full">{id === p.setupId ? `Engine ${id} selected` : `Select engine ${id}`}</Button>
        </article>;
      })}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>Trading, not Bitcoin mining. No guaranteed yield. Results are confirmed by Deriv.</span>{pending > 0 && p.connected && <Button variant="outline" size="sm" onClick={p.onReconcile} disabled={p.reconciling || p.busy}>{p.reconciling ? "Checking orders…" : "Check unresolved orders"}</Button>}</div>
  </section>;
}