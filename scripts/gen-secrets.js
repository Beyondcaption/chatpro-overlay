// Build-time secret injection. Writes src/secrets.js from environment variables
// so the real keys never live in source control or the git history.
// Runs automatically via the prebuild/prestart npm hooks. For the Mac CI build the
// values come from GitHub repo secrets (see .github/workflows/build.yml).
const fs = require('fs');
const path = require('path');

// Knowledge-base rule (060326): values that end up in HTTP headers must be
// printable-ASCII only, or fetch throws on a stray non-Latin1 char.
const ascii = (s) => (s || '').replace(/[^\x21-\x7E]/g, '');

const secretsPath = path.join(__dirname, '..', 'src', 'secrets.js');

// Fall back to whatever src/secrets.js already holds when a var is missing from the
// env. A local `npm run build:win` without the vars exported used to overwrite both
// keys with "" -- the installer then looked fine but every chatter-log POST it sent
// was rejected 403, silently, for as long as that build stayed installed.
let prev = {};
try { prev = require(secretsPath); } catch (e) { /* first build, no file yet */ }

const RULES_KEY = ascii(process.env.RULES_KEY) || ascii(prev.RULES_KEY);
const OPS_LOG_KEY = ascii(process.env.OPS_LOG_KEY) || ascii(prev.OPS_LOG_KEY);

// Hard stop rather than a warning: a build that ships blank keys is worse than no
// build at all, because the breakage only surfaces as missing data days later.
if (!RULES_KEY || !OPS_LOG_KEY) {
  console.error('[gen-secrets] FATAL: '
    + (!RULES_KEY ? 'RULES_KEY ' : '') + (!OPS_LOG_KEY ? 'OPS_LOG_KEY ' : '')
    + 'unresolved -- not in env and not in src/secrets.js.\n'
    + 'Export the missing var(s) and re-run, e.g.:\n'
    + '  $env:OPS_LOG_KEY = "..."; npm run build:win');
  process.exit(1);
}

const out = `// AUTO-GENERATED at build time by scripts/gen-secrets.js — DO NOT COMMIT, DO NOT EDIT.
// Injected from the RULES_KEY / OPS_LOG_KEY environment variables. This file is gitignored.
module.exports = {
  RULES_KEY: ${JSON.stringify(RULES_KEY)},
  OPS_LOG_KEY: ${JSON.stringify(OPS_LOG_KEY)},
};
`;

fs.writeFileSync(secretsPath, out);
const src = (envVal) => (ascii(envVal) ? 'env' : 'kept from secrets.js');
console.log('[gen-secrets] wrote src/secrets.js (RULES_KEY: ' + src(process.env.RULES_KEY)
  + ', OPS_LOG_KEY: ' + src(process.env.OPS_LOG_KEY) + ')');
