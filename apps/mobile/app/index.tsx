import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { runParityCheck, type ParityReport } from '@qmail/crypto';
import { colors, space } from '../theme/colors';
import { installCrypto, probeCapabilities, type CryptoCapabilities } from '../lib/crypto-setup';

/**
 * Phase 1: prove the shared crypto module runs under Hermes and produces the
 * same digest as the Node and browser runs. Real screens arrive in Phase 5.
 */
export default function Parity() {
  const [caps, setCaps] = useState<CryptoCapabilities | null>(null);
  const [report, setReport] = useState<ParityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const capabilities = probeCapabilities();

    (async () => {
      try {
        capabilities.provider = installCrypto();
        if (!cancelled) setCaps({ ...capabilities });
        const result = await runParityCheck('mobile (android)');

        // Also logged so the digest can be read straight out of logcat and
        // compared with the Node and browser runs without squinting at a screen.
        console.log(`QMAIL_PARITY digest=${result.digest} passed=${result.passed}`);
        for (const check of result.checks) {
          if (!check.passed) {
            console.log(`QMAIL_PARITY FAIL ${check.name}: ${check.detail ?? ''}`);
          }
        }

        if (!cancelled) setReport(result);
      } catch (cause) {
        const detail = cause instanceof Error ? `${cause.message}\n\n${cause.stack ?? ''}` : String(cause);
        console.log(`QMAIL_PARITY ERROR ${detail}`);
        console.log(
          `QMAIL_PARITY CAPS crypto=${capabilities.hasGlobalCrypto} random=${capabilities.hasGetRandomValues} subtle=${capabilities.hasSubtle} wasm=${capabilities.hasWebAssembly} wasmValid=${capabilities.wasmCanInstantiate}`,
        );
        if (!cancelled) {
          setCaps({ ...capabilities });
          setError(detail);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Crypto parity check</Text>

      {caps ? (
        <View style={styles.caps}>
          <Capability label="globalThis.crypto" ok={caps.hasGlobalCrypto} />
          <Capability label="getRandomValues" ok={caps.hasGetRandomValues} />
          <Capability label="crypto.subtle" ok={caps.hasSubtle} />
          <Capability label="WebAssembly" ok={caps.hasWebAssembly} />
          <Capability label="WASM validate" ok={caps.wasmCanInstantiate} />
          <Text style={styles.meta}>provider: {caps.provider}</Text>
          {caps.notes.map((note) => (
            <Text key={note} style={styles.note}>
              {note}
            </Text>
          ))}
        </View>
      ) : null}

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

          <Text style={report.passed ? styles.verdictPass : styles.verdictFail}>
            {report.passed
              ? 'All checks passed. Compare the digest against the other platforms.'
              : 'This platform does not match. The failing checks are listed above.'}
          </Text>
        </>
      ) : error ? null : (
        <Text style={styles.meta}>Running…</Text>
      )}
    </ScrollView>
  );
}

function Capability({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={ok ? styles.pass : styles.fail}>{ok ? 'yes' : 'no'}</Text>
      <Text style={styles.name}>{label}</Text>
    </View>
  );
}

const mono = 'monospace';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { padding: space.s5, paddingTop: space.s8, paddingBottom: space.s8 },
  title: { color: colors.paper, fontSize: 22, fontWeight: '600', marginBottom: space.s2 },
  meta: { color: colors.paperFaint, fontSize: 13, marginBottom: space.s4 },
  note: { color: colors.stateFailed, fontSize: 12, fontFamily: mono, marginBottom: space.s1 },
  caps: {
    marginBottom: space.s5,
    paddingBottom: space.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.inkLine,
  },
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
  error: { color: colors.stateFailed, fontFamily: mono, fontSize: 11, marginBottom: space.s4 },
  verdictPass: { color: colors.stateVerified, fontSize: 14, marginTop: space.s4 },
  verdictFail: { color: colors.stateFailed, fontSize: 14, marginTop: space.s4 },
});
