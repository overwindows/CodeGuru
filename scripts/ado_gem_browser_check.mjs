// Load the live AgenticGem catalog, wait for client-side rendering, collect
// every rendered link and asset, then request each URL and report its status.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DEFAULT_PAGE =
  'https://agreeable-bush-035f3c510.4.azurestaticapps.net/AgenticGem.PromptCatalog.html';
const pageUrl = process.env.AGENTIC_GEM_PAGE ?? DEFAULT_PAGE;
const cdpEndpoint = process.env.EDGE_CDP_URL;
const outputPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '_dom_urls.json',
);

let browser;
let externalBrowser = false;
let page;

try {
  if (cdpEndpoint) {
    browser = await chromium.connectOverCDP(cdpEndpoint);
    externalBrowser = true;
    console.log(`using signed-in browser at ${cdpEndpoint}`);
  } else {
    browser = await chromium.launch({ headless: true });
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  page = await context.newPage();

  page.on('console', message => {
    if (message.type() === 'error') {
      console.log('[console.error]', message.text());
    }
  });
  page.on('pageerror', error => console.log('[pageerror]', error.message));

  const response = await page.goto(pageUrl, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  const status = response?.status();
  console.log('initial page status:', status ?? 'no response');

  if (!response || status < 200 || status >= 400) {
    throw new Error(`Catalog request failed with HTTP ${status ?? 'unknown'}`);
  }

  const finalUrl = page.url();
  if (
    finalUrl.includes('login.microsoftonline.com') ||
    finalUrl.includes('/.auth/login/')
  ) {
    throw new Error(
      'Catalog requires Microsoft sign-in. Start Edge with ' +
        '--remote-debugging-port=9222, sign in to the catalog, then set ' +
        'EDGE_CDP_URL=http://localhost:9222 and rerun this script.',
    );
  }

  await page.waitForSelector('#catalog .entry', { timeout: 30_000 });
  const entryCount = await page.locator('#catalog .entry').count();
  console.log('rendered .entry count:', entryCount);
  if (entryCount === 0) {
    throw new Error('Catalog loaded but rendered no entries');
  }

  const urls = await page.locator('a[href], link[href], script[src]').evaluateAll(
    elements =>
      elements
        .map(element => element.href || element.src)
        .filter(url => /^https?:\/\//i.test(url)),
  );
  const unique = [...new Set(urls)];
  console.log('\nunique link/asset URLs in rendered DOM:', unique.length);
  fs.writeFileSync(outputPath, JSON.stringify(unique, null, 2));

  let ok = 0;
  const failures = [];
  for (const url of unique) {
    try {
      const linkResponse = await page.request.get(url);
      if (linkResponse.ok()) {
        ok++;
      } else {
        failures.push([url, linkResponse.status()]);
      }
    } catch (error) {
      failures.push([url, `ERR ${error.message.slice(0, 60)}`]);
    }
  }

  console.log(`request check: ok=${ok} fail=${failures.length}`);
  for (const [url, code] of failures) {
    console.log('  FAIL', code, url);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    console.log(`\n${failures.length} FAILED`);
  } else {
    console.log('\nDEFINITIVE: ALL RENDERED DOM LINKS RESOLVE SUCCESSFULLY');
  }
} catch (error) {
  process.exitCode = 1;
  console.error(`CHECK FAILED: ${error.message}`);
} finally {
  await page?.close().catch(() => {});
  if (browser && !externalBrowser) {
    await browser.close();
  }
}
