#!/usr/bin/env node
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createReader } from '../src/reader.js';
import { readRevealState } from '../src/reveal.js';
import { createAssetCollector } from '../src/asset-collector.js';

export function parseCollectorArgs(argv) {
  let dataDir = null;
  let once = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--data-dir') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('Use --data-dir PATH.');
      dataDir = resolve(value);
    } else if (arg === '--once') once = true;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`Unknown collector argument: ${arg}`);
  }
  if (!dataDir) throw new Error('A persistent directory is required: --data-dir PATH.');
  return { dataDir, once };
}

export async function main(argv = process.argv.slice(2), { rpc, fetchImpl, now } = {}) {
  const options = parseCollectorArgs(argv);
  if (options.help) {
    process.stdout.write('Usage: node tools/collect-assets.mjs --data-dir PATH [--once]\n');
    return 0;
  }
  const reader = rpc ? null : createReader();
  const readOnlyRpc = rpc ?? reader.rpc;
  const collector = createAssetCollector({
    dataDir: options.dataDir,
    readRevealState: () => readRevealState(readOnlyRpc),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(now ? { now } : {})
  });

  if (options.once) {
    const result = await collector.runOnce();
    if (result.error) process.stderr.write(`Collector: ${result.error}\n`);
    return 0;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await collector.run({ signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
  return 0;
}

const isDirect = process.argv[1]
  && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
if (isDirect) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`Collector failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
