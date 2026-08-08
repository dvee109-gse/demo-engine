import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "templates", "demo-page.html");
const OUTPUT_DIR = path.join(__dirname, "..", "public", "demos");

/** Minimal {{var}} + {{#if var}}...{{/if}} renderer — deliberately not pulling in a template engine dependency for this. */
function render(template, data) {
  let out = template.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) =>
    data[key] ? inner : ""
  );
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
  return out;
}

function slugify(businessName, contactId) {
  const base = (businessName || "prospect")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base}-${contactId}`.slice(0, 80);
}

/** Renders the per-contact demo page from the template and returns its public URL. */
export async function buildDemoPage({ contactId, variables, beaconUrl }) {
  const template = await readFile(TEMPLATE_PATH, "utf8");
  const slug = slugify(variables.businessName, contactId);

  const html = render(template, {
    businessName: variables.businessName,
    logoUrl: variables.logoUrl,
    primaryColor: variables.primaryColor || "#1a1a1a",
    heroText: variables.heroText,
    voiceNumber: config.ghl.voiceNumber,
    chatWidgetEmbed: config.ghl.chatWidgetEmbed,
    beaconUrl: beaconUrl || "",
    contactId,
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, `${slug}.html`), html, "utf8");

  return `${config.demoBaseUrl}/demos/${slug}.html`;
}
