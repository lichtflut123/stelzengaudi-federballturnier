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

/** Baut einen Dienst um eine eigene Zeile – für Abschnitte mit eigenem Stand. */
function makeBackend(store) {
  return async function fakeBackend(route) {
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
  };
}
const fakeBackend = makeBackend(store);

/** Wie newPage, aber mit frei wählbarem Dienst und Warte-Modus. */
async function openDevice(browser, handler, { wait = 'networkidle' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/sync-config.json*', (route) =>
    route.fulfill({ json: { url: 'https://fake.supabase.co', anonKey: 'test' } }),
  );
  await context.route('https://fake.supabase.co/**', handler);
  const page = await context.newPage();
  page.on('pageerror', (e) => check(false, `Seitenfehler: ${e.message}`));
  await page.goto(APP_URL, { waitUntil: wait });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.setItem('stelzengaudi:splash', '1');
  });
  await page.reload({ waitUntil: wait });
  return { context, page };
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
// Dabei zählen wir mit: Die App darf im Ausfall nicht in einer engen Schleife
// auf den Dienst hämmern, sondern wartet zwischen den Versuchen.
let abgebrochen = 0;
await b.context().route('https://fake.supabase.co/**', (route) => {
  abgebrochen += 1;
  return route.abort();
});
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
await b.waitForTimeout(2000);
check(
  (await b.locator('.note--warn', { hasText: 'keine Verbindung' }).count()) === 1,
  'Netzausfall wird ehrlich gemeldet',
);
check(
  abgebrochen <= 5,
  `im Ausfall wird gewartet statt gehämmert (${abgebrochen} Anfragen in 2 s)`,
);

// --- Verbindungsaufbau wird nach einem Fehlschlag wiederholt -----------------
{
  const meinStore = { row: null };
  const backend = makeBackend(meinStore);
  let tot = true; // der Dienst ist beim ersten Öffnen nicht erreichbar
  const { context, page } = await openDevice(browser, (route) => (tot ? route.abort() : backend(route)));
  await page.waitForTimeout(1200);
  check(
    (await page.locator('.note--warn', { hasText: 'keine Verbindung' }).count()) === 1,
    'gescheiterter Verbindungsaufbau wird gemeldet',
  );
  tot = false; // das Netz kommt zurück
  await page.waitForTimeout(7000); // ein Wiederhol-Zyklus (5 s) plus Luft
  check(meinStore.row !== null, 'nach Netz-Rückkehr wird wirklich verbunden (Zeile angelegt)');
  check(
    meinStore.row !== null &&
      (await page.locator('.note--ok', { hasText: 'Live für alle' }).count()) === 1,
    'das Live-Banner erscheint erst, wenn die Verbindung steht',
  );
  await context.close();
}

// --- Die Dienst-Zeile verschwindet mitten im Betrieb -------------------------
{
  const meinStore = { row: null };
  const backend = makeBackend(meinStore);
  let zaehlen = false;
  let anfragen = 0;
  const { context, page } = await openDevice(browser, (route) => {
    if (zaehlen) anfragen += 1;
    return backend(route);
  });
  await page.click('button:has-text("Mehrere Namen einfügen")');
  await page.fill('#bulk', ['Anna', 'Ben', 'Carla', 'David'].join('\n'));
  await page.click('button:has-text("Alle übernehmen")');
  await page.click('button:has-text("Jetzt auslosen")');
  await page.waitForTimeout(800);
  check(meinStore.row !== null, 'Auslosung liegt im Dienst (Vorbereitung)');
  meinStore.row = null; // die Zeile ist weg – etwa von Hand gelöscht
  zaehlen = true;
  await page.click('.tabs button:has-text("Spielplan")');
  await page.locator('.match button:has-text("Ergebnis eintragen")').first().click();
  const karte = page.locator('.match').filter({ has: page.locator('button:has-text("Speichern")') }).first();
  const chipZ = await karte.locator('.chip', { hasText: /^bis / }).innerText();
  const zielZ = Number(/bis (\d+)/.exec(chipZ)?.[1] ?? '12');
  await karte.locator('.set-row input').nth(0).fill(String(zielZ));
  await karte.locator('.set-row input').nth(1).fill(String(zielZ - 5));
  if ((await karte.locator('.set-row').count()) > 1) {
    await karte.locator('.set-row input').nth(2).fill(String(zielZ));
    await karte.locator('.set-row input').nth(3).fill(String(zielZ - 4));
  }
  await karte.locator('button:has-text("Speichern")').click();
  await page.waitForTimeout(2000);
  check(
    anfragen <= 6,
    `bei verlorener Dienst-Zeile wird gewartet statt gehämmert (${anfragen} Anfragen in 2 s)`,
  );
  await page.waitForTimeout(6000); // ein Wiederhol-Zyklus
  check(
    meinStore.row !== null && meinStore.row.state.matches.some((m) => m.winnerId !== null),
    'die Zeile wird neu angelegt und das Ergebnis gerettet',
  );
  await context.close();
}

// --- Eingaben während „Verbinde …" gehen nicht still verloren ----------------
{
  const meinStore = { row: null };
  const backend = makeBackend(meinStore);
  // Fremden Stand vorbereiten: ein Gerät legt zwei Namen an.
  {
    const { context, page } = await openDevice(browser, backend);
    await page.click('button:has-text("Mehrere Namen einfügen")');
    await page.fill('#bulk', ['Anna', 'Ben'].join('\n'));
    await page.click('button:has-text("Alle übernehmen")');
    await page.waitForTimeout(800);
    await context.close();
  }
  check(meinStore.row !== null, 'fremder Stand liegt bereit (Vorbereitung)');
  const revVorher = meinStore.row.rev;
  // Zweites Gerät verbindet langsam – der erste Abruf braucht 1,5 Sekunden.
  let bremse = true;
  const { context, page } = await openDevice(
    browser,
    async (route) => {
      if (bremse && route.request().method() === 'GET') {
        bremse = false;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return backend(route);
    },
    { wait: 'domcontentloaded' },
  );
  // Während „Verbinde …" trägt die Person schon einen Namen ein.
  await page.fill('input[placeholder="z. B. Anna"]', 'Zoe');
  await page.click('button:has-text("Hinzufügen")');
  await page.waitForTimeout(2500); // Verbindung steht, fremder Stand übernommen
  check(
    (await page.locator('.note--warn', { hasText: 'Jemand war gleichzeitig dran' }).count()) === 1,
    'Ersetzen der eigenen Eingabe beim Verbinden wird angezeigt statt verschwiegen',
  );
  await page.waitForTimeout(2500);
  check(
    meinStore.row.rev === revVorher,
    'der übernommene fremde Stand wird nicht als eigene Änderung hochgeladen',
  );
  await context.close();
}

await browser.close();
if (failed > 0) {
  console.log(`\n${failed} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nGemeinsamer Live-Stand arbeitet korrekt.');
