/**
 * Prüft den gemeinsamen Live-Stand: zwei Browserfenster teilen sich einen
 * simulierten Dienst. Was das eine einträgt, sieht das andere von selbst.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node e2e/cloud.mjs
 */
import { chromium } from 'playwright';

const APP_URL = process.env.URL || 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failed = 0;
function check(ok, label) {
  console.log(`  ${ok ? 'ok ' : 'FEHLER'} ${label}`);
  if (!ok) failed += 1;
}

// Der simulierte Dienst: eine Zeile, ein Versionszähler.
const store = { row: null };

async function fakeBackend(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'GET') {
    return route.fulfill({ json: store.row ? [store.row] : [] });
  }
  if (request.method() === 'POST') {
    if (store.row) return route.fulfill({ status: 409, json: { message: 'gibt es schon' } });
    const body = request.postDataJSON();
    store.row = { id: body.id, rev: body.rev, state: body.state };
    return route.fulfill({ json: [store.row] });
  }
  if (request.method() === 'PATCH') {
    const expected = Number(/rev=eq\.(\d+)/.exec(url.search)?.[1]);
    if (!store.row || store.row.rev !== expected) return route.fulfill({ json: [] });
    const body = request.postDataJSON();
    store.row = { ...store.row, rev: body.rev, state: body.state };
    return route.fulfill({ json: [store.row] });
  }
  return route.fulfill({ json: [] });
}

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/sync-config.json*', (route) =>
    route.fulfill({ json: { url: 'https://fake.supabase.co', anonKey: 'test' } }),
  );
  await context.route('https://fake.supabase.co/**', fakeBackend);
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `Seitenfehler: ${e.message}`));
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.setItem('stelzengaudi:splash', '1');
  });
  await page.reload({ waitUntil: 'networkidle' });
  return page;
}

const browser = await chromium.launch({ executablePath: CHROME });

// --- Gerät A richtet das Turnier ein ---------------------------------------
const a = await newPage(browser);
await a.waitForSelector('.note--ok, .note--info');
check(
  (await a.locator('.note--ok', { hasText: 'Live für alle' }).count()) === 1,
  'Gerät A verbindet sich mit dem gemeinsamen Stand',
);
await a.click('button:has-text("Mehrere Namen einfügen")');
await a.fill('#bulk', ['Anna', 'Ben', 'Carla', 'David'].join('\n'));
await a.click('button:has-text("Alle übernehmen")');
await a.click('button:has-text("Jetzt auslosen")');
await a.waitForTimeout(800);
check(store.row !== null && store.row.state.matches.length > 0, 'Auslosung liegt im Dienst');

// --- Gerät B kommt später dazu und sieht alles ------------------------------
const b = await newPage(browser);
await b.waitForTimeout(800);
check((await b.locator('.player-row').count()) === 4, 'Gerät B sieht die vier Namen');
check((await b.locator('.match').count()) > 0, 'Gerät B sieht den Spielplan');
check(
  (await b.locator('button:has-text("Ergebnis eintragen")').count()) > 0,
  'Gerät B darf selbst eintragen (kein Schreibschutz)',
);

// --- Gerät B trägt ein Ergebnis ein, Gerät A sieht es ------------------------
await b.click('.tabs button:has-text("Spielplan")');
await b.locator('.match button:has-text("Ergebnis eintragen")').first().click();
const card = b.locator('.match').filter({ has: b.locator('button:has-text("Speichern")') }).first();
const chip = await card.locator('.chip', { hasText: /^bis / }).innerText();
const ziel = Number(/bis (\d+)/.exec(chip)?.[1] ?? '12');
await card.locator('.set-row input').nth(0).fill(String(ziel));
await card.locator('.set-row input').nth(1).fill(String(ziel - 5));
if ((await card.locator('.set-row').count()) > 1) {
  await card.locator('.set-row input').nth(2).fill(String(ziel));
  await card.locator('.set-row input').nth(3).fill(String(ziel - 4));
}
await card.locator('button:has-text("Speichern")').click();
await b.waitForTimeout(800);
check(store.row.state.matches.some((m) => m.winnerId !== null), 'Ergebnis von Gerät B liegt im Dienst');

await a.waitForTimeout(4000); // eine Abfragerunde abwarten
check((await a.locator('.match--done').count()) === 1, 'Gerät A sieht das fremde Ergebnis von selbst');

// --- Konflikt: beide schreiben gleichzeitig ---------------------------------
const revBefore = store.row.rev;
store.row = { ...store.row, rev: revBefore + 1 }; // jemand anderes war schneller
await a.locator('.match button:has-text("Ergebnis eintragen")').first().click();
const cardA = a.locator('.match').filter({ has: a.locator('button:has-text("Speichern")') }).first();
const chipA = await cardA.locator('.chip', { hasText: /^bis / }).innerText();
const zielA = Number(/bis (\d+)/.exec(chipA)?.[1] ?? '12');
await cardA.locator('.set-row input').nth(0).fill(String(zielA));
await cardA.locator('.set-row input').nth(1).fill(String(zielA - 3));
if ((await cardA.locator('.set-row').count()) > 1) {
  await cardA.locator('.set-row input').nth(2).fill(String(zielA));
  await cardA.locator('.set-row input').nth(3).fill(String(zielA - 2));
}
await cardA.locator('button:has-text("Speichern")').click();
await a.waitForTimeout(800);
check(
  (await a.locator('.note--warn', { hasText: 'Jemand war gleichzeitig dran' }).count()) === 1,
  'Konflikt wird gemeldet statt still überschrieben',
);
check(store.row.rev === revBefore + 1, 'der fremde Stand wurde nicht überschrieben');

// --- Netzausfall wird gemeldet ----------------------------------------------
await b.context().route('https://fake.supabase.co/**', (route) => route.abort());
await b.locator('.match button:has-text("Ergebnis eintragen")').first().click();
const cardB = b.locator('.match').filter({ has: b.locator('button:has-text("Speichern")') }).first();
const chipB = await cardB.locator('.chip', { hasText: /^bis / }).innerText();
const zielB = Number(/bis (\d+)/.exec(chipB)?.[1] ?? '12');
await cardB.locator('.set-row input').nth(0).fill(String(zielB));
await cardB.locator('.set-row input').nth(1).fill(String(zielB - 5));
if ((await cardB.locator('.set-row').count()) > 1) {
  await cardB.locator('.set-row input').nth(2).fill(String(zielB));
  await cardB.locator('.set-row input').nth(3).fill(String(zielB - 4));
}
await cardB.locator('button:has-text("Speichern")').click();
await b.waitForTimeout(1000);
check(
  (await b.locator('.note--warn', { hasText: 'keine Verbindung' }).count()) === 1,
  'Netzausfall wird ehrlich gemeldet',
);

await browser.close();
if (failed > 0) {
  console.log(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nGemeinsamer Live-Stand arbeitet korrekt.');
