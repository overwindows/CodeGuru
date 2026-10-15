import fs from 'fs';

const html = fs.readFileSync('Q:/AgenticGem.PromptCatalog.html', 'utf8');
const d = JSON.parse(fs.readFileSync('Q:/CodeGuru/knowledgebase/raw/docs/agenticgem_catalog_storyline_angle.json','utf8'));
const entries = [...(d.entries||[]), ...(d.dlisEntries||[])];

const promptBase = "../Prompts/";
const schemaBase = "../JsonSchema/";

// Recreate the exact render logic for link hrefs
const hrefs = [];
for (const e of entries) {
  const promptHref = e.path.endsWith('.cs') ? '../'+e.path : promptBase + e.path;
  let schemaHref = null;
  if (e.schema && !e.schema.startsWith('无') && !e.schema.includes('contract') && e.schema.endsWith('.json')) {
    schemaHref = schemaBase + e.schema;
  }
  hrefs.push(promptHref);
  if (schemaHref) hrefs.push(schemaHref);
}

// Resolve each relative href from page location .../Doc/AgenticGem.PromptCatalog.html
// but host serves at /AgenticGem.PromptCatalog.html so base = /
function resolveFromRoot(href, pageDir) {
  // Simulate browser URL resolution
  const url = new URL(href, 'https://host/' + pageDir + '/AgenticGem.PromptCatalog.html');
  return url.pathname;
}
const pageDir = ''; // served at blob root
const paths = hrefs.map(h => resolveFromRoot(h, pageDir));

// Compare against the staged local mirror
const localMirror = 'Q:/AgenticGem_showcase/dist';
const missing = [];
for (const p of paths) {
  const file = localMirror + p;  // p starts with "/"
  if (!fs.existsSync(file)) {
    missing.push(p);
  }
}
console.log('computed hrefs:', hrefs.length);
console.log('unique resolved paths under web root:');
[...new Set(paths)].sort().forEach(p=>console.log('  ', p));
console.log(missing.length === 0 ? '\nALL RENDERED HREFS RESOLVE TO EXISTING FILES' : ('\nMISSING: '+missing.join(', ')));
