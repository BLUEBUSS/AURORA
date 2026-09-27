import type { TradfiPerpetualQuery, TradfiPerpetualResult } from "./types.js";

export interface TradfiPerpetualProvider {
  readonly id: string;
  getData(query: TradfiPerpetualQuery): Promise<TradfiPerpetualResult>;
}
