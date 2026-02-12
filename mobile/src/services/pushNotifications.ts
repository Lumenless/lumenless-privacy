import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { logEvent, analyticsEvents } from './firebase';

const ANDROID_CHANNEL_ID = 'default';

/**
 * Configure how notifications are presented when the app is in the foreground.
 * Call this once at app startup.
 */
export function setNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldAnimate: true,
    }),
  });
}

/**
 * Create the default Android notification channel (required before getting token on Android 13+).
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#8000FF',
    });
  }
}

/**
 * Register for push notifications and return the Expo push token.
 * Returns null if not a physical device, permission denied, or projectId missing (e.g. not an EAS build).
 * The token can be sent to your backend to target this device via Expo Push API or FCM.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    if (__DEV__) {
      console.log('[Push] Skipped: not a physical device');
    }
    return null;
  }

  if (Platform.OS === 'android') {
    await ensureAndroidChannel();
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    if (finalStatus !== 'granted') {
      if (__DEV__) {
        console.log('[Push] Permission not granted');
      }
      return null;
    }
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    if (__DEV__) {
      console.log(
        '[Push] No EAS projectId found. Run an EAS build or set extra.eas.projectId in app config to enable push.'
      );
    }
    return null;
  }

  try {
    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = tokenResult.data;
    if (__DEV__) {
      console.log('[Push] Expo push token:', token);
    }
    logEvent(analyticsEvents.pushTokenRegistered, {});
    return token;
  } catch (e) {
    if (__DEV__) {
      console.warn('[Push] Failed to get Expo push token:', e);
    }
    return null;
  }
}

export type NotificationResponse = {
  notification: Notifications.Notification;
  actionIdentifier: string;
};

/**
 * Subscribe to push token updates (e.g. when FCM rolls the token).
 * Use this to re-send the new token to your backend.
 */
export function addPushTokenListener(
  listener: (token: Notifications.ExpoPushToken) => void
): Notifications.EventSubscription {
  return Notifications.addPushTokenListener(listener);
}

/**
 * Subscribe to incoming notifications (when app is foregrounded or backgrounded).
 */
export function addNotificationReceivedListener(
  listener: (notification: Notifications.Notification) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener(listener);
}

/**
 * Subscribe to user interaction with a notification (e.g. tap).
 * Use for deep linking or in-app navigation.
 */
export function addNotificationResponseListener(
  listener: (response: Notifications.NotificationResponse) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(listener);
}
