/**
 * Prüft die geteilte Live-Seite: Wird der Stand in die Seite eingebettet,
 * erzeugt die Seite daraus eine gültige neue Fassung, sieht die nächste
 * Generation denselben Stand, und bleibt ein Zuschauer ohne Schreibrecht
 * außen vor?
 *
 *   npm run build:artifact && npm run e2e:live
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const ROOT = process.cwd();
const CHROME = process.env.CHROME_PATH ?? undefined;
const LIVE = `file://${ROOT}/dist-live/artifact.html`;
const GEN2_PATH = `${ROOT}/dist-live/.gen2.html`;

const problems = [];
const check = (ok, label) => {
  console.log(`${ok ? '  ok ' : '  FEHLER '} ${label}`);
  if (!ok) problems.push(label);
};

/** Stub für die Veröffentlichungs-Schnittstelle der Plattform. */
const writerStub = () => {
  window.__published = null;
  window.claude = {
    use: async (name) =>
      name === 'artifact'
        ? {
            publish: async (html) => {
              window.__published = html;
              return { version: 'test' };
            },
          }
        : null,
  };
};
const readerStub = () => {
  window.claude = { use: async () => null };
};

const stateOf = (html) => {
  const match = html.match(/<script id="turnier-state" type="application\/json">([\s\S]*?)<\/script>/);
  return match ? JSON.parse(match[1]) : null;
};

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];

// --- Erste Generation: auslosen und veröffentlichen -----------------------
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => errors.push(`gen1: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`gen1: ${m.text()}`));
await page.addInitScript(writerStub);
await page.goto(LIVE, { waitUntil: 'networkidle' });

check((await page.locator('.note--ok').count()) > 0, 'Live-Hinweis für die Turnierleitung');

await page.click('button:has-text("Mehrere Namen einfügen")');
// Feindliche Namen: sie landen als JSON mitten in der veröffentlichten Seite.
await page.fill(
  '#bulk',
  ['Anna</script><script>window.__PWN=1</script>', 'Ben<!--', 'Carla-->', 'David', 'Emil'].join('\n'),
);
await page.click('button:has-text("Alle übernehmen")');
await page.click('button:has-text("Jetzt auslosen")');
await page.waitForTimeout(700);
check((await page.evaluate(() => window.__PWN)) === undefined, 'Namen können kein Skript einschleusen');

const gen2 = await page.evaluate(() => window.__published);
check(Boolean(gen2), 'Auslosung wird veröffentlicht');
check(/^<!doctype html>/i.test(gen2 ?? ''), 'veröffentlichte Fassung ist ein vollständiges Dokument');
check(stateOf(gen2 ?? '')?.players.length === 5, 'Stand steckt in der veröffentlichten Fassung');
check(!/[^\\]<\/script>/.test((gen2 ?? '').split('id="turnier-state"')[1]?.slice(0, 4000) ?? ''), 'kein rohes Skriptende im Zustand');
check((gen2 ?? '').includes('id="turnier-tpl"'), 'Bauplan bleibt für die nächste Fassung erhalten');
writeFileSync(GEN2_PATH, gen2 ?? '');

// --- Zweite Generation: Stand sichtbar, Ergebnis eintragen ----------------
const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page2.on('pageerror', (e) => errors.push(`gen2: ${e.message}`));
page2.on('console', (m) => m.type() === 'error' && errors.push(`gen2: ${m.text()}`));
await page2.addInitScript(writerStub);
await page2.goto(`file://${GEN2_PATH}`, { waitUntil: 'networkidle' });
await page2.waitForTimeout(300);

check((await page2.locator('.player-row').count()) === 5, 'nächste Generation sieht die Namen');
check((await page2.evaluate(() => window.__PWN)) === undefined, 'auch die nächste Generation bleibt sauber');
// 5 Personen: 4 Hauptspiele + Spiel um Platz 3 + 2 Trostspiele
check((await page2.locator('.match').count()) === 7, 'nächste Generation sieht den Spielplan');

await page2.click('button:has-text("Spielplan")');
await page2.locator('.match button:has-text("Ergebnis eintragen")').first().click();
const card = page2.locator('.match').filter({ has: page2.locator('button:has-text("Speichern")') }).first();
const ziel = Number((await card.locator('.chip', { hasText: /^bis / }).innerText()).replace(/\D+/g, '')) || 12;
await card.locator('.set-row input').nth(0).fill(String(ziel));
await card.locator('.set-row input').nth(1).fill(String(ziel - 5));
await card.locator('.set-row input').nth(2).fill(String(ziel));
await card.locator('.set-row input').nth(3).fill(String(ziel - 4));
await card.locator('button:has-text("Speichern")').click();
await page2.waitForTimeout(900);

const gen3 = await page2.evaluate(() => window.__published);
check(Boolean(gen3), 'Ergebnis wird veröffentlicht');
check(stateOf(gen3 ?? '')?.matches.filter((m) => m.winnerId).length === 1, 'Ergebnis steckt im veröffentlichten Stand');

// --- Umbenennen muss ebenfalls ankommen -----------------------------------
await page2.click('button:has-text("Vorbereitung")');
await page2.locator('.player-row input[type=text]').first().fill('Umbenannt');
// Tippen ist entprellt: veröffentlicht wird erst nach 1,5 s Ruhe.
await page2.waitForTimeout(2300);
const gen4 = await page2.evaluate(() => window.__published);
check(
  stateOf(gen4 ?? '')?.players.some((p) => p.name === 'Umbenannt'),
  'auch eine Umbenennung wird veröffentlicht',
);

// --- Zuschauer ohne Schreibrecht ------------------------------------------
const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page3.on('pageerror', (e) => errors.push(`zuschauer: ${e.message}`));
await page3.addInitScript(readerStub);
await page3.goto(`file://${GEN2_PATH}`, { waitUntil: 'networkidle' });
await page3.click('button:has-text("Spielplan")');
await page3.waitForTimeout(400);

check((await page3.locator('.note--info').count()) > 0, 'Zuschauer bekommt den Mitlesen-Hinweis');
check((await page3.locator('button:has-text("Ergebnis eintragen")').count()) === 0, 'Zuschauer kann nichts eintragen');
await page3.click('button:has-text("Vorbereitung")');
const drawBtn = page3.locator('button:has-text("Neu auslosen"), button:has-text("Jetzt auslosen")').first();
check((await drawBtn.count()) === 1 && (await drawBtn.isDisabled()), 'Zuschauer kann nicht auslosen');
check((await page3.locator('.player-row input[type=text]').first().isDisabled()), 'Zuschauer kann keine Namen ändern');
check((await page3.locator('button:has-text("Alles zurücksetzen")').count()) === 0, 'Zuschauer kann nichts zurücksetzen');
check((await page3.locator('button:has-text("Importieren")').count()) === 0, 'Zuschauer kann nichts importieren');

check(errors.length === 0, `keine Fehler in der Konsole${errors.length ? `: ${errors.join(' | ')}` : ''}`);

await browser.close();
if (problems.length > 0) {
  console.error(`\n${problems.length} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nLive-Seite arbeitet korrekt.');
