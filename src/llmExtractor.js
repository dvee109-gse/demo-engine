import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const anthropic = config.llm.apiKey ? new Anthropic({ apiKey: config.llm.apiKey }) : null;

const RECORD_PROFILE_TOOL = {
  name: "record_business_profile",
  description:
    "Records a structured business profile extracted strictly from the provided scraped website text, for use as a sales-demo AI agent's knowledge base.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "2-4 sentence factual description of what the business does, using only what the text states.",
      },
      services: {
        type: "array",
        items: { type: "string" },
        description:
          "Concrete services or products the business offers, each a short phrase. Empty array if the text doesn't name any.",
      },
      faqPairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
          required: ["question", "answer"],
          additionalProperties: false,
        },
        description:
          "5-8 question/answer pairs a prospective customer would plausibly ask, answered using only facts stated in the text.",
      },
    },
    required: ["summary", "services", "faqPairs"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You extract a structured business profile from scraped website text. The output trains a sales-demo AI agent that will represent this business in conversations with its own prospective customers, so accuracy matters more than completeness.

Rules:
- Use only information stated or clearly implied in the provided text. Never invent services, pricing, locations, hours, or claims that aren't there.
- If the text doesn't support a plausible FAQ answer, don't include that question.
- Write in a neutral, factual tone — no marketing superlatives ("the best in town") unless directly quoted from the source.
- Call the record_business_profile tool exactly once with your result. Do not respond with plain text.`;

/**
 * Fills the gap the scraper's DOM heuristics can't: sites that don't structure
 * content as an explicit services list or FAQ section (see qualityGate.js /
 * the stress-test notes in the blueprint — cooperbuilthomes.com markets
 * through narrative, not a services page) still have the information in
 * prose. Returns null on any failure — contentBuilder.js already treats
 * services/faqPairs as optional and falls back to heroText + rawTextSample,
 * so a null here just means less enrichment, not a broken pipeline.
 */
export async function extractWithLLM(scrape) {
  if (!anthropic) {
    console.warn("[llmExtractor] ANTHROPIC_API_KEY not set — skipping LLM extraction pass.");
    return null;
  }
  if (!scrape.rawTextSample) {
    return null;
  }

  const userContent = [
    `Business name (from page metadata, may be wrong): ${scrape.businessName || "unknown"}`,
    scrape.heroText ? `Hero/description text: ${scrape.heroText}` : "",
    `Scraped site content:\n${scrape.rawTextSample}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response = await anthropic.messages.create({
      model: config.llm.model,
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: [RECORD_PROFILE_TOOL],
      tool_choice: { type: "tool", name: "record_business_profile" },
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") {
      console.warn("[llmExtractor] model declined the extraction request (stop_reason: refusal)");
      return null;
    }

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse) {
      console.warn("[llmExtractor] no tool_use block in response — unexpected given forced tool_choice");
      return null;
    }
    return toolUse.input;
  } catch (err) {
    // This SDK's TS error hierarchy (v0.65) has no APIStatusError — that's a
    // Python-only name. AnthropicError -> APIError -> {AuthenticationError,
    // RateLimitError, APIConnectionError, ...}, so APIError is the general base.
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("[llmExtractor] invalid ANTHROPIC_API_KEY");
    } else if (err instanceof Anthropic.RateLimitError) {
      console.warn("[llmExtractor] rate limited — skipping enrichment for this prospect");
    } else if (err instanceof Anthropic.APIConnectionError) {
      console.warn(`[llmExtractor] connection error: ${err.message}`);
    } else if (err instanceof Anthropic.APIError) {
      console.warn(`[llmExtractor] API error ${err.status}: ${err.message}`);
    } else {
      console.error(`[llmExtractor] unexpected error: ${err.message}`);
    }
    return null;
  }
}
