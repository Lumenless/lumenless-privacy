// Birdeye API service for token data
// Token: LUMEN (6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM)

const BIRDEYE_API_URL = 'https://public-api.birdeye.so';
const LUMEN_TOKEN_ADDRESS = '6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM';

// You can set this via environment variable or config
const BIRDEYE_API_KEY = process.env.EXPO_PUBLIC_BIRDEYE_API_KEY || '';

export interface TokenOverview {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  price: number;
  priceChange24hPercent: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  supply: number;
}

const headers = {
  'X-API-KEY': BIRDEYE_API_KEY,
  'x-chain': 'solana',
};

export async function getTokenOverview(tokenAddress: string = LUMEN_TOKEN_ADDRESS): Promise<TokenOverview | null> {
  try {
    const response = await fetch(
      `${BIRDEYE_API_URL}/defi/token_overview?address=${tokenAddress}`,
      { headers }
    );
    const data = await response.json();
    if (data.success) {
      return data.data;
    }
    return null;
  } catch (error) {
    console.error('Error fetching token overview:', error);
    return null;
  }
}

export const LUMEN_TOKEN = {
  address: LUMEN_TOKEN_ADDRESS,
  symbol: 'LUMEN',
  name: 'Lumenless',
};
