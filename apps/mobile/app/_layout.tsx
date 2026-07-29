import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../theme/colors';
import { CryptoHost } from '../lib/webview-engine';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      {/*
        Mounted above everything, because every screen that touches mail needs
        the crypto engine and it takes a moment to come up. It renders nothing.
      */}
      <CryptoHost />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.ink },
        }}
      />
    </>
  );
}
