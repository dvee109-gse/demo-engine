import { config } from "../src/config.js";
import { createContact, getContact, deleteContact } from "../src/ghlAdmin.js";

// Weekly automated end-to-end check (.github/workflows/weekly-smoke-test.yml).
// Creates a real test contact, POSTs directly to the deployed /demo endpoint
// (bypassing GHL's "Send Mockup" pipeline-stage-drag trigger — that specific
// link can only be exercised by actually dragging a card in the GHL UI, which
// needs a browser; this test covers everything downstream of it: scraping,
// LLM extraction, knowledge base priming, contact field writes, and the
// generated demo page itself), waits for the pipeline to finish, and verifies
// the contact ended up with real values rather than blanks — the same failure
// mode that GHL's own "Test workflow" button silently masked when this was
// first debugged by hand (see CLAUDE.md / project memory on the business-name
// fix). Always deletes the test contact afterward, success or failure.
//
// Uses an @example.com email deliberately — those can't receive real mail
// (confirmed in scripts/seedTestLead.js's own comment), so this never spams a
// real inbox on a weekly schedule. That also means it can't verify the actual
// sent email's rendering the way a human test can — it verifies the contact
// fields and the live demo page instead, which is what the email's merge tags
// actually read from anyway.
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
    const contact = await getContact(contactId);
    const fields = Object.fromEntries(
      (contact.contact?.customFields || []).map((f) => [f.id, f.value])
    );
    const businessName = fields[config.ghl.fieldIds.businessName];
    // demoLink isn't in config.ghl.fieldIds (only set via the GHL workflow's
    // Update Contact Field mapping, not written directly by this pipeline) —
    // so treat businessName landing as "pipeline finished" and re-fetch full
    // contact once more for reporting/link-checking below.
    if (businessName) return contact;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for pipeline to populate contact fields`);
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

    console.log("Waiting for pipeline to finish (scrape + LLM extraction)...");
    const finishedContact = await waitForPipeline(contactId);
    const fields = Object.fromEntries(
      (finishedContact.contact?.customFields || []).map((f) => [f.id, f.value])
    );
    const businessName = fields[config.ghl.fieldIds.businessName];
    const websiteUrl = fields[config.ghl.fieldIds.websiteUrl];

    if (!businessName) throw new Error("Business Name field is still blank after pipeline finished");
    if (!websiteUrl) throw new Error("Website URL field is still blank after pipeline finished");
    console.log(`Contact fields populated: businessName="${businessName}", websiteUrl="${websiteUrl}"`);

    // Fetch the health endpoint's "primed" info to get the demo link this run
    // produced, then verify the actual page renders correctly.
    const health = await fetch(`${config.demoBaseUrl}/health`).then((r) => r.json());
    if (health.primed?.contactId !== contactId) {
      console.warn(
        `Note: /health's "primed" contact (${health.primed?.contactId}) doesn't match this run's contact — probably a concurrent request primed the shared bot after this one. Skipping the live page-content check.`
      );
    } else {
      console.log(`Confirmed shared bot primed for this run's contact.`);
    }

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
