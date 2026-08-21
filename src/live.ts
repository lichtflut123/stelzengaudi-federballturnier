/**
 * Live-Betrieb als veröffentlichte Seite.
 *
 * Die Seite trägt ihren eigenen Bauplan (`#turnier-tpl`) und den aktuellen
 * Turnierstand (`#turnier-state`) in sich. Trägt die Turnierleitung ein
 * Ergebnis ein, wird daraus eine neue Fassung der Seite veröffentlicht –
 * alle geöffneten Ansichten laden automatisch nach und zeigen denselben Stand.
 */
import type { Tournament } from './engine/types';
import { migrate } from './engine/storage';

const STATE_ID = 'turnier-state';
const TPL_ID = 'turnier-tpl';
const STATE_MARKER = '__TURNIER_STATE__';
const TPL_MARKER = '__TURNIER_TPL__';

interface ArtifactApi {
  publish(html: string): Promise<{ version: string }>;
}

interface DownloadsApi {
  save(options: { filename: string; data: string | Blob }): Promise<unknown>;
}

interface ClaudeApi {
  use(name: 'artifact'): Promise<ArtifactApi | null>;
  use(name: 'downloads'): Promise<DownloadsApi | null>;
  use(name: string): Promise<unknown>;
}

let artifactCache: ArtifactApi | null | undefined;

async function artifactApi(): Promise<ArtifactApi | null> {
  if (artifactCache !== undefined) return artifactCache;
  const api = claudeApi();
  if (!api) return null;
  try {
    artifactCache = await api.use('artifact');
  } catch {
    artifactCache = null;
  }
  return artifactCache;
}

function claudeApi(): ClaudeApi | null {
  const g = globalThis as { claude?: ClaudeApi };
  return g.claude && typeof g.claude.use === 'function' ? g.claude : null;
}

let templateCache: string | null | undefined;

function templateSource(): string | null {
  // Der Bauplan ist einige hundert Kilobyte groß – einmal dekodieren genügt.
  if (templateCache !== undefined) return templateCache;
  templateCache = decodeTemplate();
  return templateCache;
}

function decodeTemplate(): string | null {
  const el = document.getElementById(TPL_ID);
  const raw = el?.textContent?.trim();
  if (!raw || raw === TPL_MARKER) return null;
  try {
    // Base64, damit im Bauplan enthaltene Skript-Enden die Seite nicht zerlegen.
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Ist diese Seite als geteilte Live-Seite gebaut? */
export function isLivePage(): boolean {
  return typeof document !== 'undefined' && templateSource() !== null;
}

/** Der in der Seite eingebettete Turnierstand. */
export function readEmbeddedState(): Tournament | null {
  if (typeof document === 'undefined') return null;
  const raw = document.getElementById(STATE_ID)?.textContent?.trim();
  if (!raw || raw === STATE_MARKER || raw === 'null') return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Kann diese Ansicht überhaupt schreiben? `null` heißt: nur mitlesen.
 * Ein Ja ist noch keine Garantie – endgültig zeigt es sich beim ersten
 * Veröffentlichen.
 */
export async function canWrite(): Promise<boolean> {
  if (!templateSource()) return false;
  // Die Plattform reicht `claude` unter Umständen erst kurz nach dem Laden
  // nach – deshalb ein paar Mal nachfassen, statt sofort aufzugeben.
  const delays = [0, 300, 1000, 2500];
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (!claudeApi()) continue;
    artifactCache = undefined;
    if ((await artifactApi()) !== null) return true;
  }
  return false;
}

/**
 * Datei an die Betrachterin weitergeben. Auf der veröffentlichten Seite geht
 * das nur über die Plattform – ein gewöhnlicher Download-Link bleibt dort
 * wirkungslos. `false` heißt: hier ist kein Speichern möglich.
 */
export async function saveFile(filename: string, data: string): Promise<boolean> {
  const api = claudeApi();
  if (!api) return false;
  try {
    const downloads = await api.use('downloads');
    if (!downloads) return false;
    await downloads.save({ filename, data });
    return true;
  } catch {
    return false;
  }
}

export type PublishResult =
  | 'ok'
  | 'schreibgeschuetzt'
  | 'konflikt'
  | 'ueberlastet'
  | 'zu-gross'
  | 'fehler'
  | 'nicht-live';

/**
 * Veröffentlicht den Stand als neue Fassung dieser Seite.
 * Danach lädt jede geöffnete Ansicht automatisch neu.
 */
let inFlight: Promise<PublishResult> | null = null;
let pending: Tournament | null = null;

/**
 * Veröffentlicht den Stand. Läuft schon eine Übertragung, wird der neue Stand
 * gemerkt und danach genau einmal nachgezogen – so kann ein langsamer erster
 * Aufruf niemals einen neueren Stand überschreiben.
 */
export function publishState(t: Tournament): Promise<PublishResult> {
  if (inFlight) {
    pending = t;
    return inFlight;
  }
  inFlight = publishNow(t).then(async (result) => {
    inFlight = null;
    if (pending) {
      const next = pending;
      pending = null;
      return publishState(next);
    }
    return result;
  });
  return inFlight;
}

async function publishNow(t: Tournament): Promise<PublishResult> {
  const template = templateSource();
  if (!template) return 'nicht-live';
  const artifact = await artifactApi();
  if (!artifact) return 'schreibgeschuetzt';

  // Ganze Skript-Elemente ersetzen, nicht nur die Platzhalter: die
  // Platzhaltertexte kommen im mitgelieferten Programmcode ebenfalls vor.
  const stateTag = (inner: string): string => `<script id="${STATE_ID}" type="application/json">${inner}</script>`;
  const tplTag = (inner: string): string => `<script id="${TPL_ID}" type="text/plain">${inner}</script>`;
  const json = JSON.stringify(t).replace(/</g, '\\u003c');
  const html = template
    .replace(stateTag(STATE_MARKER), () => stateTag(json))
    .replace(tplTag(TPL_MARKER), () => tplTag(toBase64(template)));
  if (html.includes(stateTag(STATE_MARKER)) || html.includes(tplTag(TPL_MARKER))) {
    return 'fehler';
  }

  try {
    await artifact.publish(html);
    return 'ok';
  } catch (e) {
    const code = (e as { code?: string })?.code;
    switch (code) {
      case 'not_writer':
      case 'not_granted':
      case 'not_declared':
      case 'consent_required':
      case 'capability_disabled':
      case 'capability_removed':
        artifactCache = null;
        return 'schreibgeschuetzt';
      case 'conflict':
        return 'konflikt';
      case 'rate_limited':
        return 'ueberlastet';
      case 'too_large':
        return 'zu-gross';
      default:
        return 'fehler';
    }
  }
}
