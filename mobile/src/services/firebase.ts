import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAnalytics, logEvent as firebaseLogEvent, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let analytics: Analytics | null = null;

export function initFirebase(): void {
  if (getApps().length > 0) return;
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) return;

  try {
    app = initializeApp(firebaseConfig);
    analytics = getAnalytics(app);
  } catch {
    // Analytics may be unsupported in some environments (e.g. Expo Go)
  }
}

export function getFirebaseAnalytics(): Analytics | null {
  return analytics;
}

export function logEvent(name: string, params?: Record<string, unknown>): void {
  if (analytics) {
    firebaseLogEvent(analytics, name, params);
  }
}

/** Log a screen view (Firebase recommended event). */
export function logScreenView(screenName: string, screenClass?: string): void {
  logEvent('screen_view', {
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
