// Build-time secret injection. Writes src/secrets.js from environment variables
// so the real keys never live in source control or the git history.
// Runs automatically via the prebuild/prestart npm hooks. For the Mac CI build the
// values come from GitHub repo secrets (see .github/workflows/build.yml).
const fs = require('fs');
const path = require('path');

// Knowledge-base rule (060326): values that end up in HTTP headers must be
// printable-ASCII only, or fetch throws on a stray non-Latin1 char.
const ascii = (s) => (s || '').replace(/[^\x21-\x7E]/g, '');

const RULES_KEY = ascii(process.env.RULES_KEY);
const OPS_LOG_KEY = ascii(process.env.OPS_LOG_KEY);

if (!RULES_KEY || !OPS_LOG_KEY) {
  console.warn('[gen-secrets] WARN: RULES_KEY and/or OPS_LOG_KEY not set in env — '
    + 'writing empty value(s). The build will run but the affected feature stays inert.');
}

const out = `// AUTO-GENERATED at build time by scripts/gen-secrets.js — DO NOT COMMIT, DO NOT EDIT.
// Injected from the RULES_KEY / OPS_LOG_KEY environment variables. This file is gitignored.
module.exports = {
  RULES_KEY: ${JSON.stringify(RULES_KEY)},
  OPS_LOG_KEY: ${JSON.stringify(OPS_LOG_KEY)},
};
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'secrets.js'), out);
console.log('[gen-secrets] wrote src/secrets.js (RULES_KEY: ' + (RULES_KEY ? 'set' : 'EMPTY')
  + ', OPS_LOG_KEY: ' + (OPS_LOG_KEY ? 'set' : 'EMPTY') + ')');
