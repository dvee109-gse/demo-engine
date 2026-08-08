/**
 * Option A runs one shared bot re-primed per prospect, which means two demos
 * "in flight" at once can bleed into each other (see blueprint §1/§7). This just
 * tracks who's currently primed so the server can warn you, not prevent it —
 * swap for a real per-prospect sub-account (Option B) once that overlap starts
 * costing you demos.
 */
let primed = null;

export function markPrimed(contactId, businessName) {
  if (primed && primed.contactId !== contactId) {
    const ageMin = Math.round((Date.now() - primed.at) / 60000);
    console.warn(
      `[store] Overwriting KB primed for ${primed.businessName} (${ageMin}m ago) with ${businessName}. ` +
        `If ${primed.businessName}'s demo link is still being viewed, they'll now see ${businessName}'s data.`
    );
  }
  primed = { contactId, businessName, at: Date.now() };
}

export function getPrimed() {
  return primed;
}
