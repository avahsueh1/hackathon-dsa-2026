// Copies the Python pipeline's output into the app so `npm run dev` works on a
// fresh clone. data/out/ is generated and gitignored; app/src/data/ is the
// committed snapshot the app builds against.
//
// Rebuild the pipeline (python scripts/rebuild_all.py) then run this to adopt
// a new zone model.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "..", "..", "data", "out");
const to = resolve(here, "..", "src", "data");

// zones + geometry are what the app renders. The rest are read by the analysis
// screens, which are parked -- they are copied so turning them back on is a
// component, not a data migration.
const FILES = ["zones.json", "geometry.json", "shelters.json", "health.json", "plan.json"];

mkdirSync(to, { recursive: true });

let copied = 0;
let kept = 0;
for (const f of FILES) {
  const src = join(from, f);
  const dst = join(to, f);
  if (existsSync(src)) {
    copyFileSync(src, dst);
    console.log(`  ${f}  ${(statSync(dst).size / 1024).toFixed(0)} KB`);
    copied++;
  } else if (existsSync(dst)) {
    // No pipeline output on this machine (a teammate who only cloned the repo).
    // The committed snapshot is the fallback, not an error.
    kept++;
  } else {
    console.error(`  MISSING ${f} -- run: python scripts/rebuild_all.py`);
    process.exit(1);
  }
}
console.log(`sync:data  ${copied} copied, ${kept} already present`);
