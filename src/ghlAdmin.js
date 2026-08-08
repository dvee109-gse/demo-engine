import { config } from "./config.js";

/**
 * Client for GHL's core v2 CRM endpoints (Locations/Custom Fields/Contacts/
 * Opportunities/Pipelines) — separate from ghlClient.js, which talks to the
 * Conversation AI / Knowledge Base APIs under a different version header.
 *
 * IMPORTANT — what GHL's API can and can't do here (confirmed against their docs
 * and public API-parity trackers as of this build):
 *   - Custom Fields: full create/read API. Scriptable — see setupCustomFields.js.
 *   - Contacts, Opportunities: full create/read/update API. Scriptable.
 *   - Pipelines: READ ONLY. There is no create-pipeline/create-stage endpoint —
 *     GHL's own issue tracker confirms this is a requested-but-unshipped feature.
 *     You must create the pipeline and its stages by hand in the GHL UI; use
 *     listPipelines.js afterward to pull the IDs into your .env.
 *   - Workflows: NO API AT ALL — not even read. Every workflow in the "GHL Setup
 *     Runbook" (see the blueprint artifact) has to be built by hand in the UI.
 *     This is a hard platform limitation, not a gap in this scaffold.
 */

async function ghlAdminRequest(path, { method = "GET", body, query } = {}) {
  const url = new URL(`${config.ghl.apiBaseUrl}${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.ghl.pitToken}`,
      Version: config.ghl.apiVersion,
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

/** dataType: TEXT | LARGE_TEXT | NUMERICAL | PHONE | CHECKBOX | SINGLE_OPTIONS | DATE ...
 *  model: "contact" | "opportunity". Field names best-known from GHL's v1/v2 custom
 *  field schema — verify against your API reference if this 400s. */
export async function createCustomField({ name, dataType, model = "contact", placeholder = "" }) {
  return ghlAdminRequest(`/locations/${config.ghl.locationId}/customFields`, {
    method: "POST",
    body: { name, dataType, model, placeholder },
  });
}

export async function listCustomFields(model = "contact") {
  return ghlAdminRequest(`/locations/${config.ghl.locationId}/customFields`, {
    query: { model },
  });
}

export async function listPipelines() {
  return ghlAdminRequest("/opportunities/pipelines", {
    query: { locationId: config.ghl.locationId },
  });
}

export async function createContact({ firstName, lastName, email, phone, businessName, websiteUrl }) {
  // Confirmed live (2026-08-08): customFields takes [{id, value}] — field IDs
  // (from setup:fields output), not fieldKeys. companyName alone does NOT
  // populate the Website URL / Business Name custom fields, which is what
  // the GHL workflow's {{contact.website_url}} / {{contact.business_name}}
  // merge tags actually read from.
  const customFields = [];
  if (config.ghl.fieldIds.websiteUrl && websiteUrl) {
    customFields.push({ id: config.ghl.fieldIds.websiteUrl, value: websiteUrl });
  }
  if (config.ghl.fieldIds.businessName && businessName) {
    customFields.push({ id: config.ghl.fieldIds.businessName, value: businessName });
  }

  return ghlAdminRequest("/contacts/", {
    method: "POST",
    body: {
      locationId: config.ghl.locationId,
      firstName,
      lastName,
      email,
      phone,
      companyName: businessName,
      customFields,
    },
  });
}

export async function createOpportunity({ pipelineId, stageId, contactId, name }) {
  return ghlAdminRequest("/opportunities/", {
    method: "POST",
    body: {
      locationId: config.ghl.locationId,
      pipelineId,
      pipelineStageId: stageId,
      contactId,
      name,
      status: "open",
    },
  });
}
