import 'react-native-gesture-handler'; // Must be imported early for React Navigation
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState, useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { initFirebase, initCrashlytics, crashLog } from './src/services/firebase';
import { hasMintedLumenId, setLumenIdMinted, setOnboardingCompleted } from './src/services/onboarding';
import {
  setNotificationHandler,
  registerForPushNotificationsAsync,
  addNotificationReceivedListener,
  addNotificationResponseListener,
} from './src/services/pushNotifications';

initFirebase();
initCrashlytics();
setNotificationHandler();

export default function App() {
  const [hasMinted, setHasMinted] = useState<boolean | null>(null);
  const pushListenersRef = useRef<boolean>(false);

  useEffect(() => {
    crashLog('App mounted, checking onboarding state');
    hasMintedLumenId().then(setHasMinted);
  }, []);

  // Register for push notifications and set up listeners once user is past onboarding
  useEffect(() => {
    if (hasMinted !== true || pushListenersRef.current) return;
    pushListenersRef.current = true;

    registerForPushNotificationsAsync().then((token) => {
      if (token && __DEV__) {
        console.log('[App] Push token ready, send to backend if needed:', token);
      }
    });

    const received = addNotificationReceivedListener((notification) => {
      if (__DEV__) {
        console.log('[App] Notification received:', notification.request.content);
      }
    });
    const response = addNotificationResponseListener((response) => {
      if (__DEV__) {
        console.log('[App] Notification tapped:', response.notification.request.content.data);
      }
      // Optional: use response.notification.request.content.data?.url for deep linking
    });

    return () => {
      received.remove();
      response.remove();
    };
  }, [hasMinted]);

  const handleMintSuccess = () => {
    setOnboardingCompleted().then(() => {});
    setLumenIdMinted().then(() => setHasMinted(true));
  };

  if (hasMinted === null) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!hasMinted) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <OnboardingScreen onSuccess={handleMintSuccess} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#5b21b6',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
