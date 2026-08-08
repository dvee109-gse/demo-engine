import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { scrapeSite } from "./scraper.js";
import { buildKnowledgeContent } from "./contentBuilder.js";
import { extractWithLLM } from "./llmExtractor.js";
import { primeKnowledgeBase, primeAgent, notifyDemoReady, notifyNeedsReview } from "./ghlClient.js";
import { buildDemoPage } from "./demoPageBuilder.js";
import { markPrimed, getPrimed } from "./store.js";
import { assessScrapeQuality } from "./qualityGate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, primed: getPrimed() }));

app.use("/demos", express.static(path.join(__dirname, "..", "public", "demos")));

// Fired by the GHL workflow when an opportunity moves to "Send Mockup" (blueprint §3.3).
app.post("/demo", async (req, res) => {
  const { contactId, businessName, websiteUrl, email, phone } = req.body || {};

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
  const scrape = await scrapeSite(websiteUrl);
  scrape.businessName = scrape.businessName || businessName || "your business";
  scrape.phone = scrape.phone || phone || "";

  const quality = assessScrapeQuality(scrape);
  if (!quality.ok) {
    console.warn(`[pipeline] ${contactId}: quality gate failed — ${quality.reasons.join(" ")}`);
    await notifyNeedsReview({ contactId, businessName: scrape.businessName, reasons: quality.reasons });
    return;
  }

  console.log(`[pipeline] ${contactId}: LLM extraction pass`);
  const llmExtraction = await extractWithLLM(scrape);

  const content = buildKnowledgeContent(scrape, llmExtraction);

  markPrimed(contactId, content.variables.businessName);

  console.log(`[pipeline] ${contactId}: priming knowledge base + agent`);
  await primeKnowledgeBase(content);
  await primeAgent({
    businessName: content.variables.businessName,
    heroText: content.variables.heroText,
  });

  console.log(`[pipeline] ${contactId}: building demo page`);
  const beaconUrl = `${config.demoBaseUrl}/beacon`; // see note below
  const demoLink = await buildDemoPage({ contactId, variables: content.variables, beaconUrl });

  console.log(`[pipeline] ${contactId}: notifying GHL — ${demoLink}`);
  await notifyDemoReady({ contactId, demoLink, businessName: content.variables.businessName });

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
