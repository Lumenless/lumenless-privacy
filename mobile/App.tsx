import 'react-native-get-random-values'; // Must be first for crypto polyfill
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import PayLinksScreen from './src/screens/PayLinksScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <PayLinksScreen />
    </SafeAreaProvider>
  );
}
