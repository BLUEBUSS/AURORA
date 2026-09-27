import type {
  CryptoDerivativesDataQuery,
  CryptoDerivativesDataResult,
  CryptoMarketDataQuery,
  CryptoMarketDataResult,
  CryptoOptionsDataQuery,
  CryptoOptionsDataResult,
  CryptoDexDataQuery,
  CryptoDexDataResult,
  CryptoDefiDataQuery,
  CryptoDefiDataResult,
  CryptoOnchainDataQuery,
  CryptoOnchainDataResult,
  CryptoAssetDataQuery,
  CryptoAssetDataResult,
  CryptoSentimentDataQuery,
  CryptoSentimentDataResult,
} from "./types.js";

export interface CryptoProvider {
  readonly id: string;
  getMarketData(query: CryptoMarketDataQuery): Promise<CryptoMarketDataResult>;
  getDerivativesData(query: CryptoDerivativesDataQuery): Promise<CryptoDerivativesDataResult>;
}

export interface CryptoOptionsProvider {
  readonly id: string;
  getOptionsData(query: CryptoOptionsDataQuery): Promise<CryptoOptionsDataResult>;
}

export interface CryptoDexProvider {
  readonly id: string;
  getDexData(query: CryptoDexDataQuery): Promise<CryptoDexDataResult>;
}

export interface CryptoDefiProvider {
  readonly id: string;
  getDefiData(query: CryptoDefiDataQuery): Promise<CryptoDefiDataResult>;
}

export interface CryptoOnchainProvider {
  readonly id: string;
  getOnchainData(query: CryptoOnchainDataQuery): Promise<CryptoOnchainDataResult>;
}

export interface CryptoAssetProvider {
  readonly id: string;
  getAssetData(query: CryptoAssetDataQuery): Promise<CryptoAssetDataResult>;
}

export interface CryptoSentimentProvider {
  readonly id: string;
  getSentimentData(query: CryptoSentimentDataQuery): Promise<CryptoSentimentDataResult>;
}
