import { createCustomField, listCustomFields } from "../src/ghlAdmin.js";

// The 4 fields the pipeline needs on the contact record (blueprint §3.1).
// demo_link and business_name get referenced as {{contact.demo_link}} etc. in
// the "AI Mockup Sent" email template once created.
const FIELDS = [
  { name: "Website URL", dataType: "TEXT", model: "contact" },
  { name: "Demo Link", dataType: "TEXT", model: "contact" },
  { name: "Business Name", dataType: "TEXT", model: "contact" },
  { name: "Services Summary", dataType: "LARGE_TEXT", model: "contact" },
  // Short random code for the /d/:code short-link route (server.js) — a
  // typeable fallback when a prospect can't tap the link directly (confirmed
  // live, 2026-08-25: the full /demos/{contactId} URL is genuinely painful to
  // type manually, which is the only workaround for a rare but real
  // HTTP/3/QUIC connection issue on some networks). Searchable via GHL's
  // Contact Search Advanced API (confirmed live: customFields.{id} + eq works).
  { name: "Short Code", dataType: "TEXT", model: "contact" },
];

async function main() {
  const existing = await listCustomFields("contact").catch((err) => {
    console.warn(`Could not list existing fields (continuing anyway): ${err.message}`);
    return { customFields: [] };
  });
  const existingNames = new Set((existing.customFields || existing.fields || []).map((f) => f.name));

  for (const field of FIELDS) {
    if (existingNames.has(field.name)) {
      console.log(`skip (already exists): ${field.name}`);
      continue;
    }
    try {
      const created = await createCustomField(field);
      // Confirmed shape (2026-08-08 live test): the field object is nested
      // under `customField`, and `fieldKey` already includes the "contact."
      // prefix (e.g. "contact.website_url") — don't add it again.
      const fieldKey = created.customField?.fieldKey || created.fieldKey || "(check response below for fieldKey)";
      console.log(`created: ${field.name} -> merge tag {{${fieldKey}}}`);
      console.log(JSON.stringify(created, null, 2));
    } catch (err) {
      console.error(`failed: ${field.name} — ${err.message}`);
      console.error("If this 400s, open Custom Fields V2 API in your GHL API reference and match the body shape exactly.");
    }
  }
}

main();
