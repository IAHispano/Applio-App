// Disposable browser captures for render-demo.py. Requires Playwright and an
// installed browser; --runtime can point to a separate node_modules directory.
// Start Applio with pnpm dev before running this script.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  runtime: { type: 'string' },
  browser: { type: 'string', default: 'msedge' },
  url: { type: 'string', default: 'http://localhost:3000' },
  output: { type: 'string', default: '.cache/demo-source' },
} });
const require = createRequire(import.meta.url);
const { chromium } = require(values.runtime ? path.resolve(values.runtime, 'playwright') : 'playwright');
const output = path.resolve(values.output);
fs.mkdirSync(output, { recursive: true });
// Synthetic browser devices keep this presentation capture away from the
// user's microphone. No audio is recorded or streaming session started.
const browser = await chromium.launch({ headless: true, channel: values.browser,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1, colorScheme: 'dark', permissions: ['microphone'] });
  const page = await context.newPage();
  async function open(route) {
    await page.goto(new URL(route, values.url).href, { waitUntil: 'networkidle' });
    // Presentation only: suppress the first-run overlay in this disposable
    // context without accepting terms or modifying the user's preferences.
    await page.addStyleTag({ content: '[aria-labelledby="terms-modal-title"] {display:none!important} nextjs-portal {display:none!important}' });
    await page.waitForTimeout(1100);
  }
  async function capture(name) {
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    console.log(`Captured ${name}`);
  }
  await open('/'); await capture('home');
  await open('/inference'); await capture('inference');
  await page.getByRole('tab', { name: 'Batch', exact: true }).click();
  await page.waitForTimeout(700); await capture('batch');
  await page.locator('#batch-mode').click();
  await page.waitForTimeout(250); await capture('batch-modes');
  await open('/realtime'); await capture('realtime');
  await page.getByText('Latency / VAD / gains', { exact: true }).click();
  await page.getByText('FP16 HiFi-GAN decoder (CUDA)', { exact: true })
    .evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500); await capture('realtime-tuning');
  await open('/models'); await capture('models');
  await open('/train'); await capture('training');
} finally {
  await browser.close();
}
