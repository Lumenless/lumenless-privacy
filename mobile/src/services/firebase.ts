import analytics from '@react-native-firebase/analytics';
import crashlytics from '@react-native-firebase/crashlytics';

/**
 * Initialize Firebase. With React Native Firebase, the app is auto-configured
 * from google-services.json (Android) / GoogleService-Info.plist (iOS).
 * This is a no-op for API compatibility.
 */
export function initFirebase(): void {
  // React Native Firebase auto-initializes from native config files.
}

/**
 * Initialize Crashlytics and enable crash collection.
 * Call this early in the app lifecycle.
 */
export async function initCrashlytics(): Promise<void> {
  // Enable crash collection (disabled by default in debug builds)
  await crashlytics().setCrashlyticsCollectionEnabled(true);
}

export function getFirebaseAnalytics() {
  return analytics();
}

export function getFirebaseCrashlytics() {
  return crashlytics();
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

// ─────────────────────────────────────────────────────────────────────────────
// Crashlytics Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a non-fatal error to Crashlytics.
 * Use this to track caught exceptions that don't crash the app.
 */
export function recordError(error: Error, jsErrorName?: string): void {
  if (jsErrorName) {
    crashlytics().setAttributes({ jsErrorName });
  }
  crashlytics().recordError(error);
}

/**
 * Log a message to Crashlytics. These appear in crash reports
 * to help understand what the user was doing before a crash.
 */
export function crashLog(message: string): void {
  crashlytics().log(message);
}

/**
 * Set a user identifier for Crashlytics reports.
 * Helps identify which user experienced a crash.
 */
export function setCrashlyticsUserId(userId: string): void {
  crashlytics().setUserId(userId);
}

/**
 * Set custom key-value attributes for Crashlytics reports.
 */
export function setCrashlyticsAttribute(key: string, value: string): void {
  crashlytics().setAttribute(key, value);
}

/**
 * Set multiple custom attributes at once.
 */
export function setCrashlyticsAttributes(attributes: Record<string, string>): void {
  crashlytics().setAttributes(attributes);
}

/**
 * Force a test crash. Only use in development to verify Crashlytics is working.
 */
export function testCrash(): void {
  if (__DEV__) {
    console.warn('[Crashlytics] Triggering test crash...');
  }
  crashlytics().crash();
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
