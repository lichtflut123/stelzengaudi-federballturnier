/**
 * Durchlauf im echten Browser mit 18 Personen: Namen samt Einlaufmusik
 * eintragen, auslosen, Schiri-Modus benutzen, alle Ergebnisse eintragen,
 * Endstand prüfen. Vorher `npm run build` und einen Preview-Server starten:
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm run e2e
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://127.0.0.1:4173/';
const SHOT_DIR = process.env.SHOT_DIR ?? null;
const CHROME = process.env.CHROME_PATH ?? undefined;

const problems = [];
const check = (ok, label) => {
  console.log(`${ok ? '  ok ' : '  FEHLER '} ${label}`);
  if (!ok) problems.push(label);
};

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
// Die Suite prüft die App im lokalen Betrieb: eine echte sync-config.json im
// gebauten Stand darf hier keine Netzverbindungen auslösen.
await page.route('**/sync-config.json*', (route) => route.fulfill({ json: {} }));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });

// --- Startbild ------------------------------------------------------------
check((await page.locator('.splash').count()) === 1, 'Startbild mit Stelze erscheint');
check((await page.locator('.splash--egg').count()) === 0, 'normale Öffnung zeigt den Knochen');
await page.waitForTimeout(2100);
check((await page.locator('.splash').count()) === 0, 'Startbild verschwindet von selbst');

// Easter Egg: jede 20. Öffnung
await page.evaluate(() => {
  localStorage.setItem('stelzengaudi:opens', '19');
  sessionStorage.removeItem('stelzengaudi:splash');
});
await page.reload({ waitUntil: 'commit' });
await page.waitForSelector('.splash');
check((await page.locator('.splash--egg').count()) === 1, 'jede 20. Öffnung zeigt das Easter Egg');
await page.evaluate(() => sessionStorage.removeItem('stelzengaudi:splash'));
await page.reload({ waitUntil: 'commit' });
await page.waitForSelector('.splash');
check((await page.locator('.splash--egg').count()) === 0, 'die 21. Öffnung ist wieder der Knochen');
await page.waitForTimeout(2100);

// --- 18 Namen über die Sammel-Eingabe ------------------------------------
const NAMES = [
  'Anna', 'Ben', 'Carla', 'David', 'Emil', 'Frida', 'Gustav', 'Hanna', 'Ida',
  'Jonas', 'Klara', 'Lena', 'Moritz', 'Nora', 'Oskar', 'Paula', 'Quirin', 'Rosa',
];
await page.click('button:has-text("Mehrere Namen einfügen")');
await page.fill('#bulk', NAMES.join('\n'));
await page.click('button:has-text("Alle übernehmen")');
check((await page.locator('.player-row').count()) === 18, '18 Namen übernommen');

// Einlaufmusik für zwei Personen – das Feld klappt über den 🎵-Knopf auf
const row = (name) => page.locator('.player-row', { has: page.locator(`input[value="${name}"]`) });
for (const [name, song] of [['Anna', 'Eye of the Tiger'], ['Ben', 'Highway to Hell']]) {
  await row(name).locator('button[title="Einlaufmusik eintragen"]').click();
  await row(name).locator('.player-row__song').fill(song);
}
check(
  (await page.locator('.player-row__song').count()) === 2,
  'Musikfelder nur bei den zwei Personen mit Musik sichtbar',
);

// Zwei Vorjahresgewinner markieren
for (const name of ['Anna', 'Ben']) {
  await page.locator('.player-row', { has: page.locator(`input[value="${name}"]`) }).locator('.player-row__champ input').check();
}

// Vorschau: 18 -> Hauptfeld 16, 2 Vorrundenspiele, Trostrunde 10 Plätze, 27 Spiele
const preview = await page.locator('.card', { hasText: 'Auslosen' }).innerText();
check(/2 Vorrundenspiele/.test(preview), 'Vorschau nennt 2 Vorrundenspiele');
check(/27 Spiele/.test(preview), 'Vorschau nennt 27 Spiele');

// --- Auslosen ------------------------------------------------------------
await page.click('button:has-text("Jetzt auslosen")');
await page.waitForTimeout(400);
const matchCount = await page.locator('.match').count();
check(matchCount === 27, `Spielzahl stimmt (${matchCount})`);

// Vorjahresgewinner: nicht in der Vorrunde, kein Duell im ersten Spiel
const state = await page.evaluate(() => JSON.parse(localStorage.getItem('stelzengaudi-federball:v3')));
const champIds = state.players.filter((p) => p.isChampion).map((p) => p.id);
const playIn = state.matches.filter((m) => m.phase === 'vorrunde' && m.tree === 'haupt');
const playInPlayers = playIn.flatMap((m) => [m.a.playerId, m.b.playerId]);
check(champIds.every((id) => !playInPlayers.includes(id)), 'Vorjahresgewinner nicht in der Vorrunde');
const firstRound = Math.min(...state.matches.filter((m) => m.tree === 'haupt').map((m) => m.round));
const clash = state.matches
  .filter((m) => m.tree === 'haupt' && m.round <= firstRound + 1)
  .some((m) => champIds.includes(m.a.playerId) && champIds.includes(m.b.playerId));
check(!clash, 'Vorjahresgewinner treffen sich nicht im ersten Spiel');
check(
  state.matches.filter((m) => m.tree === 'trost').length === 9,
  'Trostrunde hat 9 Spiele (10 Plätze)',
);
check(
  state.matches.filter((m) => m.tree === 'trost').every((m) => m.setsToWin === 1),
  'Trostrunde spielt nur einen Satz',
);

// --- Schiri-Modus für das erste Spiel ------------------------------------
const firstCard = page.locator('.match').first();
await firstCard.locator('button:has-text("Schiri-Modus")').click();
check((await page.locator('.referee').count()) === 1, 'Schiri-Modus öffnet sich');

const padA = page.locator('.referee__pad').first();
const padB = page.locator('.referee__pad').nth(1);
// Satz 1: 12:3 für A (mit Rückgängig zwischendurch)
for (let i = 0; i < 3; i++) await padB.click();
await padB.click();
await page.locator('button:has-text("Punkt zurück")').click();
for (let i = 0; i < 12; i++) await padA.click();
// Satzende: Zwischenstand sichtbar, Anzeige „Sätze 1:0“
check(/Sätze 1:0/.test(await page.locator('.referee__sets').innerText()), 'Satz 1 gewertet (12:3)');
// Satz zurückholen: „Punkt zurück" muss den satzbeendenden Punkt (des
// Gewinners) abbauen, nicht dem Verlierer einen Punkt nehmen.
await page.locator('button:has-text("Satz 1 zurückholen")').click();
const score = async (pad) => Number(await pad.locator('.referee__score').innerText());
check((await score(padA)) === 12 && (await score(padB)) === 3, 'zurückgeholter Satz zeigt 12:3');
await page.locator('button:has-text("Punkt zurück")').click();
check(
  (await score(padA)) === 11 && (await score(padB)) === 3,
  'Punkt zurück nach Satz-Rückholung nimmt dem Satzgewinner den Punkt (11:3)',
);
await padA.click(); // Satz wieder beenden (12:3), dann weiter wie gehabt
check(/Sätze 1:0/.test(await page.locator('.referee__sets').innerText()), 'Satz 1 erneut gewertet (12:3)');
// Satz 2: 12:0 -> Spiel fertig, Schiri-Ansicht bleibt zu schließen? Nein: onFinished schließt.
for (let i = 0; i < 12; i++) await padA.click();
await page.waitForTimeout(200);
check((await page.locator('.referee').count()) === 0, 'Schiri-Modus schließt nach dem Spiel');
check((await page.locator('.match--done').count()) === 1, 'Ergebnis aus dem Schiri-Modus ist gewertet');

// --- Einlaufmusik unter "Jetzt dran" -------------------------------------
const nowText = await page.locator('.now').innerText();
check(/läuft ein zu/.test(nowText) || !/Anna|Ben/.test(nowText), 'Einlaufmusik erscheint bei „Jetzt dran“ (falls dran)');

// --- Alle übrigen Spiele über die Schnell-Eingabe -------------------------
for (let i = 0; i < 60; i++) {
  const btn = page.locator('.match button:has-text("Ergebnis eintragen")').first();
  if ((await btn.count()) === 0) break;
  await btn.click();
  const card = page.locator('.match').filter({ has: page.locator('button:has-text("Speichern")') }).first();
  const chip = await card.locator('.chip', { hasText: /^bis / }).innerText();
  const ziel = Number(/bis (\d+)/.exec(chip)?.[1] ?? '12');
  const rows = await card.locator('.set-row').count();
  await card.locator('.set-row input').nth(0).fill(String(ziel));
  await card.locator('.set-row input').nth(1).fill(String(Math.max(0, ziel - 5 - (i % 3))));
  if (rows > 1) {
    await card.locator('.set-row input').nth(2).fill(String(ziel));
    await card.locator('.set-row input').nth(3).fill(String(Math.max(0, ziel - 4 - (i % 4))));
  }
  await card.locator('button:has-text("Speichern")').click();
  await page.waitForTimeout(60);
}

check(/27 von 27/.test(await page.locator('.progress__label').innerText()), 'alle 27 Spiele gespielt');

// --- Endstand -------------------------------------------------------------
check((await page.locator('.podium__row').count()) === 3, 'Endstand mit drei Plätzen');

await page.click('button:has-text("Turnierbaum")');
await page.waitForTimeout(400);
check((await page.locator('.tree').count()) === 2, 'Hauptrunde und Trostrunde werden gezeigt');
check((await page.locator('.bracket__winner').count()) === 2, 'Sieger in beiden Bäumen hervorgehoben');
if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/e2e-baum18.png`, fullPage: true });

// --- Kein waagerechtes Scrollen der Seite ---------------------------------
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check(overflow === 0, 'kein waagerechtes Scrollen der Seite');

// --- Persistenz -----------------------------------------------------------
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
check(/27 von 27/.test(await page.locator('.progress__label').innerText()), 'Stand überlebt das Neuladen');
check((await page.locator('.splash').count()) === 0, 'Startbild kommt in derselben Sitzung nicht erneut');

check(consoleErrors.length === 0, `keine Konsolenfehler${consoleErrors.length ? `: ${consoleErrors[0]}` : ''}`);

await browser.close();
if (problems.length > 0) {
  console.error(`\n${problems.length} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
