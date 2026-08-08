/**
 * Turns raw scrape output into what the bot actually needs: FAQ-shaped Q&A pairs
 * (GHL's Knowledge Source docs call these out as outperforming raw prose) plus a
 * short rich-text business summary and the display variables for the demo page.
 *
 * `llmExtraction` (from llmExtractor.js) is optional enrichment for sites whose
 * services/FAQs aren't structured in scrapeable markup — DOM-found facts are
 * kept as-is (they're verified against the actual page), the LLM pass only
 * fills in what the DOM heuristics came back empty on.
 */
export function buildKnowledgeContent(scrape, llmExtraction = null) {
  const name = scrape.businessName || "this business";

  const services = scrape.services.length ? scrape.services : llmExtraction?.services || [];
  const description = llmExtraction?.summary || scrape.heroText;

  const faqPairs = [...scrape.faqPairs, ...(llmExtraction?.faqPairs || [])];

  if (services.length) {
    faqPairs.push({
      question: `What services does ${name} offer?`,
      answer: `${name} offers: ${services.join(", ")}.`,
    });
  }
  if (scrape.phone) {
    faqPairs.push({
      question: `How can I contact ${name}?`,
      answer: `You can reach ${name} by phone at ${scrape.phone}.`,
    });
  }
  if (description) {
    faqPairs.push({
      question: `What does ${name} do?`,
      answer: description,
    });
  }

  const businessSummary = [
    `Business name: ${name}`,
    description ? `Description: ${description}` : "",
    services.length ? `Services: ${services.join(", ")}` : "",
    scrape.phone ? `Phone: ${scrape.phone}` : "",
    // Only dump the raw scrape when there was no LLM pass to distill it —
    // otherwise this just duplicates what summary/services/faqPairs already cover.
    !llmExtraction && scrape.rawTextSample ? `\nAdditional site content:\n${scrape.rawTextSample}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    businessSummary,
    faqPairs: dedupe(faqPairs),
    variables: {
      businessName: name,
      logoUrl: scrape.logoUrl || "",
      primaryColor: scrape.primaryColor || "#1a1a1a",
      phone: scrape.phone || "",
      heroText: description || "",
      sourceUrl: scrape.sourceUrl,
    },
  };
}

function dedupe(pairs) {
  const seen = new Set();
  return pairs.filter((p) => {
    const key = p.question.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
