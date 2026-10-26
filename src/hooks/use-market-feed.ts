import { useCallback, useEffect, useRef, useState } from "react";
import { PUBLIC_MARKET_URL } from "@/lib/terminal-engine";
import { groupOf } from "@/lib/contracts";

export type Market = {
  symbol: string;
  name: string;
  group: string;
  decimals: number;
  open: boolean;
};
export type MarketFeed = { prices: number[]; timestamp: number; decimals: number };
type Message = {
  active_symbols?: any[];
  symbol?: string;
  underlying_symbol?: string;
  pip?: number;
  pip_size?: number;
  display_name?: string;
  underlying_symbol_name?: string;
  market?: string;
  exchange_is_open?: number;
  is_trading_suspended?: number;
  contracts_for?: any;
  contract_type?: string;
  req_id?: number;
  error?: any;
  history?: any;
  echo_req?: any;
  tick?: any;
  proposal?: any;
};
type Pending = {
  resolve: (value: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function useMarketFeed() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [feeds, setFeeds] = useState<Record<string, MarketFeed>>({});
  const [contracts, setContracts] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<
    "Disconnected" | "Connecting" | "Connected" | "Reconnecting" | "Error"
  >("Connecting");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [generation, setGeneration] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const requestId = useRef(1);
  const catalog = useRef(new Map<string, Market>());
  const addEvent = useCallback(
    (text: string) =>
      setEvents((rows) => [`${new Date().toLocaleTimeString()} ${text}`, ...rows].slice(0, 100)),
    [],
  );

  const request = useCallback(
    (payload: Record<string, unknown>): Promise<Message> =>
      new Promise((resolve, reject) => {
        const ws = socket.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("Public market feed is disconnected"));
          return;
        }
        const id = requestId.current++;
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error("Market request timed out"));
        }, 15000);
        pending.current.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ ...payload, req_id: id }));
      }),
    [],
  );

  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const jobs: ReturnType<typeof setTimeout>[] = [];
    const rejectPending = () => {
      pending.current.forEach((p) => {
        clearTimeout(p.timer);
        p.reject(new Error("Market connection closed"));
      });
      pending.current.clear();
    };
    const open = () => {
      if (stopped) return;
      setStatus(attempts ? "Reconnecting" : "Connecting");
      const ws = new WebSocket(PUBLIC_MARKET_URL);
      socket.current = ws;
      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) ws.close();
      }, 15000);
      ws.onopen = () => {
        clearTimeout(connectTimeout);
        setStatus("Connected");
        setError("");
        addEvent("Public market socket connected — account not authorized");
        heartbeat = setInterval(() => {
          void request({ ping: 1 }).catch(() => {});
        }, 30000);
        void request({ active_symbols: "brief", product_type: "basic" })
          .then((message) => {
            if (stopped || socket.current !== ws) return;
            const list: Market[] = (message.active_symbols ?? [])
              .map((raw: Message) => {
                const symbol = String(raw.symbol ?? raw.underlying_symbol ?? "");
                const pip = Number(raw.pip ?? raw.pip_size);
                return {
                  symbol,
                  name: String(raw.display_name ?? raw.underlying_symbol_name ?? symbol),
                  group: groupOf(symbol, String(raw.market ?? "")),
                  decimals:
                    Number.isFinite(pip) && pip > 0 ? Math.max(0, Math.round(-Math.log10(pip))) : 2,
                  open: Boolean(raw.exchange_is_open) && !raw.is_trading_suspended,
                };
              })
              .filter((market: Market) => market.symbol);
            setMarkets(list);
            catalog.current = new Map(list.map((m) => [m.symbol, m]));
            addEvent(`Discovered ${list.length} broker instruments`);
            const ordered = [...list].sort(
              (a, b) => Number(b.group === "Derived") - Number(a.group === "Derived"),
            );
            ordered
              .filter((m) => m.open)
              .forEach((market, index) => {
                jobs.push(
                  setTimeout(() => {
                    if (stopped || ws.readyState !== WebSocket.OPEN) return;
                    void request({
                      contracts_for: market.symbol,
                      currency: "USD",
                      product_type: "basic",
                    })
                      .then((response) => {
                        if (stopped) return;
                        setContracts((previous) => ({
                          ...previous,
                          [market.symbol]: [
                            ...new Set<string>(
                              (response.contracts_for?.available ?? []).map((c: Message) =>
                                String(c.contract_type),
                              ),
                            ),
                          ],
                        }));
                      })
                      .catch((e) =>
                        addEvent(`${market.name}: contract discovery failed · ${e.message}`),
                      );
                    void request({
                      ticks_history: market.symbol,
                      count: 300,
                      end: "latest",
                      style: "ticks",
                      subscribe: 1,
                    }).catch((e) => addEvent(`${market.name}: ticks unavailable · ${e.message}`));
                  }, index * 450),
                );
              });
          })
          .catch((e) => {
            setError(e.message);
            setStatus("Error");
            addEvent(`Symbol discovery failed: ${e.message}`);
          });
      };
      ws.onmessage = (event) => {
        let message: Message;
        try {
          message = JSON.parse(event.data);
        } catch {
          addEvent("Malformed market response ignored");
          return;
        }
        const item = pending.current.get(Number(message.req_id));
        if (item) {
          pending.current.delete(Number(message.req_id));
          clearTimeout(item.timer);
          if (message.error)
            item.reject(new Error(String(message.error.message ?? "Market request rejected")));
          else item.resolve(message);
        }
        if (message.error) return;
        if (message.history) {
          const symbol = String(message.echo_req?.ticks_history ?? "");
          const market = catalog.current.get(symbol);
          const prices = (message.history.prices ?? []).map(Number).filter(Number.isFinite);
          const timestamp = Number(message.history.times?.at(-1) ?? 0) * 1000;
          if (market && prices.length)
            setFeeds((previous) => ({
              ...previous,
              [symbol]: { prices, timestamp, decimals: market.decimals },
            }));
        }
        if (message.tick) {
          const symbol = String(message.tick.symbol);
          const market = catalog.current.get(symbol);
          const quote = Number(message.tick.quote);
          if (market && Number.isFinite(quote))
            setFeeds((previous) => ({
              ...previous,
              [symbol]: {
                prices: [...(previous[symbol]?.prices ?? []), quote].slice(-500),
                timestamp: Number(message.tick.epoch) * 1000,
                decimals: Number.isInteger(message.tick.pip_size)
                  ? message.tick.pip_size
                  : market.decimals,
              },
            }));
        }
      };
      ws.onerror = () => {
        setError("Cannot reach Deriv market data. Check your network or blockers.");
        addEvent("Public socket connection error");
      };
      ws.onclose = () => {
        clearTimeout(connectTimeout);
        if (heartbeat) clearInterval(heartbeat);
        jobs.forEach(clearTimeout);
        rejectPending();
        if (stopped) return;
        attempts++;
        if (attempts > 5) {
          setStatus("Error");
          addEvent("Reconnect attempts exhausted — retry manually");
          return;
        }
        setStatus("Reconnecting");
        const delay = Math.min(1000 * 2 ** (attempts - 1), 30000);
        addEvent(`Disconnected — reconnect in ${delay / 1000}s`);
        retry = setTimeout(open, delay);
      };
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (heartbeat) clearInterval(heartbeat);
      jobs.forEach(clearTimeout);
      rejectPending();
      socket.current?.close();
      socket.current = null;
    };
  }, [generation, request, addEvent]);

  return {
    markets,
    feeds,
    contracts,
    status,
    error,
    events,
    request,
    addEvent,
    clearEvents: () => setEvents([]),
    reconnect: () => setGeneration((n) => n + 1),
  };
}
