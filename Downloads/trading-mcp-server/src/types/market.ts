export type Timespan = 'minute' | 'hour' | 'day';

export interface MarketCandle {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface AggregatesQuery {
  symbol: string; // journal symbol, e.g., EURUSD
  from: string; // ISO date/time
  to: string;   // ISO date/time
  timespan: Timespan;
}

export interface AnalysisTradeRecord {
  id: string | number;
  symbol: string;
  direction: 'buy' | 'sell';
  entryTime?: string;
  exitTime?: string;
  entryPrice?: number;
  qty?: number;
  profit?: number;
}

export interface AnalysisRequestBody {
  trades?: AnalysisTradeRecord[];
  from?: string;
  to?: string;
  symbols?: string[];
  timespan?: Timespan;
  includeRaw?: boolean;
}

export interface AnalysisResponseBody {
  textSummary: string; // RU
  structuredInsights: any; // keep flexible for MVP
  candles?: Record<string, MarketCandle[]>;
}
