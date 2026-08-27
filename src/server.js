import express from "express";
import { randomInt } from "node:crypto";
import { config } from "./config.js";
import { scrapeSite } from "./scraper.js";
import { buildKnowledgeContent } from "./contentBuilder.js";
import { extractWithLLM } from "./llmExtractor.js";
import { primeKnowledgeBase, primeAgent, primeVoiceAgent, notifyDemoReady, notifyNeedsReview } from "./ghlClient.js";
import { getContact, updateContactCustomField, findContactByShortCode } from "./ghlAdmin.js";
import { renderDemoPage, getDemoUrl } from "./demoPageBuilder.js";
import { markPrimed, getPrimed } from "./store.js";
import { assessScrapeQuality } from "./qualityGate.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, primed: getPrimed() }));

// Renders the demo page fresh on every request — see demoPageBuilder.js for why
// this isn't a static file. The render data was persisted to GHL (durable) at
// pipeline time via saveDemoPageData() below.
//
// Reprimes the shared bot before render, but ONLY when it isn't already
// correctly primed for this contact — this is a shared-bot design (one
// Conversation AI agent, one Voice AI agent, one Knowledge Base reused across
// every prospect), so if a second demo gets triggered for a different
// prospect before this one is opened, the bot would otherwise still be primed
// with the WRONG business by the time this person clicks their link.
// Unconditionally repriming on every view (the first version of this fix)
// caused an 11+ second load on every single view, confirmed live
// (2026-08-23) — repriming means ~10-20+ sequential GHL API calls (KB
// description, FAQ list/delete/recreate, agent PUT, voice agent PATCH), which
// is fine to pay once when the bot's state is actually stale, but not on
// every repeat view of the same demo. getPrimed() tracks who the bot is
// CURRENTLY primed for (in-memory — resets on restart, which just means the
// next view reprimes again, a safe fallback) so repeat views by the same
// person, or views while no other demo has been triggered since, skip the
// expensive reprime entirely.
app.get("/demos/:contactId", (req, res) => renderDemoResponse(req.params.contactId, res));

// Short-link route — this is the one actually emailed to prospects (see
// getDemoUrl() in demoPageBuilder.js). Resolves the short code back to a
// contactId via GHL's Contact Search Advanced API (confirmed live,
// 2026-08-26: filtering by customFields.{id}+eq works) instead of needing our
// own database, since Render's filesystem is ephemeral. /demos/:contactId
// above still works directly for any already-sent long-form links.
app.get("/d/:code", async (req, res) => {
  const { code } = req.params;
  try {
    const contact = await findContactByShortCode(code.toUpperCase());
    if (!contact) {
      return res.status(404).send("Demo not found for this link.");
    }
    await renderDemoResponse(contact.id, res);
  } catch (err) {
    console.error(`[server] failed to resolve short code ${code}:`, err.message);
    res.status(500).send("Could not load this demo right now.");
  }
});

async function renderDemoResponse(contactId, res) {
  try {
    const contact = await getContact(contactId);
    const raw = findCustomFieldValue(contact, config.ghl.fieldIds.servicesSummary);
    if (!raw) {
      return res.status(404).send("Demo not found for this contact.");
    }
    const content = JSON.parse(raw);
    // Demo pages saved before this reprime-on-view feature stored a flat
    // {businessName, logoUrl, ...} object with no businessSummary/faqPairs —
    // there's nothing to reprime with, so fall back to rendering as before
    // rather than crashing on content.variables being undefined.
    const variables = content.variables || content;
    if (content.businessSummary && content.faqPairs) {
      if (getPrimed()?.contactId === contactId) {
        console.log(`[server] ${contactId}: already primed for ${variables.businessName} — skipping reprime`);
      } else {
        console.log(`[server] ${contactId}: repriming shared bot before render — ${variables.businessName}`);
        await primeSharedBot(content);
        markPrimed(contactId, variables.businessName);
      }
    } else {
      console.warn(`[server] ${contactId}: no saved businessSummary/faqPairs (pre-reprime-on-view data) — rendering without repriming`);
    }
    const beaconUrl = `${config.demoBaseUrl}/beacon`;
    const html = await renderDemoPage(variables, { contactId, beaconUrl });
    res.set("Content-Type", "text/html").send(html);
  } catch (err) {
    console.error(`[server] failed to render demo for ${contactId}:`, err.message);
    res.status(500).send("Could not load this demo right now.");
  }
}

// GET /contacts/{id}'s customFields shape wasn't fully confirmed against a live
// response for this build — handle a couple of plausible shapes rather than
// assuming one. Adjust if this misses on your account.
function findCustomFieldValue(contactResponse, fieldId) {
  const contact = contactResponse?.contact || contactResponse;
  const fields = contact?.customFields || contact?.customField || [];
  const match = fields.find((f) => f.id === fieldId);
  return match?.value ?? match?.fieldValue ?? null;
}

/** Persists the FULL content GET /demos/:contactId needs — not just display
 * variables — into GHL (durable) instead of local disk (wiped on every
 * restart — see demoPageBuilder.js). businessSummary/faqPairs are what let
 * the demo page reprime the shared bot on every view (see the /demos/:contactId
 * route above) without having to rescrape the site from scratch. */
async function saveDemoPageData(contactId, content) {
  const payload = JSON.stringify({
    businessSummary: content.businessSummary,
    faqPairs: content.faqPairs,
    variables: content.variables,
  });
  await updateContactCustomField(contactId, config.ghl.fieldIds.servicesSummary, payload);
}

// Excludes visually ambiguous characters (0/O, 1/I/L) so a typed-by-hand code
// (the whole point of this — see getDemoUrl()) isn't a guessing game.
const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function generateShortCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return code;
}

/** Generates a short code for this contact and saves it, retrying on the
 * astronomically unlikely case of a collision (32^6 ≈ 1B possible codes —
 * this is just cheap insurance, not a real expected occurrence). */
async function assignShortCode(contactId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode();
    const existing = await findContactByShortCode(code);
    if (!existing) {
      await updateContactCustomField(contactId, config.ghl.fieldIds.shortCode, code);
      return code;
    }
  }
  throw new Error("Could not generate a unique short code after 5 attempts");
}

/** Reprimes the shared Knowledge Base + Conversation AI + Voice AI agent with
 * one prospect's content. Called both right after the scrape pipeline
 * completes and again on every /demos/:contactId view — see that route for why. */
async function primeSharedBot(content) {
  await primeKnowledgeBase(content);
  await primeAgent({
    businessName: content.variables.businessName,
    heroText: content.variables.heroText,
  });
  await primeVoiceAgent({ businessName: content.variables.businessName });
}

// Fired by the GHL workflow when an opportunity moves to "Send Mockup" (blueprint §3.3).
app.post("/demo", async (req, res) => {
  // GHL's Webhook workflow action nests the action's own Custom Data fields
  // under `customData` alongside a large flat object of standard contact/
  // opportunity/location fields — confirmed live (2026-08-16) via raw body
  // logging. Falls back to top-level for direct/manual POSTs (e.g. curl tests).
  const body = req.body?.customData || req.body || {};
  const { contactId, businessName, websiteUrl, email, phone } = body;

  if (!contactId || !websiteUrl) {
    return res.status(400).json({ error: "contactId and websiteUrl are required" });
  }

  // Webhooks shouldn't be left hanging — ack immediately, do the work async, and
  // let notifyDemoReady() carry the result back into GHL when it's done.
  res.status(202).json({ accepted: true });

  runPipeline({ contactId, businessName, websiteUrl, email, phone }).catch((err) => {
    console.error(`[server] pipeline failed for contact ${contactId}:`, err);
  });
});

async function runPipeline({ contactId, businessName, websiteUrl, email, phone }) {
  console.log(`[pipeline] ${contactId}: scraping ${websiteUrl}`);
  let scrape;
  try {
    scrape = await scrapeSite(websiteUrl);
  } catch (err) {
    // Network-level failures (DNS, timeout, connection reset, empty response)
    // throw from Playwright's page.goto() rather than returning a bad
    // httpStatus — confirmed live (2026-08-22) via httpstat.us/404, which
    // returns net::ERR_EMPTY_RESPONSE instead of a clean 404. Without this,
    // the whole pipeline crashed before ever reaching the quality gate, so
    // notifyNeedsReview() never ran and nothing told the agency to follow up.
    console.warn(`[pipeline] ${contactId}: scrape failed — ${err.message}`);
    await notifyNeedsReview({
      contactId,
      businessName: businessName || "this business",
      reasons: [`Site could not be reached: ${err.message}`],
      email,
    });
    return;
  }
  scrape.businessName = scrape.businessName || businessName || "your business";
  scrape.phone = scrape.phone || phone || "";

  const quality = assessScrapeQuality(scrape);
  if (!quality.ok) {
    console.warn(`[pipeline] ${contactId}: quality gate failed — ${quality.reasons.join(" ")}`);
    await notifyNeedsReview({ contactId, businessName: scrape.businessName, reasons: quality.reasons, email });
    return;
  }

  console.log(`[pipeline] ${contactId}: LLM extraction pass`);
  const llmExtraction = await extractWithLLM(scrape);

  const content = buildKnowledgeContent(scrape, llmExtraction);

  markPrimed(contactId, content.variables.businessName);

  console.log(`[pipeline] ${contactId}: priming knowledge base + agent`);
  await primeSharedBot(content);

  console.log(`[pipeline] ${contactId}: saving demo page data`);
  await saveDemoPageData(contactId, content);
  const shortCode = await assignShortCode(contactId);
  const demoLink = getDemoUrl(shortCode);

  console.log(`[pipeline] ${contactId}: notifying GHL — ${demoLink}`);
  await notifyDemoReady({ contactId, demoLink, businessName: content.variables.businessName, email });

  console.log(`[pipeline] ${contactId}: done`);
}

// Hit by the demo page's tracking beacon on first real interaction (blueprint §3.5).
// This just relays to GHL's own inbound-webhook workflow — point BEACON_FORWARD_URL
// at a *second* GHL inbound webhook (the one wired to move the stage to
// "AI Mockup Opened"), separate from GHL_DEMO_READY_WEBHOOK_URL.
app.post("/beacon", async (req, res) => {
  const forwardUrl = process.env.BEACON_FORWARD_URL;
  if (!forwardUrl) {
    console.warn("[beacon] BEACON_FORWARD_URL not set — logging only:", req.body);
    return res.status(202).end();
  }
  try {
    await fetch(forwardUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
  } catch (err) {
    console.error("[beacon] forward failed:", err.message);
  }
  res.status(202).end();
});

app.listen(config.port, () => {
  console.log(`Demo engine listening on :${config.port}`);
});
