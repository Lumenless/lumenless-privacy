import { StyleSheet, View } from 'react-native';
import { Logo } from '../components';

export default function LumenScreen() {
  return (
    <View style={styles.container}>
      <Logo size={120} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
