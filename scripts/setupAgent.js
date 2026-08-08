import { createAgent } from "../src/ghlClient.js";

// One-time: creates the shared demo bot's Conversation AI agent, attached to
// the knowledge base from setupKnowledgeBase.js. Run that first, put its id
// in .env as GHL_KNOWLEDGE_BASE_ID, then run this and paste the printed id
// into .env as GHL_AGENT_ID.
//
// Confirmed live (2026-08-08) against a real GHL account — see the notes in
// src/ghlClient.js for what was actually required (locationId rejected,
// personality/goal/instructions required, mode enum off|suggestive|auto-pilot).
async function main() {
  const knowledgeBaseId = process.env.GHL_KNOWLEDGE_BASE_ID;
  if (!knowledgeBaseId) {
    console.error("Set GHL_KNOWLEDGE_BASE_ID in .env first (run scripts/setupKnowledgeBase.js).");
    process.exit(1);
  }

  const agent = await createAgent({
    name: "Demo Engine — Shared Bot",
    knowledgeBaseId,
    personality: "Friendly, knowledgeable, and professional — like a helpful front-desk employee.",
    goal: "Help prospective customers understand what this business offers and encourage them to book a consultation or ask further questions.",
    instructions:
      "Answer only using information from your knowledge base. Be concise and accurate. If you don't know something, say so honestly rather than guessing. (This bot is re-primed per prospect by the demo engine middleware — see src/ghlClient.js primeAgent().)",
    mode: "auto-pilot",
  });
  console.log("Created agent:");
  console.log(JSON.stringify(agent, null, 2));
  console.log(`\nPaste into .env: GHL_AGENT_ID=${agent.id || "(check response above for the id field)"}`);
  console.log(
    "\nIf the response doesn't show the knowledge base attached, do it manually in the GHL UI: " +
      "Conversation AI > your agent > Knowledge Sources > attach the KB created by setupKnowledgeBase.js."
  );
}

main().catch((err) => {
  console.error(err.message);
  console.error("If this 400s, open Conversation AI API > Agents > Create Agent in your GHL API reference and match the body shape exactly.");
  process.exit(1);
});
