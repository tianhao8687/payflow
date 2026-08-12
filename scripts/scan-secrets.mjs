import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const candidateFiles = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);

const trackedFiles = candidateFiles;

const patterns = [
  {
    label: 'Stripe API key',
    value: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    label: 'Stripe webhook signing secret',
    value: /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  },
];

const findings = [];

for (const file of trackedFiles) {
  if (!existsSync(file)) {
    continue;
  }

  const content = readFileSync(file);
  if (content.includes(0)) {
    continue;
  }

  const text = content.toString('utf8');
  for (const pattern of patterns) {
    pattern.value.lastIndex = 0;
    for (const match of text.matchAll(pattern.value)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line} (${pattern.label})`);
    }
  }
}

if (findings.length > 0) {
  console.error('Potential committed payment secret detected:');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log('No Stripe secrets found in tracked or untracked source files.');
}
