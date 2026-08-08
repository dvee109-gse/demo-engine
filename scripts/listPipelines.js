import { listPipelines } from "../src/ghlAdmin.js";

// Run this after you've manually built the pipeline in the GHL UI (there's no
// create-pipeline API — see the note in ghlAdmin.js). Prints IDs to paste into
// .env as GHL_PIPELINE_ID / GHL_STAGE_*_ID for seedTestLead.js.
async function main() {
  const data = await listPipelines();
  const pipelines = data.pipelines || data;

  for (const p of pipelines) {
    console.log(`\n${p.name}  (pipelineId: ${p.id})`);
    for (const s of p.stages || []) {
      console.log(`  - ${s.name}  (stageId: ${s.id})`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
