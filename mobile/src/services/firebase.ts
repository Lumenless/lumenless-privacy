import analytics from '@react-native-firebase/analytics';

/**
 * Initialize Firebase. With React Native Firebase, the app is auto-configured
 * from google-services.json (Android) / GoogleService-Info.plist (iOS).
 * This is a no-op for API compatibility.
 */
export function initFirebase(): void {
  // React Native Firebase auto-initializes from native config files.
}

export function getFirebaseAnalytics() {
  return analytics();
}

export function logEvent(name: string, params?: Record<string, unknown>): void {
  analytics().logEvent(name, params as Record<string, string | number | boolean>);
}

/** Log a screen view (Firebase recommended event). */
export function logScreenView(screenName: string, screenClass?: string): void {
  analytics().logScreenView({
    screen_name: screenName,
    screen_class: screenClass ?? screenName,
  });
}

/** App event names for consistent analytics. */
export const analyticsEvents = {
  screenView: 'screen_view',
  walletConnect: 'wallet_connect',
  withdraw: 'privacycash_withdraw',
  deposit: 'privacycash_deposit',
  claimPublicly: 'claim_publicly',
  createInvoice: 'create_invoice',
  onboardingComplete: 'onboarding_complete',
  pushTokenRegistered: 'push_token_registered',
} as const;
