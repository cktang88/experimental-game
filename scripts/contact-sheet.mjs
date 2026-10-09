// Screenshots a kit contact sheet: node scripts/contact-sheet.mjs <kit> [filter] [out.png] [cols] [view]
// Needs the dev server running (npm run dev). Set CHROMIUM_PATH to use a preinstalled browser.
import { chromium } from 'playwright';
const [kit = 'city', filter = '.', out = `test-results/contact-${kit}.png`, cols = '8', view = 'iso'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1800, height: 1200 } });
p.on('pageerror', (e) => console.error(e.message));
await p.goto(`http://localhost:${process.env.GD_WEB_PORT || 5173}/tools/contact.html?kit=${kit}&filter=${encodeURIComponent(filter)}&cols=${cols}&view=${view}`);
await p.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
await p.screenshot({ path: out });
console.log(out);
await b.close();
