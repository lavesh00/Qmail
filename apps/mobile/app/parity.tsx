import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { ParityReport } from '@qmail/crypto';
import { createWebViewEngine } from '../lib/webview-engine';
import { Icon } from '../ui/Icon';
import { colors, space } from '../theme/colors';

/**
 * Diagnostics: runs the shared crypto module's parity check through the WebView
 * bridge and prints the digest.
 *
 * This screen is the evidence for the whole mobile approach. Hermes cannot host
 * the cryptography, so it runs in a WebView instead — and the only thing that
 * distinguishes "same module, different execution context" from "quietly
 * different cryptography" is whether this digest matches the one Node and the
 * browser produce.
 */
export default function Parity() {
  const [report, setReport] = useState<ParityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const engine = createWebViewEngine();

    (async () => {
      try {
        const result = await engine.parityCheck('mobile (android, webview bridge)');
        console.log(`QMAIL_PARITY digest=${result.digest} passed=${result.passed}`);
        if (!cancelled) setReport(result);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        console.log(`QMAIL_PARITY ERROR ${detail}`);
        if (!cancelled) setError(detail);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={10}>
        <Icon name="back" size={20} color={colors.paperFaint} />
      </Pressable>

      <Text style={styles.title}>Crypto parity check</Text>
      <Text style={styles.meta}>
        Cryptography runs in a WebView, because React Native's engine provides neither WebAssembly
        nor WebCrypto. This digest must match the Node and browser runs.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {report ? (
        <>
          <Text style={styles.meta}>
            {report.platform} · {report.checks.length} checks · {report.elapsedMs} ms
          </Text>

          <View style={styles.digest}>
            <Text style={styles.digestLabel}>DIGEST</Text>
            <Text style={styles.digestValue}>{report.digest}</Text>
          </View>

          {report.checks.map((check) => (
            <View key={check.name} style={styles.row}>
              <Text style={check.passed ? styles.pass : styles.fail}>
                {check.passed ? 'pass' : 'fail'}
              </Text>
              <View style={styles.rowBody}>
                <Text style={styles.name}>{check.name}</Text>
                {check.detail ? <Text style={styles.detail}>{check.detail}</Text> : null}
              </View>
            </View>
          ))}
        </>
      ) : error ? null : (
        <Text style={styles.meta}>Starting the crypto bridge…</Text>
      )}
    </ScrollView>
  );
}

const mono = 'monospace';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { padding: space.s5, paddingTop: space.s7, paddingBottom: space.s8 },
  back: { marginBottom: space.s4 },
  title: { color: colors.paper, fontSize: 22, fontWeight: '600', marginBottom: space.s2 },
  meta: { color: colors.paperFaint, fontSize: 13, marginBottom: space.s4, lineHeight: 19 },
  digest: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: space.s4,
    marginBottom: space.s5,
  },
  digestLabel: { color: colors.paperFaint, fontSize: 11, letterSpacing: 1, marginBottom: space.s1 },
  digestValue: { color: colors.paper, fontFamily: mono, fontSize: 12 },
  row: { flexDirection: 'row', gap: space.s3, paddingVertical: space.s2 },
  rowBody: { flex: 1 },
  pass: { color: colors.stateVerified, fontFamily: mono, fontSize: 11, width: 34, paddingTop: 3 },
  fail: { color: colors.stateFailed, fontFamily: mono, fontSize: 11, width: 34, paddingTop: 3 },
  name: { color: colors.paperDim, fontSize: 14, flex: 1 },
  detail: { color: colors.stateFailed, fontFamily: mono, fontSize: 11, marginTop: space.s1 },
  error: { color: colors.stateFailed, fontFamily: mono, fontSize: 12, marginBottom: space.s4 },
});
