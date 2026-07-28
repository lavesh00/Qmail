/**
 * Runs the cross-platform parity check under Node.
 *
 * The digest this prints is the reference the browser and React Native runs are
 * compared against.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { releasePqc, runParityCheck } from '../dist/index.js';

test.after(async () => {
  await releasePqc();
});

test('the parity check passes under Node', async () => {
  const report = await runParityCheck('node');

  for (const check of report.checks) {
    assert.equal(check.passed, true, `${check.name}: ${check.detail ?? 'failed'}`);
  }
  assert.equal(report.passed, true);

  console.log(`\n  parity digest (node): ${report.digest}`);
  console.log(`  checks: ${report.checks.length}, elapsed: ${report.elapsedMs} ms\n`);
});
