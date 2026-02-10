import * as SecureStore from 'expo-secure-store';

const ONBOARDING_COMPLETED_KEY = 'lumenless_onboarding_completed';
const LUMEN_ID_MINTED_KEY = 'lumenless_lumen_id_minted';

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(ONBOARDING_COMPLETED_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}

export async function setOnboardingCompleted(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDING_COMPLETED_KEY, 'true');
}

export async function hasMintedLumenId(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(LUMEN_ID_MINTED_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}

export async function setLumenIdMinted(): Promise<void> {
  await SecureStore.setItemAsync(LUMEN_ID_MINTED_KEY, 'true');
}

/** For testing: clear the Lumen ID minted flag so onboarding/mint flow can be run again. */
export async function clearLumenIdMinted(): Promise<void> {
  await SecureStore.deleteItemAsync(LUMEN_ID_MINTED_KEY);
}
