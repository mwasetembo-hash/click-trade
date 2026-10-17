import { describe, expect, it } from "vitest";
import { canCloseCompanion, dispatchTogether, offsetSettingsBatch } from "./paired-execution";

describe("one-tap offset settings", () => {
  it("covers Higher and Lower at both exact +0.5 and -0.5 barriers", () => {
    expect(offsetSettingsBatch(["CALL", "PUT"], ["Higher", "Lower"], 5, "t")).toEqual([
      { ct: "CALL", barrier: "+0.5", label: "Higher +0.5", duration: 5, unit: "t" },
      { ct: "CALL", barrier: "-0.5", label: "Higher -0.5", duration: 5, unit: "t" },
      { ct: "PUT", barrier: "+0.5", label: "Lower +0.5", duration: 5, unit: "t" },
      { ct: "PUT", barrier: "-0.5", label: "Lower -0.5", duration: 5, unit: "t" },
    ]);
  });
  it("applies both offsets to Touch and No Touch with the same selected expiry", () => {
    const batch = offsetSettingsBatch(["ONETOUCH", "NOTOUCH"], ["Touch", "No Touch"], 3, "m");
    expect(batch.map(({ ct, barrier, duration, unit }) => [ct, barrier, duration, unit])).toEqual([
      ["ONETOUCH", "+0.5", 3, "m"], ["ONETOUCH", "-0.5", 3, "m"],
      ["NOTOUCH", "+0.5", 3, "m"], ["NOTOUCH", "-0.5", 3, "m"],
    ]);
  });
  it("dispatches all four immediately and waits for each independent confirmation", async () => {
    const batch = offsetSettingsBatch(["CALL", "PUT"], ["Higher", "Lower"], 5, "t");
    const sent: string[] = [];
    let settleLast: ((value: number) => void) | undefined;
    let finished = false;
    const pending = dispatchTogether(batch.map((spec, i) => () => {
      sent.push(`${spec.ct} ${spec.barrier}`);
      return i === 3 ? new Promise<number>(resolve => { settleLast = resolve; }) : Promise.resolve(i);
    })).then(results => { finished = true; return results; });
    expect(sent).toEqual(["CALL +0.5", "CALL -0.5", "PUT +0.5", "PUT -0.5"]);
    await Promise.resolve();
    expect(finished).toBe(false);
    settleLast?.(3);
    expect(await pending).toEqual([0, 1, 2, 3].map(value => ({ status: "fulfilled", value })));
  });
});

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