import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export default function Boot() {
  return (
    <View style={styles.screen}>
      <Text style={styles.wordmark}>Qmail</Text>
      <Text style={styles.note}>Scaffolding online. No cryptography wired up yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.ink,
  },
  wordmark: {
    color: colors.paper,
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  note: {
    color: colors.paperFaint,
    fontSize: 14,
  },
});
