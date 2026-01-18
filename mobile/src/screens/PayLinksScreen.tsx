import { StyleSheet, Text, View } from 'react-native';

export default function PayLinksScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>PAY LINKS</Text>
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
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
  },
});
