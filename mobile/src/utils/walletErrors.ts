/**
 * Maps raw wallet/adapter errors (e.g. Java CancellationException on Android)
 * to user-friendly messages.
 */
export function getWalletErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();

  if (
    lower.includes('cancellation') ||
    lower.includes('cancel') ||
    lower.includes('cancelled')
  ) {
    return 'Connection cancelled. You can try again when you\'re ready.';
  }
  if (lower.includes('reject') || lower.includes('denied') || lower.includes('declined')) {
    return 'Wallet request was declined. You can try again when you\'re ready.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Request timed out. Please try again.';
  }

  return fallback;
}
