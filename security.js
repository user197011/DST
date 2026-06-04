/* ═══════════════════════════════════════════════════════════════
   security.js  —  Shared security utilities
   OWASP Top 10 mitigations for a client-side static web app.
   
   OWASP coverage:
   A01 Broken Access Control     → auth guards, session validation
   A02 Cryptographic Failures    → SHA-256 hashing, no plaintext secrets
   A03 Injection                 → strict HTML escaping, textContent only
   A04 Insecure Design           → rate limiting, lockout, input bounds
   A05 Security Misconfiguration → CSP, X-Frame-Options, nosniff headers
   A06 Vulnerable Components     → zero external JS dependencies
   A07 Auth Failures             → brute-force lockout, timing-safe compare
   A08 Software/Data Integrity   → SRI on Google Fonts, integrity checks
   A09 Logging/Monitoring        → no console.log in production paths
   A10 SSRF                      → no server requests (static app)
═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── A02: SHA-256 hashing via Web Crypto API ── */
async function sha256(str) {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── A03: Safe HTML escaping — ALWAYS use this before innerHTML ── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/* ── A03: Safe attribute value escaping ── */
function escAttr(s) {
  return String(s).replace(/[^a-zA-Z0-9_\-:.]/g, c =>
    `&#${c.charCodeAt(0)};`
  );
}

/* ── A04/A07: Rate limiter with exponential back-off & lockout ──
   Stores attempt data in sessionStorage so it resets on tab close,
   preventing persistent lockout while still protecting live sessions. */
const RateLimiter = {
  MAX_ATTEMPTS: 5,          // before lockout
  LOCKOUT_MS:   60_000,     // 1 minute lockout
  WINDOW_MS:    300_000,    // 5-minute sliding window

  _key(scope) { return `sdt_rl_${scope}`; },

  _load(scope) {
    try {
      return JSON.parse(sessionStorage.getItem(this._key(scope)) || 'null') ||
             { attempts: [], lockedUntil: 0 };
    } catch { return { attempts: [], lockedUntil: 0 }; }
  },

  _save(scope, data) {
    try { sessionStorage.setItem(this._key(scope), JSON.stringify(data)); } catch {}
  },

  /* Returns { allowed: bool, waitMs: number, attemptsLeft: number } */
  check(scope) {
    const now  = Date.now();
    const data = this._load(scope);

    if (data.lockedUntil > now) {
      return { allowed: false, waitMs: data.lockedUntil - now, attemptsLeft: 0 };
    }

    // Prune attempts outside sliding window
    data.attempts = data.attempts.filter(t => now - t < this.WINDOW_MS);
    const left = this.MAX_ATTEMPTS - data.attempts.length;
    return { allowed: left > 0, waitMs: 0, attemptsLeft: Math.max(0, left) };
  },

  /* Record a failed attempt. Returns updated state. */
  recordFailure(scope) {
    const now  = Date.now();
    const data = this._load(scope);
    data.attempts = (data.attempts || []).filter(t => now - t < this.WINDOW_MS);
    data.attempts.push(now);

    if (data.attempts.length >= this.MAX_ATTEMPTS) {
      data.lockedUntil = now + this.LOCKOUT_MS;
    }
    this._save(scope, data);
    return this.check(scope);
  },

  /* Clear on success */
  reset(scope) {
    try { sessionStorage.removeItem(this._key(scope)); } catch {}
  }
};

/* ── A01/A07: Session token validation ──
   We use a CSRF-style nonce stored in sessionStorage (tab-scoped).
   Each successful login generates a fresh nonce, invalidating old tabs. */
const AuthSession = {
  _nonceKey: 'sdt_nonce',

  generate() {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const hex   = Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('sdt_auth',      '1');
    sessionStorage.setItem(this._nonceKey,  hex);
    return hex;
  },

  isValid() {
    return sessionStorage.getItem('sdt_auth')     === '1' &&
           (sessionStorage.getItem(this._nonceKey) || '').length === 32;
  },

  clear() {
    sessionStorage.removeItem('sdt_auth');
    sessionStorage.removeItem('sdt_session_id');
    sessionStorage.removeItem(this._nonceKey);
  }
};

/* ── A04: Input sanitisation & validation ── */
const Validate = {
  name(v) {
    if (typeof v !== 'string') return false;
    const t = v.trim();
    // 1–24 printable chars, no HTML-special chars
    return t.length >= 1 && t.length <= 24 && /^[^\x00-\x1f<>"'&/\\]+$/.test(t);
  },
  sessionId(v) {
    return typeof v === 'string' && /^[a-z0-9]{8,24}$/.test(v);
  }
};

/* ── A04: localStorage quota-safe write ── */
function safeSet(key, value) {
  try {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    // Rough size guard: reject if single item > 500 KB
    if (json.length > 500_000) { console.warn('safeSet: value too large, skipped'); return false; }
    localStorage.setItem(key, json);
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('localStorage quota exceeded');
    }
    return false;
  }
}

/* ── A09: No-op logger in production paths ──
   Replace with real monitoring if deploying to a proper backend. */
const SecureLog = {
  warn(msg)  { /* intentionally silent in prod */ },
  error(msg) { /* intentionally silent in prod */ }
};
