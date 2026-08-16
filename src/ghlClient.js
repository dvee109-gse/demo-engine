import { config } from "./config.js";

/**
 * Thin client for the GHL REST endpoints this pipeline needs.
 *
 * Confirmed from GHL's public API docs: auth is a Bearer token (Private Integration
 * Token, sub-account scoped) plus a required `Version` header; the Knowledge Base
 * family of endpoints uses `Version: v3` (distinct from the 2021-07-28 header most
 * other v2 endpoints use); knowledge bases live at POST/GET/PUT/DELETE /knowledge-bases/
 * with a 15-per-location cap, and FAQ / Web Crawler sources are sub-resources of a
 * knowledge base. GHL's docs site didn't render the exact FAQ/agent sub-resource
 * paths and body field names for this fetch, so those two calls below are marked
 * NOT CONFIRMED — open your GHL Private Integration's live API reference (Agency
 * Settings > Private Integrations > your token > API docs) and correct the path/
 * body shape there before relying on this in production. Everything else here
 * (base URL, versioning, auth header, the KB collection endpoint, and the plain
 * webhook callback) is accurate as documented.
 */

async function ghlRequest(path, { method = "GET", body, version = config.ghl.apiVersion } = {}) {
  const res = await fetch(`${config.ghl.apiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.ghl.pitToken}`,
      Version: version,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GHL ${method} ${path} -> ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

/** One-time setup (scripts/setupKnowledgeBase.js): creates the shared demo bot's
 * knowledge base. Confirmed endpoint/version header — see file header note. */
export async function createKnowledgeBase({ name, description }) {
  return ghlRequest(`/knowledge-bases/`, {
    method: "POST",
    version: config.ghl.kbApiVersion,
    body: { locationId: config.ghl.locationId, name, description },
  });
}

/** One-time setup (scripts/setupAgent.js): creates the shared demo bot's Conversation
 * AI agent. NOT CONFIRMED: exact Create Agent body schema — verify against your
 * Private Integration's live API reference before relying on this in production. */
export async function createAgent({ name, knowledgeBaseId, personality, goal, instructions, mode = "auto-pilot" }) {
  // Confirmed live (2026-08-08): the PIT is already location-scoped, so
  // `locationId` in the body is rejected (422). personality/goal/instructions
  // are required — GHL 422s without them. mode enum: off | suggestive |
  // auto-pilot — new agents default to "off" if omitted, which means an
  // unattended demo bot silently won't respond until this is set explicitly.
  return ghlRequest(`/conversation-ai/agents`, {
    method: "POST",
    body: {
      name,
      personality,
      goal,
      instructions,
      mode,
      knowledgeBaseIds: knowledgeBaseId ? [knowledgeBaseId] : undefined,
    },
  });
}

/** Replaces the shared demo bot's knowledge base with content scraped for the current prospect. */
export async function primeKnowledgeBase({ businessSummary, faqPairs }) {
  const kbId = config.ghl.knowledgeBaseId;

  // Confirmed: PUT /knowledge-bases/{id} updates a knowledge base's own fields (name, description).
  await ghlRequest(`/knowledge-bases/${kbId}`, {
    method: "PUT",
    version: config.ghl.kbApiVersion,
    body: { description: businessSummary },
  });

  // Confirmed live (2026-08-08): FAQs are NOT nested under the knowledge
  // base's own path at all — it's a flat top-level collection
  // (/knowledge-bases/faqs), with locationId + knowledgeBaseId as fields on
  // every call rather than URL segments. Duplicate questions 409 (GHL enforces
  // uniqueness per KB) — treated as "already there," not an error.
  const existing = await ghlRequest(
    `/knowledge-bases/faqs?locationId=${config.ghl.locationId}&knowledgeBaseId=${kbId}&limit=100`,
    { version: config.ghl.kbApiVersion }
  ).catch(() => ({ faqs: [] }));

  for (const item of existing?.faqs || []) {
    await ghlRequest(`/knowledge-bases/faqs/${item.id}?locationId=${config.ghl.locationId}`, {
      method: "DELETE",
      version: config.ghl.kbApiVersion,
    }).catch((err) => console.warn(`[ghlClient] failed to clear old FAQ entry ${item.id}: ${err.message}`));
  }

  for (const pair of faqPairs) {
    await ghlRequest(`/knowledge-bases/faqs`, {
      method: "POST",
      version: config.ghl.kbApiVersion,
      body: {
        locationId: config.ghl.locationId,
        knowledgeBaseId: kbId,
        question: pair.question,
        answer: pair.answer,
      },
    }).catch((err) => {
      if (err.message.includes("already exists")) return; // duplicate question — fine, already there
      console.warn(`[ghlClient] failed to add FAQ entry "${pair.question}": ${err.message}`);
    });
  }
}

/** Updates the shared Conversation AI agent's business-context variables. */
export async function primeAgent({ businessName, heroText }) {
  // Confirmed live (2026-08-08): PUT is a full replace, not a partial patch —
  // omitting personality/goal/instructions/mode 422s even when you only meant
  // to change name/instructions. Always resend the full config. `mode` enum
  // confirmed: off | suggestive | auto-pilot — auto-pilot is required for an
  // unattended demo bot (default is "off" on creation).
  return ghlRequest(`/conversation-ai/agents/${config.ghl.agentId}`, {
    method: "PUT",
    body: {
      name: `${businessName} Demo Agent`,
      personality: "Friendly, knowledgeable, and professional — like a helpful front-desk employee.",
      goal: "Help prospective customers understand what this business offers and encourage them to book a consultation or ask further questions.",
      instructions: `You represent ${businessName}. ${heroText || ""} Answer only using information from your knowledge base. Be concise and accurate — if you don't know something, say so honestly rather than guessing.`,
      mode: "auto-pilot",
      knowledgeBaseIds: [config.ghl.knowledgeBaseId],
    },
  }).catch((err) => {
    console.warn(`[ghlClient] agent update failed (verify endpoint/body against your GHL docs): ${err.message}`);
  });
}

/** Updates the shared Voice AI agent's business-context variables (mirrors primeAgent()
 * for the chat bot — the two are separate GHL agent objects, so both need repriming).
 * Confirmed live (2026-08-15): PATCH /voice-ai/agents/{id}?locationId=... is a real
 * partial update — only the fields sent are changed. Requires Voice AI scopes on the
 * Private Integration Token (voice-ai-agents.readonly / .write) — a 401/403 here
 * usually means those scopes are missing. Voice AI agent already has the shared
 * knowledge base attached via the GHL UI, so this only needs to touch the greeting.
 *
 * The welcome message doubles as the intake question — the agentPrompt (set once,
 * business-agnostic, see scripts/setupVoiceAgentPrompt.js) tells the agent to use
 * the caller's answer to it, then transition into roleplaying as the business. */
export async function primeVoiceAgent({ businessName }) {
  if (!config.ghl.voiceAgentId) {
    console.warn("[ghlClient] GHL_VOICE_AGENT_ID not set — skipping Voice AI repriming.");
    return;
  }
  const url = new URL(`${config.ghl.apiBaseUrl}/voice-ai/agents/${config.ghl.voiceAgentId}`);
  url.searchParams.set("locationId", config.ghl.locationId);

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.ghl.pitToken}`,
      Version: config.ghl.apiVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessName,
      welcomeMessage: `Hi, thanks for calling ${businessName}! Before we dive in — what's one thing about your business you'd want a caller to know, like a specific service or something that sets you apart?`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[ghlClient] voice agent update failed: ${res.status} ${text}`);
  }
}

/** Plain webhook POST — this one needs no guessing, it's just the URL your GHL workflow gave you.
 *
 * Confirmed live (2026-08-08): GHL's Inbound Webhook trigger does NOT use an
 * arbitrary `contactId` field to attach the run to an existing contact — with
 * no recognized standard field (email/phone) in the payload, it silently
 * created a brand-new blank contact and ran the workflow against that
 * instead, so the real contact's Demo Link field never updated. Including
 * `email` (a field GHL recognizes for contact matching) fixes this — verify
 * this actually resolves it before relying on it for other payloads. */
export async function notifyDemoReady({ contactId, demoLink, businessName, email }) {
  const res = await fetch(config.ghl.demoReadyWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, demo_link: demoLink, business_name: businessName, email }),
  });
  if (!res.ok) {
    throw new Error(`Callback to GHL failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

/** Fired instead of notifyDemoReady() when qualityGate.js flags the scrape (e.g. a parked/dead
 * domain) — routes the opportunity to manual review instead of auto-sending a broken demo.
 * Same contact-matching caveat as notifyDemoReady() above — include email so GHL attaches
 * this to the real contact rather than creating a blank one. */
export async function notifyNeedsReview({ contactId, businessName, reasons, email }) {
  if (!config.ghl.needsReviewWebhookUrl) {
    console.warn(
      `[ghlClient] GHL_NEEDS_REVIEW_WEBHOOK_URL not set — not notified. Contact ${contactId} (${businessName}) needs manual review: ${reasons.join(" ")}`
    );
    return;
  }
  const res = await fetch(config.ghl.needsReviewWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, business_name: businessName, reasons: reasons.join(" "), email }),
  });
  if (!res.ok) {
    throw new Error(`Needs-review callback to GHL failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
