import { describe, expect, it } from "vitest";
import { canCloseCompanion, dispatchTogether } from "./paired-execution";

describe("double execution timing", () => {
  it("dispatches both orders before either is confirmed", async () => {
    const sent: string[] = [];
    let confirmFirst: ((id: number) => void) | undefined;
    const result = dispatchTogether([
      () => { sent.push("OVER"); return new Promise<number>(resolve => { confirmFirst = resolve; }); },
      () => { sent.push("UNDER"); return Promise.resolve(2); },
    ]);
    expect(sent).toEqual(["OVER", "UNDER"]);
    confirmFirst?.(1);
    expect(await result).toEqual([{ status: "fulfilled", value: 1 }, { status: "fulfilled", value: 2 }]);
  });
  it("does not retry one rejected leg later than its partner", async () => {
    let attempts = 0;
    const results = await dispatchTogether([
      () => { attempts++; return Promise.reject(new Error("RateLimit")); },
      () => Promise.resolve(2),
    ]);
    expect(attempts).toBe(1);
    expect(results[0]?.status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: 2 });
  });
  it("can close only the confirmed sellable companion", () => {
    expect(canCloseCompanion({ contract_id: 2, is_valid_to_sell: 1, status: "open" }, 2)).toBe(true);
    expect(canCloseCompanion({ contract_id: 2, is_valid_to_sell: 0 }, 2)).toBe(false);
    expect(canCloseCompanion({ contract_id: 2, is_valid_to_sell: 1, is_sold: 1 }, 2)).toBe(false);
    expect(canCloseCompanion({ contract_id: 3, is_valid_to_sell: 1 }, 2)).toBe(false);
  });
});