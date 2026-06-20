// Template documenting the shape of src/secrets.js.
// You do NOT edit secrets.js by hand — it is gitignored and generated at build time
// by scripts/gen-secrets.js from the RULES_KEY / OPS_LOG_KEY environment variables.
// This example file is the only secrets-related file that is committed.
module.exports = {
  RULES_KEY: '',    // x-rules-key header for chatpro-ops /api/training/rules/active
  OPS_LOG_KEY: '',  // key for the chatpro-ops logging endpoint
};
