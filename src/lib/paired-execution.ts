/** Dispatch both orders before awaiting either response. Never retry a pair leg alone. */
export async function dispatchTogether<T>(orders: (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
  const pending = orders.map(order => {
    try { return order(); } catch (error) { return Promise.reject(error); }
  });
  return Promise.allSettled(pending);
}

/** Only a broker-confirmed sellable, still-open contract can be closed. */
export function canCloseCompanion(contract: {
  contract_id?: number; is_sold?: number | boolean; is_valid_to_sell?: number | boolean; status?: string;
}, id: number): boolean {
  return Number(contract.contract_id) === id && !contract.is_sold &&
    contract.status !== "won" && contract.status !== "lost" && Boolean(contract.is_valid_to_sell);
}