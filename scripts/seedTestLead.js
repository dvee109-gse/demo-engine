import { createContact, createOpportunity } from "../src/ghlAdmin.js";

// Mirrors the "Steve TM27" test lead from the walkthrough: a real business URL,
// a fake name, so you can run the whole pipeline end-to-end without emailing an
// actual prospect. Pass a 3rd argument with a real email to instead receive the
// real branded email — for testing the full experience as an actual prospect
// would see it (fake @example.com addresses can't receive mail — confirmed live).
// Usage:
//   node scripts/seedTestLead.js "https://some-real-business.com" "Some Business Name" ["real@email.com"]
async function main() {
  const [websiteUrl, businessName, realEmail] = process.argv.slice(2);
  if (!websiteUrl || !businessName) {
    console.error('Usage: node scripts/seedTestLead.js "<website-url>" "<business-name>" ["<real-email>"]');
    process.exit(1);
  }

  const pipelineId = process.env.GHL_PIPELINE_ID;
  const stageId = process.env.GHL_STAGE_NEW_LEAD_ID;
  if (!pipelineId || !stageId) {
    console.error("Set GHL_PIPELINE_ID and GHL_STAGE_NEW_LEAD_ID in .env first (run scripts/listPipelines.js to find them).");
    process.exit(1);
  }

  // GHL rejects duplicate contacts by phone number (confirmed live) — a fixed
  // fake phone on every run collides with the previous test contact, so make
  // it unique the same way the email already is.
  const suffix = Date.now().toString().slice(-7);
  const contact = await createContact({
    firstName: "Test",
    lastName: `Lead-${suffix.slice(-4)}`,
    email: realEmail || `test-lead-${Date.now()}@example.com`,
    phone: `+1555${suffix}`,
    businessName,
    websiteUrl,
  });
  const contactId = contact.contact?.id || contact.id;
  console.log(`created contact: ${contactId}`);

  const opportunity = await createOpportunity({
    pipelineId,
    stageId,
    contactId,
    name: `${businessName} — test`,
  });
  console.log(`created opportunity: ${opportunity.opportunity?.id || opportunity.id}`);

  console.log(`\nNow: drag this opportunity to "Send Mockup" in GHL, or POST directly to your /demo endpoint:`);
  console.log(
    JSON.stringify(
      { contactId, businessName, websiteUrl, email: contact.contact?.email, phone: contact.contact?.phone },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
