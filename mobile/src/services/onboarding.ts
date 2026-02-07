import * as SecureStore from 'expo-secure-store';

const ONBOARDING_COMPLETED_KEY = 'lumenless_onboarding_completed';

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
