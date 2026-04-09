/**
 * gs-promotions-data.js
 * GrooveSeeker Promotions — Data Enrichment Layer
 * Hosted on GitHub, loaded before the GoDaddy embed.
 * Fetches the Google Sheet, enriches each venue, exposes window.GSPromos.
 */

(function () {

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaSiUQPUQggMlzKNtVgoKZbK2KQRH10F5CodNY1zdJxdAuDdY6MWy-Xdgap7VA-hqQ571QvHOcwpOL/pub?output=csv';
  const PROXY     = 'https://api.allorigins.win/get?url=';

  // ── CSV parser -- handles multiline quoted fields ──────────────────
  function parseCSV(text) {
    const rows = [];
    let col = '', inQ = false, row = [];
    const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '"') {
        if (inQ && t[i + 1] === '"') { col += '"'; i++; }
        else { inQ = !inQ; }
      } else if (c === ',' && !inQ) {
        row.push(col); col = '';
      } else if (c === '\n' && !inQ) {
        row.push(col); col = '';
        if (row.some(f => f.trim().length)) rows.push(row);
        row = [];
      } else {
        col += c;
      }
    }
    row.push(col);
    if (row.some(f => f.trim().length)) rows.push(row);
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));
    return rows.slice(1).map(cols => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
      return obj;
    }).filter(r => r.name && r.name.trim().length > 0);
  }

  // ── Clean URL -- strip trailing punctuation, ensure https ─────────
  function cleanUrl(raw) {
    if (!raw) return '';
    return (raw.replace(/[.,\s]+$/, '').trim()).replace(/^(?!https?:\/\/)/, 'https://');
  }

  // ── Logo URL -- sheet value first, Clearbit fallback ──────────────
  function logoUrl(venue) {
    if (venue.logo_url && venue.logo_url.trim()) return venue.logo_url.trim();
    try {
      const domain = new URL(cleanUrl(venue.url)).hostname;
      return `https://logo.clearbit.com/${domain}`;
    } catch { return ''; }
  }

  // ── Fetch og:description from venue URL ───────────────────────────
  async function fetchDescription(venue) {
    if (!venue.url) return;
    try {
      const res  = await fetch(PROXY + encodeURIComponent(cleanUrl(venue.url)));
      const data = await res.json();
      const html = data.contents || '';
      const m = html.match(/property=["']og:description["'][^>]*content=["']([^"']{10,})/i)
             || html.match(/content=["']([^"']{10,})["'][^>]*property=["']og:description/i)
             || html.match(/name=["']description["'][^>]*content=["']([^"']{10,})/i)
             || html.match(/content=["']([^"']{10,})["'][^>]*name=["']description/i);
      if (m && m[1]) venue._desc = m[1].trim().substring(0, 140);
    } catch { /* silent fail -- card still renders without description */ }
  }

  // ── Geocode venue name via Nominatim ──────────────────────────────
  async function geocode(venue) {
    try {
      const q   = encodeURIComponent(venue.name + ' San Francisco CA');
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`, {
        headers: { 'Accept-Language': 'en' }
      });
      const data = await res.json();
      if (data.length) {
        venue._lat = parseFloat(data[0].lat);
        venue._lng = parseFloat(data[0].lon);
      }
    } catch { /* no coords -- geo filter will skip this venue */ }
  }

  // ── Category normalisation ─────────────────────────────────────────
  // Sheet should have: food | venue | shop
  // Fallback sniffs the name if column is missing/blank
  function normaliseCategory(venue) {
    const raw = (venue.category || '').toLowerCase().trim();
    if (['food','venue','shop'].includes(raw)) return raw;
    // Fallback keyword sniff on name
    const n = venue.name.toLowerCase();
    if (/restaurant|bar|cafe|coffee|boba|taco|pizza|sushi|burger|grill|diner|brewery|cantina|kitchen/.test(n)) return 'food';
    if (/theater|theatre|club|concert|lounge|arena|hall|nightclub/.test(n)) return 'venue';
    if (/shop|store|studio|records|guitar|boutique|market|gallery/.test(n)) return 'shop';
    return 'other';
  }

  // ── Main ───────────────────────────────────────────────────────────
  async function init() {
    // Signal that we're loading
    window.GSPromosReady = false;
    window.GSPromos      = [];

    try {
      const res  = await fetch(SHEET_URL);
      const text = await res.text();
      const rows = parseCSV(text);

      // Enrich each venue
      const venues = rows.map(r => ({
        name:             r.name,
        url:              cleanUrl(r.url),
        deal_1:           r.deal_1  || '',
        deal_2:           r.deal_2  || '',
        deal_3:           r.deal_3  || '',
        deal_description: r.deal_description || '',
        logo:             logoUrl(r),
        category:         normaliseCategory(r),
        _desc:            '',
        _lat:             null,
        _lng:             null,
      }));

      // Run enrichment in parallel -- page renders without waiting
      // but re-renders when metadata arrives via the callback below
      const enrichment = venues.map(v =>
        Promise.all([fetchDescription(v), geocode(v)])
      );

      // First pass -- render immediately with what we have
      window.GSPromos = venues;
      window.GSPromosReady = true;
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback(venues);

      // Second pass -- re-render once all enrichment is done
      await Promise.all(enrichment);
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback(venues);

    } catch (e) {
      console.warn('[GSPromos] Failed to load venue data:', e);
      window.GSPromosReady = true; // unblock embed even on failure
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback([]);
    }
  }

  init();

})();
