/**
 * Catches the case the assulmedicalspa.com stress test surfaced: a scraped
 * "business" that's actually a dead/parked/for-sale domain. Sending that
 * prospect an AI demo trained on "how do I buy this domain" would be a real
 * failure in front of a lead, so this gates the pipeline before it primes the
 * bot or sends anything.
 */
const PARKING_MARKETPLACE_TERMS = [
  "buy-it-now",
  "afternic",
  "godaddy checkout",
  "premium domain",
  "expired domain",
  "domain marketplace",
  "referring domains",
  "backlink profile",
  "secure checkout via godaddy",
  "escrow protection",
  "moz da",
  "brandable",
];

const REGISTRAR_BRAND_NAMES = ["expireddomains", "godaddy", "afternic", "sedo", "dan.com", "hugedomains"];

export function assessScrapeQuality(scrape) {
  const reasons = [];
  const haystack = `${scrape.heroText} ${scrape.rawTextSample}`.toLowerCase();

  const parkingHits = PARKING_MARKETPLACE_TERMS.filter((term) => haystack.includes(term));
  if (parkingHits.length >= 2) {
    reasons.push(`Reads like a domain-marketplace/parking page (matched: ${parkingHits.join(", ")}).`);
  }

  const nameLower = (scrape.businessName || "").toLowerCase();
  if (REGISTRAR_BRAND_NAMES.some((brand) => nameLower.includes(brand))) {
    reasons.push(`Extracted "business name" is a domain registrar/marketplace brand ("${scrape.businessName}"), not a real business.`);
  }

  if (!scrape.services.length && !scrape.phone && !scrape.faqPairs.length) {
    reasons.push("No services, phone, or FAQ content found at all — site may be down, parked, or under construction.");
  }

  return { ok: reasons.length === 0, reasons };
}
