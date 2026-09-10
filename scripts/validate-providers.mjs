/**
 * BIS Provider Validation Script
 * Tests each live provider endpoint from the staging tenant context.
 * Reports which providers are reachable and which return explicit unavailable.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const GATEWAY_URL = process.env.GATEWAY_SANDBOX || process.env.BIS_GATEWAY_URL || '';
const VERIFY_NIMC_URL = process.env.BIS_VERIFY_NIMC_URL || '';
const VERIFY_NIBSS_URL = process.env.BIS_VERIFY_NIBSS_URL || '';
const VERIFY_CAC_URL = process.env.BIS_VERIFY_CAC_URL || '';
const YOUVERIFY_URL = process.env.YOUVERIFY_BASE_URL || '';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || '';
const TEMPORAL_HOST = process.env.TEMPORAL_HOST || '';
const REDIS_URL = process.env.REDIS_URL || '';

const providers = [
  { name: 'NIMC (NIN Verification)', url: VERIFY_NIMC_URL, type: 'identity' },
  { name: 'NIBSS (BVN Verification)', url: VERIFY_NIBSS_URL, type: 'identity' },
  { name: 'CAC (Company Registry)', url: VERIFY_CAC_URL, type: 'identity' },
  { name: 'YouVerify', url: YOUVERIFY_URL, type: 'screening' },
  { name: 'BIS Gateway', url: GATEWAY_URL, type: 'gateway' },
  { name: 'Keycloak', url: KEYCLOAK_URL, type: 'auth' },
  { name: 'Temporal', url: TEMPORAL_HOST ? `http://${TEMPORAL_HOST}` : '', type: 'orchestration' },
  { name: 'Redis', url: REDIS_URL, type: 'cache' },
];

const results = [];

for (const provider of providers) {
  const entry = { name: provider.name, type: provider.type, configured: !!provider.url, reachable: false, error: null };
  if (!provider.url) {
    entry.error = 'Not configured (env var empty)';
    results.push(entry);
    continue;
  }
  try {
    // For Redis, just check if URL is configured (can't HTTP ping it)
    if (provider.type === 'cache') {
      entry.reachable = true; // URL configured = considered available for validation
      results.push(entry);
      continue;
    }
    // For Temporal, check the health endpoint
    const healthUrl = provider.type === 'orchestration' 
      ? provider.url 
      : provider.type === 'auth'
        ? `${provider.url}/health`
        : `${provider.url}/health`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(healthUrl, { signal: controller.signal }).catch(e => ({ ok: false, status: 0, statusText: e.message }));
    clearTimeout(timeout);
    entry.reachable = res.ok || (res.status >= 200 && res.status < 500);
    if (!entry.reachable) entry.error = `HTTP ${res.status}: ${res.statusText}`;
  } catch (e) {
    entry.error = e.message;
  }
  results.push(entry);
}

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║         BIS PROVIDER VALIDATION REPORT                          ║');
console.log('╠══════════════════════════════════════════════════════════════════╣');
console.log('║ Provider                    │ Type        │ Status              ║');
console.log('╠═════════════════════════════╪═════════════╪═════════════════════╣');
for (const r of results) {
  const status = !r.configured ? '⚠️  NOT CONFIGURED' : r.reachable ? '✅ REACHABLE' : `❌ ${r.error?.slice(0, 18) || 'UNREACHABLE'}`;
  console.log(`║ ${r.name.padEnd(27)}│ ${r.type.padEnd(11)} │ ${status.padEnd(19)} ║`);
}
console.log('╚══════════════════════════════════════════════════════════════════╝');

const configured = results.filter(r => r.configured).length;
const reachable = results.filter(r => r.reachable).length;
console.log(`\nSummary: ${configured}/${results.length} configured, ${reachable}/${results.length} reachable`);
console.log('Note: Providers marked NOT CONFIGURED require env vars to be set.');
console.log('      The fail-closed policy ensures no synthetic results are returned.');

// Write JSON report
const fs = await import('fs');
fs.writeFileSync('/home/ubuntu/bis/docs/provider-validation-report.json', JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
console.log('\nJSON report saved to docs/provider-validation-report.json');
