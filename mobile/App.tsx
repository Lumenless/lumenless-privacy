import 'react-native-gesture-handler'; // Must be imported early for React Navigation
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { hasCompletedOnboarding, setOnboardingCompleted } from './src/services/onboarding';

export default function App() {
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    hasCompletedOnboarding().then(setHasSeenOnboarding);
  }, []);

  const handleOnboardingComplete = () => {
    setOnboardingCompleted().then(() => setHasSeenOnboarding(true));
  };

  if (hasSeenOnboarding === null) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!hasSeenOnboarding) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <OnboardingScreen onComplete={handleOnboardingComplete} />
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
