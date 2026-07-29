import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { CryptoHost } from '../lib/webview-engine';
import { SessionProvider } from '../state/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/*
        Mounted above everything: every screen that touches mail needs the
        crypto engine, and the WebView takes a moment to come up. It renders
        nothing visible.
      */}
      <CryptoHost />
      <SessionProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.ink },
          }}
        />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
