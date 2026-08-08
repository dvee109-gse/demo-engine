import { createKnowledgeBase } from "../src/ghlClient.js";

// One-time: creates the shared demo bot's knowledge base (Option A — see
// blueprint §1). Run once, then paste the printed id into .env as
// GHL_KNOWLEDGE_BASE_ID.
async function main() {
  const kb = await createKnowledgeBase({
    name: "Demo Engine — Shared Bot KB",
    description: "Re-primed per prospect by the demo engine middleware. Do not edit manually.",
  });
  console.log("Created knowledge base:");
  console.log(JSON.stringify(kb, null, 2));
  // Confirmed shape (2026-08-08 live test): response wraps the object as { success, data: {...} }.
  const id = kb.data?.id || kb.id || "(check response above for the id field)";
  console.log(`\nPaste into .env: GHL_KNOWLEDGE_BASE_ID=${id}`);
}

main().catch((err) => {
  console.error(err.message);
  console.error("If this 400s, open Knowledge Base API in your GHL API reference and match the body shape exactly.");
  process.exit(1);
});
