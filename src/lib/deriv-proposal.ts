export type BrokerQuote = {
  id: string;
  price: number;
  payout: number | null;
  expires: number;
  request: Record<string, unknown>;
};
type Sender = { send: (payload: Record<string, unknown>) => Promise<any> };

/** Validate the exact entered parameters once. Never guess barriers or retry purchases. */
export async function quoteExact(
  client: Sender,
  request: Record<string, unknown>,
): Promise<BrokerQuote> {
  let response: any;
  try {
    response = await client.send({ ...request, proposal: 1 });
  } catch (e) {
    const barrier = request["barrier"];
    const text = e instanceof Error ? e.message : "Proposal rejected";
    throw new Error(
      `${request["contract_type"]} on ${request["underlying_symbol"] ?? request["symbol"]}: ${text}${barrier !== undefined ? ` Requested barrier ${barrier} unchanged; no order purchased.` : " No order purchased."}`,
    );
  }
  const id = response?.proposal?.id;
  const price = Number(response?.proposal?.ask_price);
  const payout = Number(response?.proposal?.payout);
  if (!id || !Number.isFinite(price) || price <= 0)
    throw new Error("Deriv did not return a priced proposal. No order purchased.");
  return {
    id: String(id),
    price,
    payout: Number.isFinite(payout) ? payout : null,
    expires: Date.now() + 10000,
    request,
  };
}

export function quoteBuyPayload(quote: BrokerQuote, now = Date.now()) {
  if (now > quote.expires) throw new Error("Proposal expired; request a new quote before trading");
  return { buy: quote.id, price: quote.price };
}

export type ContractMetadata = {
  contract_type?: string;
  barriers?: number;
  barrier_category?: string;
  min_contract_duration?: string;
  max_contract_duration?: string;
  expiry_type?: string;
};
export function metadataAllows(
  rows: ContractMetadata[] | null,
  ct: string,
  hasBarrier: boolean,
  duration: number,
  unit: string,
): string | null {
  if (!rows)
    return "Contract availability has not been verified; refresh the market before trading";
  const candidates = rows.filter(
    (row) =>
      row.contract_type === ct &&
      (row.barriers === undefined ||
        (hasBarrier ? Number(row.barriers) > 0 : Number(row.barriers) === 0)),
  );
  if (!candidates.length)
    return `${ct}${hasBarrier ? " with a barrier" : ""} is not offered on this market`;
  const seconds = (s: string) => {
    const m = /^(\d+)([tsmhd])$/.exec(s);
    if (!m) return null;
    const n = Number(m[1]);
    return m[2] === "t"
      ? { ticks: n }
      : { seconds: n * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? "s"] ?? 1) };
  };
  const value = unit === "t" ? duration : duration * (unit === "m" ? 60 : 1);
  const supported = candidates.some((row) => {
    const min = row.min_contract_duration ? seconds(row.min_contract_duration) : null;
    const max = row.max_contract_duration ? seconds(row.max_contract_duration) : null;
    if (row.expiry_type === "tick" && unit !== "t") return false;
    if (row.expiry_type === "intraday" && unit === "t") return false;
    if (min && ((unit === "t" && "seconds" in min) || (unit !== "t" && "ticks" in min)))
      return false;
    const low = min ? ("ticks" in min ? min.ticks : min.seconds) : undefined;
    const high = max ? ("ticks" in max ? max.ticks : max.seconds) : undefined;
    return (low === undefined || value >= low) && (high === undefined || value <= high);
  });
  return supported
    ? null
    : `Requested ${duration}${unit} is not supported for ${ct}${hasBarrier ? " with a barrier" : ""}; choose a broker-supported duration`;
}
