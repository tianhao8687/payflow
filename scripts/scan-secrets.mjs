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
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

// These files contain deliberate local-only placeholders used by deterministic
// tests or documented sandbox startup. Keep this list exact: adding a directory
// or glob would make it too easy to hide a real credential.
const fixtureAllowlist = new Set([
  '.env.example',
  '.github/workflows/ci.yml',
  'apps/api/.env.example',
  'apps/api/src/config/environment.spec.ts',
  'apps/api/test/setup-env.ts',
  'apps/worker/.env.example',
  'docker-compose.yml',
  'packages/database/prisma.config.ts',
  'packages/observability/src/observability.spec.ts',
  'scripts/scan-secrets.mjs',
  'scripts/testing/load.mjs',
]);

const patterns = [
  {
    label: 'Stripe API key',
    value: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    label: 'Stripe webhook signing secret',
    value: /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  },
  {
    label: 'private key material',
    value: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    label: 'PayPal client secret',
    value:
      /\bPAYPAL_CLIENT_SECRET\b\s*[:=]\s*["']?(?=[A-Za-z0-9_./+=-]{16,})(?=[A-Za-z0-9_./+=-]*[0-9_./+=-])[A-Za-z0-9_./+=-]+/g,
  },
  {
    label: 'JWT signing secret',
    value: /\bJWT_SECRET\b\s*[:=]\s*["']?[^\s"'#,{]{24,}/g,
  },
  {
    label: 'Alipay private key value',
    value: /\bALIPAY_(?:APP_)?PRIVATE_KEY\b\s*[:=]\s*["']?[A-Za-z0-9+/=]{64,}/g,
  },
  {
    label: 'database URL with plaintext credentials',
    value: /\b(?:postgres|postgresql):\/\/[^\s:@/"']+:[^\s@/"']+@[^\s"']+/g,
  },
];

const privateKeyFile = /\.(?:key|p12|pfx|pem)$/i;
const findings = [];

for (const file of candidateFiles) {
  if (!existsSync(file) || fixtureAllowlist.has(file)) {
    continue;
  }

  if (privateKeyFile.test(file)) {
    findings.push(`${file}:1 (private key or certificate bundle file)`);
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
  console.error('Potential committed secret or private-key file detected:');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    'No payment credentials, signing secrets, private keys, or plaintext database credentials found.',
  );
}
