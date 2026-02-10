import 'react-native-gesture-handler'; // Must be imported early for React Navigation
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { hasMintedLumenId, setLumenIdMinted, setOnboardingCompleted } from './src/services/onboarding';

export default function App() {
  const [hasMinted, setHasMinted] = useState<boolean | null>(null);

  useEffect(() => {
    hasMintedLumenId().then(setHasMinted);
  }, []);

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
