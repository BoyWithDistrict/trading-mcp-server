// Экспорты для моделей
export * from './user.model';

// Экспорты для Express
export * from './express';

// Общие типы
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

// Типы для торговли
export interface Trade {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  price: number;
  quantity: number;
  timestamp: Date;
  profitLoss?: number;
  notes?: string;
}

export interface MarketConditions {
  symbol: string;
  timeframe: string;
  atr: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  support: number[];
  resistance: number[];
  volume: number;
  timestamp: Date;
}

export interface PortfolioAnalysis {
  totalValue: number;
  profitLoss: number;
  bestPerformer: {
    symbol: string;
    pnl: number;
  };
  worstPerformer: {
    symbol: string;
    pnl: number;
  };
  timestamp: Date;
}

// Типы для ошибок
export interface ApiError extends Error {
  statusCode: number;
  isOperational?: boolean;
  code?: number;
  errors?: any[];
}

// Типы для валидации
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}
