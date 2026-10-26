import { expect, it } from "vitest";
import { metadataAllows, quoteBuyPayload, quoteExact } from "./deriv-proposal";

it("quotes the exact +0.61 barrier and buys only the returned proposal ID", async () => {
  const sent: Record<string, unknown>[] = [];
  const c = { send: async (p: Record<string, unknown>) => { sent.push(p); return { proposal: { id: "confirmed-quote", ask_price: 1, payout: 1.85 } }; } };
  const q = await quoteExact(c, { underlying_symbol: "R_50", contract_type: "CALL", barrier: "+0.61", duration: 5, duration_unit: "t" });
  expect(sent).toEqual([{ proposal: 1, underlying_symbol: "R_50", contract_type: "CALL", barrier: "+0.61", duration: 5, duration_unit: "t" }]);
  expect(quoteBuyPayload(q)).toEqual({ buy: "confirmed-quote", price: 1 });
});
it("never retries or resets a rejected +0.61 barrier", async () => {
  let count = 0;
  await expect(quoteExact({ send: async () => { count++; throw new Error("Invalid barrier"); } }, { underlying_symbol: "1HZ100V", contract_type: "CALL", barrier: "+0.61" })).rejects.toThrow("Requested barrier +0.61 unchanged; no order purchased");
  expect(count).toBe(1);
});
it("rejects quotes without a confirmed price", async () => { await expect(quoteExact({ send: async () => ({ proposal: { id: "no-price" } }) }, {})).rejects.toThrow("priced proposal"); });
it("does not buy expired quotes", () => expect(() => quoteBuyPayload({ id: "x", price: 1, payout: 2, request: {}, expires: 10 }, 11)).toThrow("expired"));
it("fails closed on unknown contract availability", () => expect(metadataAllows(null, "CALL", true, 5, "t")).toContain("not been verified"));
it("separates Rise/Fall from barrier Higher/Lower and duration", () => {
  const rows = [{ contract_type: "CALL", barriers: 0, min_contract_duration: "1t", max_contract_duration: "10t" }, { contract_type: "CALL", barriers: 1, min_contract_duration: "5m", max_contract_duration: "1d" }];
  expect(metadataAllows(rows, "CALL", true, 5, "t")).toContain("not supported");
  expect(metadataAllows(rows, "CALL", true, 5, "m")).toBeNull();
  expect(metadataAllows(rows, "CALL", false, 5, "t")).toBeNull();
});