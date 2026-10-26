#!/usr/bin/env node
// Refuses commits and CI runs when a tracked text file contains something that
// must never be published: an API key, a secret assignment, an em dash, or the
// names of the projects this one took inspiration from (encoded here so this
// file does not name them either). Usage:
//   node tools/check-forbidden.mjs            # every tracked file
//   node tools/check-forbidden.mjs --staged   # files staged for commit
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const encodedNames = ['c2xvcC1zYW5mcmFuY2lzY28=', 'c2xvcC1uZXd5b3Jr', 'c2xvcC1zYW4gZnJhbmNpc2Nv', 'c2xvcCBuZXcgeW9ya18='];
const forbiddenNames = encodedNames.map((b) => Buffer.from(b, 'base64').toString('utf8').replace(/_$/, ''));

const rules = [
  { name: 'em dash (use a hyphen or restructure)', test: (text) => text.includes(String.fromCharCode(0x2014)) },
  { name: 'ElevenLabs style API key', test: (text) => /\bsk_[0-9a-f]{24,}\b/i.test(text) },
  { name: 'secret assignment with a literal value', test: (text) => /(api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i.test(text) },
  { name: 'reference project name', test: (text) => forbiddenNames.some((n) => text.toLowerCase().includes(n)) },
];

const binaryExt = /\.(png|jpe?g|webp|gif|ico|mp3|ogg|wav|bin|gz|zip|woff2?|ttf|pdf|tif|tiff|laz|las)$/i;
const staged = process.argv.includes('--staged');
const listCmd = staged ? 'git diff --cached --name-only --diff-filter=ACMR' : 'git ls-files';
const files = execSync(listCmd, { encoding: 'utf8' }).split('\n').filter(Boolean);

let failures = 0;
for (const file of files) {
  if (binaryExt.test(file) || file === 'package-lock.json') continue;
  let text;
  try {
    text = staged ? execSync(`git show :${JSON.stringify(file)}`, { encoding: 'utf8' }) : readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const rule of rules) {
    if (rule.test(text)) {
      failures += 1;
      console.error(`forbidden: ${file}: ${rule.name}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} problem(s) found; nothing was committed.`);
  process.exit(1);
}
console.log(`check-forbidden: ${files.length} files clean`);
