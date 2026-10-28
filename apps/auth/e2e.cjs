const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const origin = process.argv[2] || 'http://localhost:3008', browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [], requested = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requested.push(request.url()));
    await page.goto(origin);
    await page.waitForTimeout(300);
    assert.ok(!(await page.content()).includes('optz-island'));
    assert.ok(!requested.some(url => url.includes('/api/auth')));
    const landingRequests = [...requested];
    await page.goto(origin + '/login');
    const panel = page.locator('.auth-panel');
    await panel.getByLabel('Authenticator code', { exact: true }).fill('123456');
    await panel.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.trim());
    assert.ok(requested.some(url => url.includes('/api/auth/two-factor/verify-totp')));
    assert.equal((await page.request.get(origin + '/api/auth/get-session')).status(), 200);
    const privatePage = await page.request.get(origin + '/account');
    assert.equal(privatePage.status(), 401);
    assert.ok(privatePage.headers()['cache-control'].includes('no-store'));
    assert.deepEqual(errors, []);
    console.log('PASS OPTZ auth example: static public page, hydrated auth island, API mount and private loader');
    console.log(JSON.stringify({ landingRequests: landingRequests.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
