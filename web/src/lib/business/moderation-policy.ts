// Immutable X user IDs: @lumenless and @heymike777. Usernames can change owners.
const PERSONAL_ACCOUNT_IDS = new Set(['1644933348274446336', '1635207257339179010']);
export function canRejectWithoutRefund(accountId: string | null | undefined): boolean {
  return typeof accountId === 'string' && PERSONAL_ACCOUNT_IDS.has(accountId);
}
