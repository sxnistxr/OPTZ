const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');

(async () => {
  const server = spawn(process.env.BUN_EXECUTABLE || 'bun', ['test/browser-server.ts'], { cwd: require('node:path').join(__dirname, '..'), stdio: ['ignore', 'pipe', 'inherit'] });
  let browser;
  try {
    const [line] = await Promise.race([once(server.stdout, 'data'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 15000); timer.unref(); })]);
    const { origin } = JSON.parse(String(line));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(), page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(origin);
    await page.waitForFunction(() => !!window.auth);
    const api = (path, body) => page.evaluate(async ({ path, body }) => {
      const r = await fetch('/api/auth' + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, data: await r.json().catch(() => null) };
    }, { path, body });
    const password = 'browser test password with sufficient length';
    assert.equal((await api('/sign-up/email', { email: 'passkey@example.test', password, name: 'Passkey User' })).status, 200);
    const messages = await (await fetch(origin + '/test-mailbox')).json();
    await page.goto(messages[0].url); await page.goto(origin); await page.waitForFunction(() => !!window.auth);
    assert.equal((await api('/sign-in/email', { email: 'passkey@example.test', password })).status, 200);
    const registration = await page.evaluate(() => window.auth.passkey.addPasskey({ name: 'Virtual passkey' }));
    assert.equal(registration.error, null, JSON.stringify(registration.error));
    assert.equal((await api('/passkey/list-user-passkeys')).data.length, 1);
    await api('/sign-out', {});
    assert.equal((await api('/get-session')).data, null);
    const login = await page.evaluate(() => window.auth.signIn.passkey());
    assert.equal(login.error, null, JSON.stringify(login.error));
    assert.equal((await api('/get-session')).data.user.email, 'passkey@example.test');

    // Server verification must reject a credential response without the UV flag, even if a
    // malicious client changes the browser's requested userVerification to "discouraged".
    await api('/sign-out', {});
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    const rejected = await page.evaluate(async () => {
      const options = await (await fetch('/api/auth/passkey/generate-authenticate-options')).json();
      const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const encoded = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: bytes(options.challenge), userVerification: 'discouraged', allowCredentials: options.allowCredentials?.map(c => ({ ...c, id: bytes(c.id) })) } });
      const r = await fetch('/api/auth/passkey/verify-authentication', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: { id: credential.id, rawId: encoded(credential.rawId), type: credential.type, clientExtensionResults: credential.getClientExtensionResults(), response: { authenticatorData: encoded(credential.response.authenticatorData), clientDataJSON: encoded(credential.response.clientDataJSON), signature: encoded(credential.response.signature), userHandle: credential.response.userHandle ? encoded(credential.response.userHandle) : null } } }) });
      return r.status;
    });
    assert.ok(rejected >= 400, `UV bypass returned ${rejected}`);
    assert.equal((await api('/get-session')).data, null);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    await api('/sign-in/email', { email: 'passkey@example.test', password });
    const enrollment = await api('/two-factor/enable', { password });
    assert.equal(enrollment.status, 200);
    // Generate RFC 6238 locally for enrollment; the actual verifier stays upstream.
    const secret = new URL(enrollment.data.totpURI).searchParams.get('secret');
    const bits = [...secret].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('');
    const key = Buffer.from(bits.match(/.{8}/g).map(v => parseInt(v, 2))), counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const hash = require('node:crypto').createHmac('sha1', key).update(counter).digest(), at = hash[19] & 15;
    const code = String((hash.readUInt32BE(at) & 0x7fffffff) % 1000000).padStart(6, '0');
    assert.equal((await api('/two-factor/verify-totp', { code })).status, 200);
    await api('/sign-out', {});
    const withMfa = await page.evaluate(() => window.auth.signIn.passkey());
    assert.equal(withMfa.data.twoFactorRedirect, true);
    assert.equal((await api('/get-session')).data, null);
    assert.equal((await api('/two-factor/verify-backup-code', { code: enrollment.data.backupCodes[0], trustDevice: false })).status, 200);
    console.log('PASS passkey registration, sign-in, server UV enforcement and MFA gating');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
