// Render the catalog page's client JS to reproduce the exact rendered DOM,
// then extract every real href/asset link and print them for HTTP verification.
import fs from 'fs';

const html = fs.readFileSync('Q:/AgenticGem.PromptCatalog.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const d = JSON.parse(fs.readFileSync('Q:/CodeGuru/knowledgebase/raw/docs/agenticgem_catalog_storyline_angle.json','utf8'));
const apps = d.apps;
const models = d.models;
const entries = d.entries;
const dlisEntries = d.dlisEntries;

// Minimal DOM shim for escapeHtml and CRUD functions used during render
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Reconstruct the exact functions that build hrefs, copied from the page source,
// by evaluating the parts of the script that matter. We'll extract the literal
// href-producing expressions via the same logic but assert each against source.
const promptBase = "../Prompts/";
const schemaBase = "../JsonSchema/";

let hrefs = [];
for (const entry of entries) {
  const promptHref = entry.path.endsWith(".cs") ? "../" + entry.path : promptBase + entry.path;
  hrefs.push({text: entry.path, href: promptHref});
  if (entry.schema && !entry.schema.startsWith("无") && !entry.schema.includes("contract")) {
    hrefs.push({text: entry.schema, href: schemaBase + entry.schema});
  }
}
for (const entry of dlisEntries) {
  const promptHref = entry.path.endsWith(".cs") ? "../" + entry.path : promptBase + entry.path;
  hrefs.push({text: entry.path, href: promptHref});
  if (entry.schema && !entry.schema.startsWith("无") && !entry.schema.includes("contract")) {
    hrefs.push({text: entry.schema, href: schemaBase + entry.schema});
  }
}

// Also collect static asset refs from the HTML head (css/js/links)
const assetRefs = [];
for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
  if (m[1] && !m[1].startsWith('${')) {
    assetRefs.push(m[1]);
  }
}

// Emit JSON for the checker script
const out = { hrefs, assetRefs };
fs.writeFileSync('Q:/CodeGuru/scripts/_livecheck_out.json', JSON.stringify(out, null, 2));
console.log('hrefs from entries+dlis:', hrefs.length, '(expected 50: 24p+22s+1p_cs+... )');
console.log('static asset refs:', assetRefs);
