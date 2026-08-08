import "dotenv/config";

function required(name, value) {
  if (!value) {
    console.warn(`[config] ${name} is not set — related functionality will fail until it is.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  demoBaseUrl: (process.env.DEMO_BASE_URL || "").replace(/\/$/, ""),

  ghl: {
    pitToken: required("GHL_PIT_TOKEN", process.env.GHL_PIT_TOKEN),
    locationId: required("GHL_LOCATION_ID", process.env.GHL_LOCATION_ID),
    apiBaseUrl: process.env.GHL_API_BASE_URL || "https://services.leadconnectorhq.com",
    apiVersion: process.env.GHL_API_VERSION || "2021-07-28",
    kbApiVersion: process.env.GHL_KB_API_VERSION || "v3",
    knowledgeBaseId: required("GHL_KNOWLEDGE_BASE_ID", process.env.GHL_KNOWLEDGE_BASE_ID),
    agentId: required("GHL_AGENT_ID", process.env.GHL_AGENT_ID),
    chatWidgetEmbed: process.env.GHL_CHAT_WIDGET_EMBED || "",
    voiceNumber: process.env.GHL_VOICE_NUMBER || "",
    demoReadyWebhookUrl: required("GHL_DEMO_READY_WEBHOOK_URL", process.env.GHL_DEMO_READY_WEBHOOK_URL),
    needsReviewWebhookUrl: process.env.GHL_NEEDS_REVIEW_WEBHOOK_URL || "",

    // Custom field IDs from setup:fields — needed to write values into them
    // (GHL's contact customFields update takes field IDs, not fieldKeys).
    fieldIds: {
      websiteUrl: process.env.GHL_FIELD_WEBSITE_URL_ID || "",
      businessName: process.env.GHL_FIELD_BUSINESS_NAME_ID || "",
    },
  },

  inboundWebhookSecret: process.env.INBOUND_WEBHOOK_SECRET || "",

  // Optional: LLM extraction pass (src/llmExtractor.js) enriches services/FAQ
  // content for sites that don't structure it in scrapeable markup. Falls
  // back to DOM-only extraction if unset — see llmExtractor.js.
  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  },
};
