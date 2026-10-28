// The complete starter works with JavaScript disabled: native forms and server-side auth.
const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2] || 'http://localhost:3007';
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({javaScriptEnabled:false});
    const page = await context.newPage();
    await page.goto(base+'/login');
    const form = page.locator('form[action="/api/auth/register"]');
    await form.locator('[name=email]').fill('browser-'+Date.now()+'@example.test');
    await form.locator('[name=password]').fill('a very long browser passphrase');
    await Promise.all([page.waitForURL('**/dashboard'),form.locator('button').click()]);
    await page.locator('[name=text]').fill('A private note without JavaScript');
    await Promise.all([page.waitForURL('**/dashboard'),page.getByRole('button',{name:'Add note'}).click()]);
    await page.getByText('A private note without JavaScript',{exact:true}).waitFor();
    await page.locator('[name=file]').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('private attachment')});
    await Promise.all([page.waitForURL('**/dashboard'),page.getByRole('button',{name:'Upload',exact:true}).click()]);
    await page.getByRole('link',{name:'note.txt'}).waitFor();
    await Promise.all([page.waitForURL('**/login'),page.getByRole('button',{name:'Sign out'}).click()]);
    await page.goto(base+'/dashboard');
    if(!page.url().endsWith('/login')) throw new Error('Logged-out dashboard is accessible');
    console.log('PASS full-stack register, notes, upload and logout with JavaScript disabled');
    await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
