const { scanText, redactText } = require('./detectors.js');

const cases = [
  ['AWS key', 'my key is AKIAIOSFODNN7EXAMPLE and thats it'],
  ['OpenAI key', 'use this: sk-proj-abcdefghijklmnopqrstuvwxyz123456'],
  ['Anthropic key', 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
  ['GitHub PAT', 'token: ghp_1234567890abcdefghijklmnopqrstuvwxyz'],
  ['Slack token', 'xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx'],
  ['Google API key', 'AIzaSyD1234567890abcdefghijklmnopqrstuv'],
  ['Stripe key', 'sk_live_51H1234567890abcdefghijklmnop'],
  ['Private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----'],
  ['JWT', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ['DB conn string', 'DATABASE_URL=postgresql://admin:sup3rSecret@db.internal.company.com:5432/prod'],
  ['Credit card (valid Luhn)', 'card number 4532015112830366 please charge it'],
  ['Generic env secret', 'STRIPE_SECRET_KEY = "abcd1234efgh5678"'],
  ['Clean text (no leak)', 'Hey team, can we push the meeting to 3pm tomorrow?'],
  ['Clean code snippet', 'function add(a, b) { return a + b; }'],
  ['Combined all-secrets blob', 'AWS: AKIAIOSFODNN7EXAMPLE OpenAI: sk-proj-abcdefghijklmnopqrstuvwxyz123456 Anthropic: sk-ant-api03-abcdefghijklmnopqrstuvwxyz GitHub: ghp_1234567890abcdefghijklmnopqrstuvwxyz Slack: xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx Google: AIzaSyD1234567890abcdefghijklmnopqrstuv Stripe: sk_live_51H1234567890abcdefghijklmnop JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U DB: postgresql://admin:sup3rSecret@db.internal.company.com:5432/prod Card: 4532015112830366 Env style: STRIPE_SECRET_KEY = "abcd1234efgh5678" Private key: -----BEGIN RSA PRIVATE KEY----- MIIEpAIBAAKCAQEA... -----END RSA PRIVATE KEY-----'],
  ['Clean control sentence', 'Hey team, can we push the meeting to 3pm tomorrow? Also can you review the PR before EOD.']
];

let pass = 0, fail = 0;
for (const [label, text] of cases) {
  const findings = scanText(text);
  const leaked = findings.length > 0;
  const expectedLeak = !label.toLowerCase().includes('clean');
  const ok = leaked === expectedLeak;
  ok ? pass++ : fail++;

  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (findings.length) {
    for (const f of findings) console.log(`    -> ${f.label}: ${f.redacted}`);
  }
  if (leaked) {
    console.log(`    redacted output: ${redactText(text).slice(0, 200)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed out of ${cases.length}`);
