// Seiten-Klassifizierer fuer den Aktivitaets-Tracker. Rein, ohne Electron.
// Gibt nur feste Namen oder einen bereinigten App-Namen zurueck, nie Titel- oder URL-Text.

// Domain (registrierte Domain, Suffix-Match) -> Name
const DOMAINS = [
  ['onlymonster.ai', 'OnlyMonster'],
  ['onlyfans.com', 'OnlyFans'],
  ['fansly.com', 'Fansly'],
  ['chatpro.app', 'ChatPro'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['netflix.com', 'Netflix'],
  ['tiktok.com', 'TikTok'],
  ['instagram.com', 'Instagram'],
  ['facebook.com', 'Facebook'],
  ['x.com', 'X'],
  ['twitter.com', 'X'],
  ['reddit.com', 'Reddit'],
  ['discord.com', 'Discord'],
  ['telegram.org', 'Telegram'],
  ['t.me', 'Telegram'],
  ['whatsapp.com', 'WhatsApp'],
  ['twitch.tv', 'Twitch'],
  ['spotify.com', 'Spotify'],
];

// Titel-Stichworte (ganze Woerter, case-insensitive) -> Name
const KEYWORDS = [
  ['OnlyMonster', 'OnlyMonster'],
  ['OnlyFans', 'OnlyFans'],
  ['Fansly', 'Fansly'],
  ['ChatPro', 'ChatPro'],
  ['YouTube', 'YouTube'],
  ['Netflix', 'Netflix'],
  ['TikTok', 'TikTok'],
  ['Instagram', 'Instagram'],
  ['Facebook', 'Facebook'],
  ['Reddit', 'Reddit'],
  ['Discord', 'Discord'],
  ['Telegram', 'Telegram'],
  ['WhatsApp', 'WhatsApp'],
  ['Google Docs', 'Google Docs'],
  ['Google Sheets', 'Google Sheets'],
  ['Twitch', 'Twitch'],
  ['Spotify', 'Spotify'],
];

const BROWSERS = ['chrome', 'google chrome', 'microsoft edge', 'msedge', 'firefox', 'safari', 'brave', 'opera', 'arc'];

function hostAndPath(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: u.pathname || '' };
  } catch (e) {
    return null;
  }
}

function fromUrl(url) {
  const hp = hostAndPath(url);
  if (!hp) return null;
  const { host, path } = hp;
  if (host === 'docs.google.com') {
    if (path.startsWith('/document')) return 'Google Docs';
    if (path.startsWith('/spreadsheets')) return 'Google Sheets';
    return null;
  }
  for (const [domain, name] of DOMAINS) {
    if (host === domain || host.endsWith('.' + domain)) return name;
  }
  return null;
}

function fromTitle(title) {
  if (!title || typeof title !== 'string') return null;
  for (const [kw, name] of KEYWORDS) {
    const re = new RegExp('(^|[^A-Za-z0-9_])' + kw.replace(/ /g, '\\s+') + '($|[^A-Za-z0-9_])', 'i');
    if (re.test(title)) return name;
  }
  return null;
}

function sanitizeApp(appName) {
  if (!appName || typeof appName !== 'string') return null;
  const s = appName.replace(/[^\w .\-]/g, '').trim().slice(0, 40).trim();
  return s || null;
}

function classifySite({ appName, title, url } = {}) {
  const hit = fromUrl(url) || fromTitle(title);
  if (hit) return hit;
  const isBrowser = typeof appName === 'string' && BROWSERS.includes(appName.trim().toLowerCase());
  if (isBrowser) return 'Browser: other';
  return sanitizeApp(appName);
}

module.exports = { classifySite };
