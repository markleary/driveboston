/**
 * World data pipeline. Usage:
 *   node tools/geo.ts --box backbay [--step fetch|build|all] [--force]
 * Downloads go to data/raw/<box>/ (ignored); outputs go to public/data/ and
 * docs/reports/ (committed).
 */
import { getBox } from './boxes.ts';
import { fetchBox } from './fetch.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const box = getBox(arg('box', 'backbay'));
  const step = arg('step', 'all');
  const force = process.argv.includes('--force');
  const t0 = performance.now();
  if (step === 'fetch' || step === 'all') {
    await fetchBox(box, force);
  }
  if (step === 'build' || step === 'all') {
    const { buildBox } = await import('./build.ts');
    await buildBox(box);
  }
  console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
