# Firebase & Push Notifications

## Firebase Analytics

The app uses **React Native Firebase** (`@react-native-firebase/app`, `@react-native-firebase/analytics`) for native Analytics. Events (screen views, wallet connect, withdraw, deposit, create invoice, etc.) are logged to Firebase.

- **Android**: Uses `google-services.json` (already configured).
- **iOS**: Uses `GoogleService-Info.plist`. A placeholder plist is included for prebuild. Before building for iOS, add an iOS app in [Firebase Console](https://console.firebase.google.com) with bundle ID `com.lumenless`, download the real `GoogleService-Info.plist`, and replace the file in the project root.

### DebugView (Android)

To see events in Firebase Console → Analytics → DebugView when running debug builds:

```bash
adb shell setprop debug.firebase.analytics.app com.lumenless
```

---

# Push Notifications (Firebase / FCM)

Push is integrated with **Expo Notifications** and uses **Firebase Cloud Messaging (FCM)** on Android.

## What’s done

- `expo-notifications`, `expo-device`, `expo-constants` installed
- `app.json`: `expo-notifications` plugin and `android.googleServicesFile` pointing to `./google-services.json`
- `google-services.json` in the project root (from Firebase Console)
- App requests permission and gets an **Expo push token** after onboarding
- Foreground/background and tap listeners are registered

## Requirements

1. **Physical device** – Push does not work on emulators/simulators.
2. **Development build** – On Android, push is **not** available in Expo Go from SDK 53+. Use a dev build:
   - `npx expo run:android` (local), or
   - `eas build --profile development` (EAS).

## EAS projectId

The Expo push token is tied to an **EAS project ID**. It is set automatically when you build with EAS. For local builds, you can set it in `app.json`:

```json
"extra": {
  "eas": {
    "projectId": "your-eas-project-uuid"
  }
}
```

Get the ID from [expo.dev](https://expo.dev) → your project → Settings, or after running `eas build` once.

## FCM credentials (sending from Expo Push Service)

To **send** notifications via Expo’s push service (which uses FCM on Android):

1. In Firebase Console → Project settings → **Service accounts**, generate a new **private key** (JSON).
2. Upload that JSON to EAS:
   - Run `eas credentials`
   - Choose **Android** → **production** (or your profile) → **Google Service Account**
   - Choose **Set up FCM V1** → **Upload a new service account key**
3. Add the JSON file to `.gitignore` (it’s secret).

After that, you can send notifications using the [Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/) with the **Expo push token** (the app logs it in dev when registration succeeds).

## Sending a test notification

1. Run the app on a **physical device** (dev build).
2. Complete onboarding so the app registers for push and logs the token (or read it from the device log).
3. Use [Expo’s push tool](https://expo.dev/notifications): paste the Expo push token and send a test message.

## Backend: storing the token

To send pushes from your own backend, store the Expo push token when the app gets it. In `App.tsx`, after `registerForPushNotificationsAsync()` resolves with a token, send it to your API (e.g. `POST /api/users/me/push-token`). Then use the [Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format) to send messages to that token.

## Deep linking

When the user **taps** a notification, `addNotificationResponseListener` runs. You can put a `url` (or other data) in the push payload’s `data` and navigate there in the listener (e.g. with React Navigation’s linking or `router.push(url)` if using Expo Router).
