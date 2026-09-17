import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createReader } from '../src/reader.js';
import { readSeason } from '../src/season.js';

const season = await readSeason(createReader().rpc);
const serialized = JSON.stringify(season, null, 2) + '\n';
const index = process.argv.indexOf('--output');
if (index !== -1) {
  const path = process.argv[index + 1];
  if (!path || path.startsWith('--')) throw new Error('--output requires a file path.');
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, serialized);
}
console.log(serialized);
