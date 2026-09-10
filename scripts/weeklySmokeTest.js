import { config } from "../src/config.js";
import { createContact, deleteContact } from "../src/ghlAdmin.js";

// Weekly automated end-to-end check (.github/workflows/weekly-smoke-test.yml).
// Creates a real test contact, POSTs directly to the deployed /demo endpoint
// (bypassing GHL's "Send Mockup" pipeline-stage-drag trigger — that specific
// link can only be exercised by actually dragging a card in the GHL UI, which
// needs a browser; this test covers everything downstream of it: scraping,
// LLM extraction, and knowledge base priming), waits for the pipeline to
// actually finish, and verifies it got that far. Always deletes the test
// contact afterward, success or failure.
//
// IMPORTANT — do not use createContact()'s businessName/websiteUrl custom
// fields as the "pipeline finished" signal: createContact() writes those
// itself, synchronously, at creation time — they're on the contact before the
// pipeline even starts, so checking for them proves nothing (confirmed live,
// 2026-09-09: the first version of this script did exactly that and passed in
// under half a second, faster than a real scrape could possibly finish).
// Instead this polls GET /health, which server.js only updates via
// markPrimed(contactId, ...) partway through the real pipeline run — a
// genuine "this contact's pipeline actually executed" signal. Note /health
// reflects a single shared value (see the shared-bot-concurrency limitation
// in project memory) — a real prospect's demo loading at the exact same
// moment as this scheduled run could theoretically overwrite it first, but
// that's unlikely at a fixed early-morning schedule and would just cause a
// (safe, non-destructive) false failure alert to investigate, not a missed
// real failure.
//
// Uses an @example.com email deliberately — those can't receive real mail
// (confirmed in scripts/seedTestLead.js's own comment), so this never spams a
// real inbox on a weekly schedule. That also means it can't verify the actual
// sent email's rendering the way a human test can — this checks that the
// demo-engine pipeline itself (the most fragile part: live scraping + LLM
// extraction) completed successfully, not the separate GHL workflow's merge
// tags (see the business-name-fix project memory for that class of bug,
// which needs a human/browser check, not this).
//
// Exits non-zero on any failure so the GitHub Actions scheduled run fails and
// the repo owner gets GitHub's automatic failure-notification email.

const TEST_WEBSITE_URL = "https://capitalprotect.net";
const TEST_BUSINESS_NAME = "Capital Protection Group";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPipeline(contactId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const health = await fetch(`${config.demoBaseUrl}/health`).then((r) => r.json());
    if (health.primed?.contactId === contactId) return health.primed;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for /health to show this contact as primed — the pipeline likely failed partway through (scrape or LLM extraction). Check Render logs.`
  );
}

async function main() {
  const suffix = Date.now().toString().slice(-7);
  const email = `smoke-test-${Date.now()}@example.com`;
  let contactId;

  try {
    console.log("Creating test contact...");
    const contact = await createContact({
      firstName: "Smoke",
      lastName: `Test-${suffix.slice(-4)}`,
      email,
      phone: `+1555${suffix}`,
      businessName: TEST_BUSINESS_NAME,
      websiteUrl: TEST_WEBSITE_URL,
    });
    contactId = contact.contact?.id || contact.id;
    console.log(`Created contact: ${contactId}`);

    console.log("POSTing to /demo to trigger the real pipeline...");
    const res = await fetch(`${config.demoBaseUrl}/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        businessName: TEST_BUSINESS_NAME,
        websiteUrl: TEST_WEBSITE_URL,
        email,
      }),
    });
    if (res.status !== 202) {
      throw new Error(`/demo returned ${res.status} (expected 202): ${await res.text().catch(() => "")}`);
    }

    console.log("Waiting for the pipeline to actually run (scrape + LLM extraction)...");
    const primed = await waitForPipeline(contactId);
    console.log(`Pipeline completed — primed for businessName="${primed.businessName}".`);
    console.log("Smoke test PASSED.");
  } finally {
    if (contactId) {
      console.log(`Cleaning up test contact ${contactId}...`);
      await deleteContact(contactId).catch((err) =>
        console.warn(`Cleanup failed (not fatal, but a stray test contact remains): ${err.message}`)
      );
    }
  }
}

main().catch((err) => {
  console.error(`Smoke test FAILED: ${err.message}`);
  process.exit(1);
});
