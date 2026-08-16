import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const SUBPAGE_KEYWORDS = {
  about: ["about", "who we are", "our story"],
  services: ["service", "what we do", "solutions"],
  faq: ["faq", "frequently asked", "questions"],
  contact: ["contact", "reach us", "get in touch"],
};

const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/** Pulls the DOM signals we need for a knowledge base + demo page out of one loaded page. */
async function extractFromPage(page) {
  return page.evaluate(() => {
    const text = (el) => (el ? el.textContent.trim().replace(/\s+/g, " ") : "");
    const meta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.content ||
      document.querySelector(`meta[property="${name}"]`)?.content ||
      "";

    const title = document.title || "";
    const ogSiteName = meta("og:site_name");
    const metaDescription = meta("description") || meta("og:description");
    const themeColor = meta("theme-color");

    const h1 = text(document.querySelector("h1"));

    let logoUrl = "";
    const logoImg = document.querySelector(
      "header img[src*='logo' i], img[class*='logo' i], img[alt*='logo' i], a[class*='brand' i] img"
    );
    if (logoImg) logoUrl = logoImg.src;
    if (!logoUrl) {
      const icon = document.querySelector("link[rel='icon'], link[rel='shortcut icon']");
      if (icon) logoUrl = new URL(icon.getAttribute("href"), window.location.href).href;
    }

    // FAQ-shaped content: <details>/<summary>, or dt/dd pairs, or heading+following-paragraph
    // near anything mentioning "faq"/"question".
    const faqPairs = [];
    document.querySelectorAll("details").forEach((d) => {
      const q = text(d.querySelector("summary"));
      const a = text(d);
      if (q && a) faqPairs.push({ question: q, answer: a.replace(q, "").trim() });
    });
    const dts = document.querySelectorAll("dt");
    dts.forEach((dt) => {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") {
        const q = text(dt);
        const a = text(dd);
        if (q && a) faqPairs.push({ question: q, answer: a });
      }
    });

    // Services: list items under a heading that mentions "service"/"solutions"/"what we do".
    const services = new Set();
    document.querySelectorAll("h1,h2,h3").forEach((h) => {
      const heading = text(h).toLowerCase();
      if (/(service|solution|what we do|offer)/.test(heading)) {
        let sib = h.nextElementSibling;
        let hops = 0;
        while (sib && hops < 4) {
          sib.querySelectorAll?.("li").forEach((li) => {
            const t = text(li);
            if (t && t.length < 120) services.add(t);
          });
          if (sib.tagName === "UL" || sib.tagName === "OL") break;
          sib = sib.nextElementSibling;
          hops++;
        }
      }
    });

    // document.body.textContent includes the text content of any <style>/<script>
    // tags nested inside body (common on Squarespace/Webflow-style builders that
    // inject scoped CSS as inline body elements) — strip those before reading text,
    // or the "content" is mostly CSS custom-property declarations.
    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll("style,script,noscript").forEach((el) => el.remove());
    const bodyText = text(bodyClone).slice(0, 6000);
    const telLink = document.querySelector("a[href^='tel:']");
    const telHref = telLink ? telLink.getAttribute("href").replace("tel:", "") : "";

    return {
      title,
      ogSiteName,
      metaDescription,
      themeColor,
      h1,
      logoUrl,
      faqPairs,
      services: Array.from(services),
      bodyText,
      telHref,
    };
  });
}

function findSubpageLinks(baseUrl, anchors) {
  const found = {};
  for (const [key, keywords] of Object.entries(SUBPAGE_KEYWORDS)) {
    const match = anchors.find(({ text, href }) =>
      keywords.some((kw) => text.toLowerCase().includes(kw))
    );
    if (match) {
      try {
        found[key] = new URL(match.href, baseUrl).href;
      } catch {
        /* ignore malformed hrefs */
      }
    }
  }
  return found;
}

/**
 * Scrapes a prospect's site: homepage plus up to 4 linked subpages (about/services/faq/contact).
 * Returns a flat bag of raw signals for contentBuilder.js to structure into KB content.
 */
export async function scrapeSite(url, { timeoutMs = 20000 } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (compatible; DemoEngineBot/0.1; +https://example.com/bot) Chrome/120",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // Playwright does NOT throw on HTTP error responses (403, 404, 500, ...) —
    // only on network-level failures (DNS, connection refused, etc.). Without
    // this check, a blocked/broken site's error page gets scraped as if it were
    // real content — e.g. "403 - Forbidden" ending up as the extracted business
    // name. Ground-truth signal is the response status, not text pattern matching.
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const httpStatus = response?.status() ?? null;
    const home = await extractFromPage(page);

    const anchors = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        text: a.textContent.trim(),
        href: a.getAttribute("href"),
      }))
    );
    const subpages = findSubpageLinks(url, anchors);

    const pages = { home };
    for (const [key, href] of Object.entries(subpages)) {
      try {
        await page.goto(href, { waitUntil: "domcontentloaded" });
        pages[key] = await extractFromPage(page);
      } catch (err) {
        console.warn(`[scraper] failed to load ${key} page (${href}): ${err.message}`);
      }
    }

    const phoneMatch =
      home.telHref?.match(PHONE_RE)?.[0] ||
      [home, ...Object.values(pages)].map((p) => p?.bodyText || "").join(" ").match(PHONE_RE)?.[0] ||
      "";

    const businessName = (home.ogSiteName || home.h1 || home.title || "").trim();

    const faqPairs = [home, ...Object.values(pages)]
      .flatMap((p) => p?.faqPairs || [])
      .filter((f, i, arr) => arr.findIndex((x) => x.question === f.question) === i)
      .slice(0, 25);

    const services = Array.from(
      new Set([home, ...Object.values(pages)].flatMap((p) => p?.services || []))
    ).slice(0, 20);

    return {
      sourceUrl: url,
      httpStatus,
      businessName,
      logoUrl: home.logoUrl,
      primaryColor: home.themeColor || "",
      heroText: home.metaDescription || home.h1 || "",
      phone: phoneMatch,
      services,
      faqPairs,
      rawTextSample: [home.bodyText, pages.about?.bodyText].filter(Boolean).join("\n\n").slice(0, 8000),
    };
  } finally {
    await browser.close();
  }
}

// Allows: node src/scraper.js https://example.com
// (compared as file:// URLs, not raw paths — a straight string comparison
// breaks on Windows, where argv[1] uses backslashes and import.meta.url doesn't)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node src/scraper.js <url>");
    process.exit(1);
  }
  scrapeSite(url)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
