import { useEffect, useState } from 'react';
import { runParityCheck, type ParityReport } from '@qmail/crypto';
import './parity.css';

/**
 * Runs the shared crypto module's parity check in the browser and prints the
 * digest, so it can be compared against the Node and React Native runs.
 *
 * This is a diagnostics surface, not a product screen — it is the evidence that
 * one crypto implementation really is being shared, rather than three that
 * happen to agree today.
 */
export default function ParityPanel() {
  const [report, setReport] = useState<ParityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    runParityCheck(`web (${navigator.userAgent.includes('Firefox') ? 'firefox' : 'chromium'})`)
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="parity">
        <h1 className="parity__title">Crypto parity check</h1>
        <p className="parity__failed">{error}</p>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="parity">
        <h1 className="parity__title">Crypto parity check</h1>
        <p className="parity__pending">Running…</p>
      </section>
    );
  }

  return (
    <section className="parity">
      <h1 className="parity__title">Crypto parity check</h1>
      <p className="parity__meta">
        {report.platform} · {report.checks.length} checks · {report.elapsedMs} ms
      </p>

      <dl className="parity__digest">
        <dt>Digest</dt>
        <dd>{report.digest}</dd>
      </dl>

      <ul className="parity__list">
        {report.checks.map((check) => (
          <li key={check.name} className="parity__item">
            <span className={check.passed ? 'parity__state--pass' : 'parity__state--fail'}>
              {check.passed ? 'pass' : 'fail'}
            </span>
            <span className="parity__name">{check.name}</span>
            {check.detail ? <span className="parity__detail">{check.detail}</span> : null}
          </li>
        ))}
      </ul>

      <p className={report.passed ? 'parity__verdict--pass' : 'parity__verdict--fail'}>
        {report.passed
          ? 'All checks passed. Compare the digest against the other platforms.'
          : 'This platform does not match. The failing checks are listed above.'}
      </p>
    </section>
  );
}
