import ParityPanel from './dev/ParityPanel';

/**
 * Phase 1: the app's only job so far is to prove the shared crypto module runs
 * in a browser and produces byte-identical results to the Node run. Real
 * screens arrive in Phase 3.
 */
export default function App() {
  return <ParityPanel />;
}
