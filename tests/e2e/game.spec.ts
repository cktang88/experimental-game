import { test, expect, type Page } from '@playwright/test';

// These tests play the real game in Chromium. Combat runs with a test-only
// invulnerability flag and a sped-up clock so a fight finishes in seconds.
const SHOTS = 'test-results/shots';

async function startRun(page: Page, callsign = 'E2E') {
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Ghost\s*Dreadnought/i })).toBeVisible();
  await page.fill('#callsign', callsign);
  await page.click('#btn-new');
  await expect(page.locator('svg[aria-label^="Sector"]')).toBeVisible();
}
async function clickNode(page: Page, type?: string) {
  const sel = type ? `.node.reach[data-type="${type}"] circle.base` : '.node.reach circle.base';
  const node = page.locator(sel).first();
  await node.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const bb = (await node.boundingBox())!;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
}
const gd = <T>(page: Page, f: string) => page.evaluate(`(() => { const g = window.__gd; return ${f}; })()`) as Promise<T>;
async function fast(page: Page) { await gd(page, '(g.god(true), g.debug.timeScale = 8)'); }
async function winFight(page: Page) {
  await expect.poll(() => gd<string>(page, 'g.S.mode'), { timeout: 30_000 }).toBe('play');
  await fast(page);
  if (await gd<boolean>(page, "g.S.enc.kind === 'elite'")) await expect.poll(() => gd<boolean>(page, '!!g.S.elite'), { timeout: 30_000 }).toBe(true);
  await gd(page, 'g.winNow()');
}

test('title, map and a full fight with reward and refit', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('.registry')).toContainText(/online|offline/);
  await page.screenshot({ path: `${SHOTS}/01-title.png` });
  await page.fill('#callsign', 'E2E');
  await page.click('#btn-new');
  await expect(page.locator('svg[aria-label="Sector 1 route map"]')).toBeVisible();
  const types = await gd<string[]>(page, 'g.reachableTypes()');
  expect(types.length).toBeGreaterThan(1);
  expect(new Set(types)).toEqual(new Set(['fight']));
  await expect(page.locator('.card.intel')).toContainText(/Ghost of|defense core/);
  await page.screenshot({ path: `${SHOTS}/02-map.png` });

  await clickNode(page);
  await expect.poll(() => gd<string>(page, 'g.S.mode'), { timeout: 30_000 }).toBe('play');
  await gd(page, '(g.god(true), g.debug.timeScale = 4)');
  await expect.poll(() => gd<number>(page, 'g.S.enemies.length + g.S.eb.length'), { timeout: 60_000 }).toBeGreaterThan(2);
  await page.screenshot({ path: `${SHOTS}/03-combat.png` });
  await expect.poll(() => gd<number>(page, 'g.S.kills'), { timeout: 60_000 }).toBeGreaterThan(0);
  const scrapBefore = await gd<number>(page, 'g.run.scrap');
  await gd(page, 'g.winNow()');
  await expect(page.getByRole('heading', { name: 'Salvage' })).toBeVisible({ timeout: 60_000 });
  expect(await gd<number>(page, 'g.run.scrap')).toBeGreaterThanOrEqual(scrapBefore);
  await page.screenshot({ path: `${SHOTS}/04-reward.png` });
  const invBefore = await gd<number>(page, 'g.run.inv.length');
  await page.locator('.pcard').first().click();
  await expect(page.locator('.toast')).toContainText('cargo hold');
  expect(await gd<number>(page, 'g.run.inv.length')).toBe(invBefore + 1);
  expect(await gd<number>(page, 'g.run.visited.length')).toBe(1);

  // Refit: mount the starter armor plate into the empty engine bay.
  await page.click('#btn-refit');
  await expect(page.getByRole('heading', { name: 'Refit ship' })).toBeVisible();
  const plateIdx = await gd<number>(page, "g.run.inv.findIndex(p => p.id === 'plate')");
  await page.click(`[data-inv="${plateIdx}"]`);
  await page.locator('.slot.empty.target').first().click();
  await expect(page.locator('.toast')).toContainText('mounted');
  expect(await gd<boolean>(page, "g.run.build.sections.some(s => s.slots.some(p => p && p.id === 'plate'))")).toBe(true);
  await page.screenshot({ path: `${SHOTS}/05-refit.png`, fullPage: true });
  await page.click('#btn-done');
  await expect(page.locator('svg[aria-label="Sector 1 route map"]')).toBeVisible();
});

test('merchant, event, drydock, derelict and elite nodes', async ({ page }) => {
  await startRun(page);
  await gd(page, 'g.addScrap(2000)');

  // merchant
  await gd(page, "g.forceNext('merchant')");
  await expect(page.getByRole('heading', { name: 'Merchant' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-merchant.png`, fullPage: true });
  const inv0 = await gd<number>(page, 'g.run.inv.length');
  await page.locator('.pcard:not([disabled])').first().click();
  expect(await gd<number>(page, 'g.run.inv.length')).toBe(inv0 + 1);
  const secs0 = await gd<number>(page, 'g.run.build.sections.length');
  await page.locator('button.pcard', { hasText: /hull ·/ }).first().click();
  expect(await gd<number>(page, 'g.run.build.sections.length')).toBe(secs0 + 1);
  await page.click('#btn-leave');

  // event
  await gd(page, "g.forceNext('event')");
  await expect(page.locator('.eyebrow', { hasText: 'Unknown signal' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-event.png` });
  await page.locator('.choice:not([disabled])').first().click();
  await expect(page.locator('.outcome')).toBeVisible();
  if (await page.getByRole('button', { name: 'Engage' }).isVisible()) {
    await page.getByRole('button', { name: 'Engage' }).click();
    await winFight(page);
    await expect(page.getByRole('heading', { name: 'Salvage' })).toBeVisible({ timeout: 60_000 });
    await page.locator('.pcard').first().click();
  } else await page.click('#btn-continue');
  await expect(page.locator('svg[aria-label^="Sector"]')).toBeVisible();

  // drydock: upgrade a part
  await gd(page, "g.forceNext('drydock')");
  await expect(page.getByRole('heading', { name: 'Drydock' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-drydock.png` });
  const tiers0 = await gd<number>(page, 'g.run.build.sections.flatMap(s => s.slots).concat(g.run.inv).reduce((a, p) => a + (p ? p.tier : 0), 0)');
  await page.click('#dock-upgrade');
  await page.locator('.pcard').first().click();
  expect(await gd<number>(page, 'g.run.build.sections.flatMap(s => s.slots).concat(g.run.inv).reduce((a, p) => a + (p ? p.tier : 0), 0)')).toBe(tiers0 + 1);

  // derelict: relic
  const relics0 = await gd<number>(page, 'g.run.relics.length');
  await gd(page, "g.forceNext('derelict')");
  await page.click('#btn-open');
  await expect(page.getByRole('heading', { name: 'Strongroom opened' })).toBeVisible();
  expect(await gd<number>(page, 'g.run.relics.length')).toBe(relics0 + 1);
  await page.click('#btn-continue');

  // elite
  await gd(page, "g.forceNext('elite')");
  await expect.poll(() => gd<string>(page, 'g.S.mode'), { timeout: 30_000 }).toBe('play');
  await gd(page, '(g.god(true), g.debug.timeScale = 4)');
  await expect.poll(() => gd<boolean>(page, '!!g.S.elite'), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/09-elite.png` });
  await gd(page, 'g.winNow()');
  await expect(page.getByRole('heading', { name: 'Salvage' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Relic recovered' })).toBeVisible();
  expect(await gd<number>(page, 'g.run.stats.elites')).toBe(1);
});

test('boss fight leads to salvage, relic and the next sector', async ({ page }) => {
  await startRun(page);
  await gd(page, "(() => { const r = g.run; const n = Object.values(r.map.nodes).find(n => n.floor === 9); r.at = n.id; r.visited.push(n.id); })()");
  await expect.poll(() => gd<boolean>(page, '!!g.run.bossGhost'), { timeout: 15_000 }).toBe(true);
  await gd(page, "g.travelTo('boss')");
  await expect.poll(() => gd<string>(page, 'g.S.mode'), { timeout: 30_000 }).toBe('play');
  await gd(page, '(g.god(true), g.debug.timeScale = 6)');
  await expect.poll(() => gd<boolean>(page, '!!(g.S.boss && g.S.boss.entered)'), { timeout: 90_000 }).toBe(true);
  await gd(page, '(g.god(true), g.debug.timeScale = 6)');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}/10-boss.png` });
  await gd(page, 'g.winNow()');
  await expect(page.getByRole('heading', { name: /^Salvage:/ })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/11-boss-salvage.png` });
  await page.locator('.pcard').first().click();
  await expect(page.getByRole('heading', { name: 'Choose a relic' })).toBeVisible();
  await page.locator('.pcard').first().click();
  await expect(page.locator('svg[aria-label="Sector 2 route map"]')).toBeVisible();
  expect(await gd<number>(page, 'g.run.stats.bosses')).toBe(1);
});

test('dying uploads a ghost that becomes the next boss', async ({ page, request }) => {
  const name = `GHOST${Date.now() % 100000}`;
  await startRun(page, name);
  await clickNode(page);
  await expect.poll(() => gd<string>(page, 'g.S.mode'), { timeout: 30_000 }).toBe('play');
  await gd(page, 'g.killPlayer()');
  await expect(page.getByRole('heading', { name: 'Dreadnought down' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('ghost-status')).toContainText('Pilots who reach', { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/12-death.png` });
  const res = await request.get('/api/ghosts?sector=1');
  const body = await res.json();
  expect(body.count).toBeGreaterThan(0);
  // Fresh run from the same browser: the only ghost may be our own, which the boss pool still allows.
  await page.click('#btn-again');
  await page.fill('#callsign', 'E2E');
  await page.click('#btn-new');
  await expect(page.locator('.card.intel')).toContainText('Ghost of', { timeout: 15_000 });
});

test('a run survives a reload and can be continued', async ({ page }) => {
  await startRun(page);
  await clickNode(page);
  await winFight(page);
  await expect(page.getByRole('heading', { name: 'Salvage' })).toBeVisible({ timeout: 60_000 });
  await page.locator('.pcard').first().click();
  const scrap = await gd<number>(page, 'Math.floor(g.run.scrap)');
  await page.reload();
  await expect(page.locator('#btn-continue')).toBeVisible();
  await page.click('#btn-continue');
  await expect(page.locator('svg[aria-label="Sector 1 route map"]')).toBeVisible();
  expect(await gd<number>(page, 'g.run.visited.length')).toBe(1);
  expect(await gd<number>(page, 'Math.floor(g.run.scrap)')).toBe(scrap);
});

test('phone layout has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startRun(page);
  await page.screenshot({ path: `${SHOTS}/13-phone-map.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await clickNode(page);
  await expect.poll(() => gd<string>(page, 'g.S.mode'), { timeout: 30_000 }).toBe('play');
  await gd(page, '(g.god(true), g.debug.timeScale = 4)');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/14-phone-combat.png` });
});
