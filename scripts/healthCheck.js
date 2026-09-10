import { config } from "../src/config.js";

// Daily automated check (.github/workflows/daily-health-check.yml). Deliberately
// lightweight — no scraping, no LLM calls, no test contacts created. Checks the
// two failure modes that would otherwise go unnoticed between prospect demos:
// the deployed app being down, and the GHL Private Integration Token expiring
// or losing scopes. GHL's workflow layer has no read API at all (see ghlAdmin.js
// file header) so this can't check "Needs Review" or workflow execution status —
// that still needs a manual/browser check, see the weekly smoke test's own
// limitations note for the same gap.
//
// Exits non-zero on any failure. Run on a schedule via GitHub Actions, which
// emails the repo owner automatically on a failed scheduled run — no custom
// alerting code needed.

const failures = [];

async function checkDemoSite() {
  const url = `${config.demoBaseUrl}/health`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      failures.push(`Demo site /health returned ${res.status} (expected 200) at ${url}`);
      return;
    }
    const body = await res.json();
    if (body.ok !== true) {
      failures.push(`Demo site /health responded but ok was not true: ${JSON.stringify(body)}`);
    }
  } catch (err) {
    failures.push(`Demo site unreachable at ${url}: ${err.message}`);
  }
}

async function checkGhlAgent(label, path) {
  const url = new URL(`${config.ghl.apiBaseUrl}${path}`);
  url.searchParams.set("locationId", config.ghl.locationId);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.ghl.pitToken}`,
        Version: config.ghl.apiVersion,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      failures.push(`${label} check failed: ${res.status} ${text}`);
    }
  } catch (err) {
    failures.push(`${label} check errored: ${err.message}`);
  }
}

async function main() {
  await checkDemoSite();
  await checkGhlAgent("GHL Conversation AI agent (chat)", `/conversation-ai/agents/${config.ghl.agentId}`);
  if (config.ghl.voiceAgentId) {
    await checkGhlAgent("GHL Voice AI agent", `/voice-ai/agents/${config.ghl.voiceAgentId}`);
  }

  if (failures.length > 0) {
    console.error("Health check FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log("Health check passed: demo site up, GHL agents reachable.");
}

main();
