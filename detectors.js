/**
 * detectors.js
 * Tier 1 — deterministic pattern-based secret detection.
 * No network calls, no LLM. Pure regex + a couple of checksum/entropy checks.
 *
 * Exposes: scanText(text) -> Array<Finding>
 * Finding: { type, match, index, redacted }
 */

// Each rule: id, label, regex (global), optional validate(match) -> bool
const RULES = [
  {
    id: 'aws_access_key',
    label: 'AWS Access Key ID',
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g
  },
  {
    id: 'aws_secret_key',
    label: 'AWS Secret Access Key (heuristic)',
    // 40-char base64-ish string near the word "secret" — flagged with lower confidence
    regex: /\b[0-9a-zA-Z/+]{40}\b/g,
    contextHint: /aws|secret/i // only flagged if this appears within 60 chars
  },
  {
    id: 'openai_key',
    label: 'OpenAI API Key',
    regex: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/g
  },
  {
    id: 'anthropic_key',
    label: 'Anthropic API Key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    id: 'github_pat',
    label: 'GitHub Personal Access Token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g
  },
  {
    id: 'github_fine_grained',
    label: 'GitHub Fine-Grained Token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g
  },
  {
    id: 'slack_token',
    label: 'Slack Token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
  },
  {
    id: 'google_api_key',
    label: 'Google API Key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g
  },
  {
    id: 'stripe_key',
    label: 'Stripe API Key',
    regex: /\b(sk|pk|rk)_(live|test)_[0-9a-zA-Z]{20,}\b/g
  },
  {
    id: 'private_key_block',
    label: 'Private Key Block',
    regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]+?-----END \1?PRIVATE KEY-----/g
  },
  {
    id: 'jwt',
    label: 'JWT Token',
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
  },
  {
    id: 'generic_bearer',
    label: 'Bearer Token in Header',
    regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g
  },
  {
    id: 'db_conn_string',
    label: 'Database Connection String',
    regex: /\b(postgres|postgresql|mysql|mongodb(\+srv)?):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/g
  },
  {
    id: 'credit_card',
    label: 'Credit Card Number',
    regex: /\b(?:\d[ -]*?){13,16}\b/g,
    validate: (m) => luhnCheck(m.replace(/[ -]/g, ''))
  },
  {
    id: 'ssh_ed25519_private',
    label: 'SSH Private Key (OpenSSH format)',
    regex: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]+?-----END OPENSSH PRIVATE KEY-----/g
  },
  {
    id: 'generic_env_secret',
    label: 'Assigned Secret in .env-style line',
    // KEY=value or KEY: value where KEY name suggests a secret, value looks non-trivial
    regex: /\b([A-Z0-9_]*(SECRET|API[_-]?KEY|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi,
    captureGroupForMatch: 0
  }
];

function luhnCheck(numStr) {
  let sum = 0;
  let alt = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let n = parseInt(numStr[i], 10);
    if (isNaN(n)) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0 && numStr.length >= 13;
}

function redact(match) {
  if (match.length <= 8) return '*'.repeat(match.length);
  return match.slice(0, 4) + '...' + match.slice(-4) + ` [REDACTED:${match.length}ch]`;
}

/**
 * Scan a block of text for known secret patterns.
 * @param {string} text
 * @returns {Array<{id: string, label: string, match: string, redacted: string, index: number}>}
 */
function scanText(text) {
  if (!text || typeof text !== 'string') return [];

  const findings = [];
  const seen = new Set(); // avoid duplicate reports for overlapping rules

  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    let m;
    while ((m = rule.regex.exec(text)) !== null) {
      const matched = m[0];

      // context hint rules only fire if a nearby keyword is present
      if (rule.contextHint) {
        const windowStart = Math.max(0, m.index - 60);
        const windowEnd = Math.min(text.length, m.index + matched.length + 60);
        const context = text.slice(windowStart, windowEnd);
        if (!rule.contextHint.test(context)) continue;
      }

      if (rule.validate && !rule.validate(matched)) continue;

      const key = `${rule.id}:${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);

      findings.push({
        id: rule.id,
        label: rule.label,
        match: matched,
        redacted: redact(matched),
        index: m.index
      });

      // guard against zero-length infinite loops
      if (m[0].length === 0) rule.regex.lastIndex++;
    }
  }

  // sort by position in text
  findings.sort((a, b) => a.index - b.index);
  return findings;
}

/**
 * Convenience: returns true/false plus the findings, for quick gating.
 */
function hasLeak(text) {
  const findings = scanText(text);
  return { leak: findings.length > 0, findings };
}

/**
 * Produces a redacted version of the text with all findings replaced.
 */
function redactText(text) {
  const findings = scanText(text);
  if (findings.length === 0) return text;

  let result = text;
  // replace from the end so indices don't shift
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    const placeholder = `[REDACTED_${f.id.toUpperCase()}]`;
    result = result.slice(0, f.index) + placeholder + result.slice(f.index + f.match.length);
  }
  return result;
}

// Export for both browser extension context (window) and Node (module.exports / testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scanText, hasLeak, redactText, RULES };
}
if (typeof window !== 'undefined') {
  window.LLMGuardDetectors = { scanText, hasLeak, redactText, RULES };
}
