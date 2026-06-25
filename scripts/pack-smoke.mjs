import { execFileSync } from 'node:child_process';

const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf-8' });
const json = out.match(/(\[\s*\{[\s\S]*\])\s*$/)?.[1];
if (!json) {
  console.error(out);
  throw new Error('Could not find npm pack JSON output');
}
const [pack] = JSON.parse(json);
const files = new Set(pack.files.map((file) => file.path));

const required = [
  'package.json',
  'dist/daemon.mjs',
  'scripts/daemon.sh',
  'scripts/doctor.sh',
  'config.env.example',
  'SKILL.md',
  'README.md',
  'README_CN.md',
];

const missing = required.filter((file) => !files.has(file));
const forbidden = pack.files
  .map((file) => file.path)
  .filter((file) => (
    file.startsWith('node_modules/')
    || file.startsWith('coverage/')
    || file.includes('/__tests__/')
  ));

if (missing.length > 0 || forbidden.length > 0) {
  console.error(JSON.stringify({ missing, forbidden }, null, 2));
  process.exit(1);
}

console.log(`pack smoke ok: ${pack.entryCount} files, ${pack.filename}`);
