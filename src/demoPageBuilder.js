import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "templates", "demo-page.html");

/** Minimal {{var}} + {{#if var}}...{{/if}} renderer — deliberately not pulling in a template engine dependency for this. */
function render(template, data) {
  let out = template.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) =>
    data[key] ? inner : ""
  );
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
  return out;
}

// Render is deliberately NOT written to disk here. Render's free tier (and most
// container PaaS free tiers) has an ephemeral filesystem — anything written at
// runtime is wiped on the next restart, and this app restarts constantly (every
// cold-start spin-down/wake-up, every redeploy). A file that existed 5 minutes
// ago can be gone by the time a prospect clicks the email link. Instead, the
// per-contact variables needed to render the page are persisted to GHL (durable)
// via saveDemoPageData(), and the page is rendered fresh on every request —
// see server.js's GET /demos/:contactId route, which calls renderDemoPage().

/** Pure template render — no I/O. Returns the HTML string for one contact's demo page. */
export async function renderDemoPage(variables, { contactId, beaconUrl }) {
  const template = await readFile(TEMPLATE_PATH, "utf8");
  return render(template, {
    businessName: variables.businessName,
    logoUrl: variables.logoUrl,
    primaryColor: variables.primaryColor || "#1a1a1a",
    heroText: variables.heroText,
    chatWidgetEmbed: config.ghl.chatWidgetEmbed,
    voiceWidgetEmbed: config.ghl.voiceWidgetEmbed,
    beaconUrl: beaconUrl || "",
    contactId,
  });
}

/** The short-code link (see server.js's /d/:code route) — this is the one
 * that actually gets emailed to prospects. Short and typeable by hand, unlike
 * the long /demos/{contactId} URL, which is painful to type manually and is
 * the only workaround for a rare but real connection issue some networks hit
 * on the first tap of a link (confirmed live, 2026-08-25). */
export function getDemoUrl(shortCode) {
  return `${config.demoBaseUrl}/d/${shortCode}`;
}
