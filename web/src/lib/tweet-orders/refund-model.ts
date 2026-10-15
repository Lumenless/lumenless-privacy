export const REVIEW_TIMEOUT_MS = 72 * 60 * 60 * 1000;
export type RefundAuthorization = { wallet: string; timestamp: number; nonce: string; signature: string };
export function refundAuthorizationMessage(id: string, authorization: Omit<RefundAuthorization, 'signature'>) {
  return `Lumenless review-timeout refund (Solana mainnet)\nOrder: ${id}\nBuyer: ${authorization.wallet}\nTimestamp: ${authorization.timestamp}\nNonce: ${authorization.nonce}\nAuthorize a full refund to the original paying wallet only. No platform fee.`;
}
