import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSession } from '../state/session';
import { Auth, Unlock } from '../screens/Auth';
import { Mailbox } from '../screens/Mailbox';
import { colors } from '../theme/colors';

/**
 * Which surface is shown follows from session state, exactly as on web: signed
 * out, signed in but locked, or ready. There is no route that can put the app
 * in a state its keys do not support.
 */
export default function Index() {
  const { state } = useSession();

  if (state.status === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.status === 'locked') {
    return <Unlock address={state.address} />;
  }

  if (state.status === 'ready') {
    return <Mailbox account={state.account} />;
  }

  return <Auth />;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
});
