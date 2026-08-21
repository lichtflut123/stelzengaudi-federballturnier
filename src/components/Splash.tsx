import { useEffect, useState } from 'react';

const SEEN_KEY = 'stelzengaudi:splash';
const OPENS_KEY = 'stelzengaudi:opens';

type Variant = 'knochen' | 'eichel';

// Verhindert, dass der Öffnungszähler im Entwicklungsmodus doppelt hochzählt.
let counted = false;

/** Zählt die Öffnungen; jede zwanzigste bekommt das Easter Egg. */
function nextVariant(): Variant {
  if (counted) return 'knochen';
  counted = true;
  try {
    const opens = (Number(localStorage.getItem(OPENS_KEY)) || 0) + 1;
    localStorage.setItem(OPENS_KEY, String(opens));
    return opens % 20 === 0 ? 'eichel' : 'knochen';
  } catch {
    return 'knochen';
  }
}

/**
 * Startbild: Schweinsstelze mit Federballschläger als Strichzeichnung,
 * gerahmt von einem offenen Sechseck. Erscheint kurz beim Öffnen –
 * einmal je Sitzung, damit es beim Live-Neuladen nicht nervt.
 */
export function Splash() {
  const [init] = useState<{ phase: 'zeigen' | 'weg'; variant: Variant }>(() => {
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return { phase: 'weg', variant: 'knochen' };
    } catch {
      /* dann eben jedes Mal */
    }
    return { phase: 'zeigen', variant: nextVariant() };
  });
  const [phase, setPhase] = useState<'zeigen' | 'ausblenden' | 'weg'>(init.phase);

  useEffect(() => {
    // Läuft genau einmal: die Timer dürfen nicht an `phase` hängen, sonst
    // würde der Wechsel zu „ausblenden" den „weg"-Timer gleich mit aufräumen.
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* dann eben jedes Mal */
    }
    const hide = setTimeout(() => setPhase((p) => (p === 'zeigen' ? 'ausblenden' : p)), 1400);
    const gone = setTimeout(() => setPhase((p) => (p === 'weg' ? p : 'weg')), 1900);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'weg') return null;

  return (
    <div
      className={`splash ${phase === 'ausblenden' ? 'splash--out' : ''} ${
        init.variant === 'eichel' ? 'splash--egg' : ''
      }`}
      aria-hidden="true"
      onClick={() => setPhase('weg')}
    >
      <StelzenLogo className="splash__logo" variant={init.variant} />
      <div className="splash__title">Stelzengaudi</div>
      <div className="splash__subtitle">Federballturnier</div>
    </div>
  );
}

/**
 * Kleine, kräftige Fassung für Kopfzeile und enge Plätze: die fein
 * gestrichelte große Zeichnung verschwimmt unter 40 Pixeln zu Grau.
 */
export function StelzenLogoKlein({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Stelzengaudi"
    >
      <path d="M33 12 C32 10 34 8 36 8 C37 6 40 6 41 8 C43 7 45 9 44 11 C46 12 45 15 43 16 L38 26 L33 24 Z" />
      <path d="M33 24 C24 26 17 32 15 40 C13 48 18 55 26 57 C35 59 44 56 47 49 C50 42 48 33 43 28 C41 26 39 25 38 26" />
      <path d="M18 40 C24 38 33 37 41 40" strokeWidth="2" />
      <path d="M19 48 C26 46 36 46 44 49" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * Die Stelze mit Schläger – feine Linien, offener Sechseck-Rahmen.
 * `variant: 'eichel'` ist das Easter Egg der Runde (jede 20. Öffnung).
 */
export function StelzenLogo({ className, variant = 'knochen' }: { className?: string; variant?: Variant }) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 400"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Schweinsstelze mit Federballschläger"
    >
      {/* Offener Sechseck-Rahmen, wie mit dem Fineliner angerissen */}
      <g strokeWidth="2.4">
        <path d="M120 86 L200 40 L280 86" />
        <path d="M128 92 L200 50 L272 92" strokeWidth="1.4" />
        <path d="M334 130 L334 205" />
        <path d="M328 136 L328 196" strokeWidth="1.4" strokeDasharray="24 9" />
        <path d="M334 248 L272 328" />
        <path d="M328 244 L276 312" strokeWidth="1.4" />
        <path d="M130 332 L66 276 L66 212" />
        <path d="M72 268 L72 218" strokeWidth="1.4" />
        <path d="M66 178 L66 142" strokeWidth="1.4" strokeDasharray="14 8" />
      </g>

      {/* Kleines Fenster-Detail wie in der Vorlage */}
      <g strokeWidth="1.6">
        <rect x="92" y="148" width="20" height="20" rx="2" />
        <path d="M102 148 L102 168 M92 158 L112 158" />
      </g>

      {/* Federballschläger, rechts angelehnt */}
      <g strokeWidth="2">
        <ellipse cx="292" cy="132" rx="30" ry="41" transform="rotate(22 292 132)" />
        <ellipse cx="292" cy="132" rx="24" ry="34" transform="rotate(22 292 132)" strokeWidth="1.1" />
        <g strokeWidth="0.85" opacity="0.9">
          <path d="M272 104 L306 158 M279 97 L314 150 M287 92 L320 140 M266 114 L298 165" />
          <path d="M268 146 L314 114 M264 136 L309 105 M273 156 L318 124 M281 164 L320 136" />
        </g>
        <path d="M276 170 L252 236" />
        <path d="M281 172 L257 238" />
        <path d="M252 236 L242 268 L251 271 L261 239 Z" strokeWidth="1.8" />
        <path d="M245 262 L254 265 M247 255 L256 258 M249 248 L258 251" strokeWidth="1" />
      </g>

      {/* Die Schweinsstelze: kurzer Knochen, Fleischkragen, breiter Körper */}
      <g strokeWidth="2.2">
        {variant === 'eichel' ? (
          <>
            {/* Easter Egg: der Knochen, wie ihn die Runde einmal sah */}
            <path
              d="M186 172 L190 128
                 C176 126 172 113 180 105
                 C184 87 196 78 206 78
                 C216 78 228 87 232 105
                 C240 113 236 126 222 128
                 L226 170"
            />
            <path d="M181 111 C192 120 221 120 231 111" strokeWidth="1.3" />
            <path d="M206 86 L206 97" strokeWidth="1.6" />
          </>
        ) : (
          <>
            {/* Knochen mit Doppelknubbel */}
            <path
              d="M186 172 L190 124
                 C180 116 184 98 198 96
                 C202 86 218 84 224 96
                 C236 96 242 112 232 120
                 L226 170"
            />
            <path d="M194 118 C202 124 212 126 222 122" strokeWidth="1.1" />
          </>
        )}
        {/* Aufgerollter Fleischkragen um den Knochen */}
        <path
          d="M144 192
             C146 178 158 168 170 174
             C176 162 192 158 202 166
             C210 156 226 158 232 168
             C244 168 252 180 248 192"
        />
        <path d="M150 198 C170 186 190 188 202 192 C216 184 234 188 244 198" strokeWidth="1.3" />
        {/* Körper: breit und bauchig */}
        <path
          d="M144 192
             C118 212 100 242 100 274
             C100 312 126 340 166 346
             C206 352 244 336 254 304
             C262 276 258 240 248 192"
        />
        {/* Fleisch-Wulste */}
        <path d="M136 208 C120 226 110 248 108 268" strokeWidth="1.3" />
        <path d="M110 250 C136 262 176 268 214 262" strokeWidth="1.4" />
        <path d="M104 286 C134 300 180 304 226 294" strokeWidth="1.3" />
        <path d="M118 318 C148 330 192 332 226 320" strokeWidth="1.2" />
        {/* Schwarte rechts */}
        <path d="M240 214 C250 240 252 272 244 298" strokeWidth="1.1" />
        {/* Schraffur unten links und am Kragen */}
        <g strokeWidth="0.8" opacity="0.85">
          <path d="M108 276 L124 260 M110 292 L128 274 M116 306 L134 288 M124 320 L142 302 M136 332 L154 314" />
          <path d="M156 178 L162 186 M172 172 L178 180 M208 168 L214 176 M228 170 L234 178" />
        </g>
      </g>
    </svg>
  );
}
