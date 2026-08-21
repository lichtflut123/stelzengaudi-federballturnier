/**
 * Baut aus dem Einzeldatei-Build die veröffentlichbare Live-Seite.
 *
 * Die Seite trägt zwei Dinge in sich:
 *   #turnier-state – der aktuelle Turnierstand als JSON
 *   #turnier-tpl   – der eigene Bauplan (Base64), damit die Seite eine neue
 *                    Fassung ihrer selbst mit geändertem Stand erzeugen kann
 *
 * Ergebnis: dist-live/artifact.html
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'dist-live');
const SOURCE = resolve(DIR, 'index.html');
const TARGET = resolve(DIR, 'artifact.html');
const TARGET_INITIAL = resolve(DIR, 'artifact-initial.html');

const STATE_TAG = '<script id="turnier-state" type="application/json">__TURNIER_STATE__</script>';
const TPL_TAG = '<script id="turnier-tpl" type="text/plain">__TURNIER_TPL__</script>';

const raw = await readFile(SOURCE, 'utf8');
if (raw.split('<div id="root"></div>').length !== 2) {
  throw new Error('dist-live/index.html enthält nicht genau einen Wurzelknoten.');
}

// Das Favicon einbetten: die Seite wird als einzelne Datei weitergegeben.
const favicon = await readFile(resolve(process.cwd(), 'public/favicon.svg'), 'utf8');
const faviconData = `data:image/svg+xml;base64,${Buffer.from(favicon, 'utf8').toString('base64')}`;
const built = raw.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${faviconData}" />`);

// Nichts darf von außen nachgeladen werden – sonst ist die Seite tot,
// sobald sie ohne ihre Nachbardateien ausgeliefert wird.
const external = [...built.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((url) => !url.startsWith('data:'));
if (external.length > 0) {
  throw new Error(`Der Build ist nicht in sich geschlossen: ${external.join(', ')}`);
}

// Bauplan = gebaute Seite plus die beiden Platzhalter-Skripte.
const template = built.replace('<div id="root"></div>', `<div id="root"></div>\n    ${STATE_TAG}\n    ${TPL_TAG}`);
if (!template.includes(STATE_TAG) || !template.includes(TPL_TAG)) {
  throw new Error('Die Platzhalter konnten nicht eingesetzt werden.');
}

const encoded = Buffer.from(template, 'utf8').toString('base64');
const fill = (html) =>
  html
    .replace(STATE_TAG, '<script id="turnier-state" type="application/json">null</script>')
    .replace(TPL_TAG, `<script id="turnier-tpl" type="text/plain">${encoded}</script>`);

// Vollständige Seite – diese Form erzeugt die Seite später auch selbst.
const page = fill(template);
await writeFile(TARGET, page, 'utf8');

// Fassung zum erstmaligen Veröffentlichen: nur der Seiteninhalt, weil die
// Plattform Doctype, <html> und <head> selbst darum legt.
const headInner = template.match(/<head[^>]*>([\s\S]*?)<\/head>/)?.[1] ?? '';
const bodyInner = template.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1];
if (!bodyInner) throw new Error('Der Seiteninhalt konnte nicht gelesen werden.');
const title = headInner.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Federball-Turnier';
// Aus dem Kopf bleiben Stil und Skripte erhalten; Doctype, meta und link
// setzt die Plattform selbst.
const headKeep = (headInner.match(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/g) ?? []).join('\n');
const initial = fill(`<title>${title}</title>\n${headKeep}\n${bodyInner.trim()}`);
await writeFile(TARGET_INITIAL, initial, 'utf8');

const kb = (text) => `${Math.round(Buffer.byteLength(text) / 1024)} kB`;
console.log(`Bauplan:            ${kb(template)}`);
console.log(`Live-Seite:         ${kb(page)}  ->  ${TARGET}`);
console.log(`Zum Veröffentlichen:${kb(initial)}  ->  ${TARGET_INITIAL}`);

// Selbstprüfung: Lässt sich aus dem eingebetteten Bauplan wieder eine
// vollständige, gleichwertige Seite erzeugen? Ohne das bricht der Live-Modus
// beim zweiten Eintrag ab.
const embedded = page.match(/<script id="turnier-tpl" type="text\/plain">([\s\S]*?)<\/script>/)?.[1];
if (!embedded) throw new Error('Selbstprüfung: Bauplan fehlt in der Live-Seite.');
const roundTrip = Buffer.from(embedded, 'base64').toString('utf8');
if (roundTrip !== template) throw new Error('Selbstprüfung: Bauplan stimmt nicht mit der Vorlage überein.');
const nextGeneration = roundTrip
  .replace(STATE_TAG, '<script id="turnier-state" type="application/json">{"version":2}</script>')
  .replace(TPL_TAG, `<script id="turnier-tpl" type="text/plain">${encoded}</script>`);
if (!nextGeneration.startsWith('<!doctype html>') && !nextGeneration.startsWith('<!DOCTYPE html>')) {
  throw new Error('Selbstprüfung: Die nächste Fassung wäre kein vollständiges Dokument.');
}
if (!nextGeneration.includes('id="turnier-tpl"') || !nextGeneration.includes('{"version":2}')) {
  throw new Error('Selbstprüfung: Die nächste Fassung wäre unvollständig.');
}
// Die erzeugten Seiten müssen die App auch wirklich enthalten.
for (const [label, html] of [['Live-Seite', page], ['Veröffentlichungsfassung', initial]]) {
  if (Buffer.byteLength(html) < 100_000) throw new Error(`${label}: verdächtig klein.`);
  if (!html.includes('createRoot')) throw new Error(`${label}: das Programm fehlt.`);
  if (!html.includes('Stelzengaudi')) throw new Error(`${label}: die Oberfläche fehlt.`);
  if (html.split('id="turnier-state"').length !== 2) throw new Error(`${label}: Zustand nicht genau einmal enthalten.`);
  if (html.split('id="turnier-tpl"').length !== 2) throw new Error(`${label}: Bauplan nicht genau einmal enthalten.`);
}
console.log('Selbstprüfung:      Bauplan reproduziert sich korrekt, Seiten sind vollständig.');
