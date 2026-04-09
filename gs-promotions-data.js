/**
 * gs-promotions-data.js
 * GrooveSeeker Promotions — Data Enrichment Layer
 * Upload to: grooveseeker-assets GitHub repo
 */
(function () {

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaSiUQPUQggMlzKNtVgoKZbK2KQRH10F5CodNY1zdJxdAuDdY6MWy-Xdgap7VA-hqQ571QvHOcwpOL/pub?output=csv';

  const PROXIES = [
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
  ];

  // ── CSV parser -- handles multiline quoted fields ──────────────────
  function parseCSV(text) {
    const rows = [];
    let col = '', inQ = false, row = [];
    const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '"') {
        if (inQ && t[i+1] === '"') { col += '"'; i++; }
        else { inQ = !inQ; }
      } else if (c === ',' && !inQ) {
        row.push(col); col = '';
      } else if (c === '\n' && !inQ) {
        row.push(col); col = '';
        if (row.some(f => f.trim().length)) rows.push(row);
        row = [];
      } else { col += c; }
    }
    row.push(col);
    if (row.some(f => f.trim().length)) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g,''));
    return rows.slice(1).map(cols => {
      const obj = {};
      headers.forEach((h,i) => { obj[h] = (cols[i]||'').trim(); });
      return obj;
    }).filter(r => r.name && r.name.trim().length > 0);
  }

  // ── Clean URL ──────────────────────────────────────────────────────
  function cleanUrl(raw) {
    if (!raw) return '';
    const s = raw.replace(/[.,\s]+$/, '').trim();
    return s.match(/^https?:\/\//) ? s : 'https://' + s;
  }

  // ── Logo ───────────────────────────────────────────────────────────
  function logoUrl(r) {
    if (r.logo_url && r.logo_url.trim()) return r.logo_url.trim();
    try {
      const domain = new URL(cleanUrl(r.url)).hostname;
      return 'https://logo.clearbit.com/' + domain;
    } catch { return ''; }
  }

  // ── Fetch HTML through proxy chain ────────────────────────────────
  async function fetchHtml(url) {
    for (const proxy of PROXIES) {
      try {
        const res  = await fetch(proxy(url));
        if (!res.ok) continue;
        const data = await res.json();
        const html = data.contents || (typeof data === 'string' ? data : '');
        if (html && html.length > 200) return html;
      } catch { /* try next */ }
    }
    return '';
  }

  function extractDesc(html) {
    const m = html.match(/property=["']og:description["'][^>]*content=["']([^"']{10,})/i)
           || html.match(/content=["']([^"']{10,})["'][^>]*property=["']og:description/i)
           || html.match(/name=["']description["'][^>]*content=["']([^"']{10,})/i)
           || html.match(/content=["']([^"']{10,})["'][^>]*name=["']description/i);
    return m ? m[1].trim().substring(0, 160) : '';
  }

  // ── Enrich: description + geocode ─────────────────────────────────
  async function enrich(venue) {
    // Description via proxy chain
    try {
      const html = await fetchHtml(venue.url);
      if (html) venue._desc = extractDesc(html);
    } catch {}

    // Geocode -- store lat, lng AND a clean address string
    try {
      const q   = encodeURIComponent(venue.name + ' San Francisco CA');
      const res = await fetch(
        'https://nominatim.openstreetmap.org/search?format=json&q=' + q + '&limit=1&addressdetails=1',
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (data.length) {
        venue._lat  = parseFloat(data[0].lat);
        venue._lng  = parseFloat(data[0].lon);
        // Build a clean short address: house_number + road + city
        const a = data[0].address || {};
        const parts = [
          (a.house_number ? a.house_number + ' ' : '') + (a.road || ''),
          a.city || a.town || a.village || 'San Francisco'
        ].filter(Boolean);
        venue._address = parts.join(', ');
      }
    } catch {}
  }

  // ── Main ──────────────────────────────────────────────────────────
  async function init() {
    window.GSPromosReady = false;
    window.GSPromos = [];
    try {
      const res  = await fetch(SHEET_URL);
      const text = await res.text();
      const rows = parseCSV(text);

      const venues = rows.map(r => ({
        name:             r.name,
        url:              cleanUrl(r.url),
        deal_1:           r.deal_1           || '',
        deal_2:           r.deal_2           || '',
        deal_3:           r.deal_3           || '',
        deal_description: r.deal_description || '',
        logo:             logoUrl(r),
        // Pass category exactly as typed in sheet -- no translation
        category:         (r.category || '').trim(),
        _desc:    '',
        _address: '',
        _lat:     null,
        _lng:     null,
      }));

      // First pass -- render immediately
      window.GSPromos      = venues;
      window.GSPromosReady = true;
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback(venues);

      // Enrich in background, re-render when complete
      await Promise.all(venues.map(enrich));
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback(venues);

    } catch (e) {
      console.warn('[GSPromos] Load failed:', e);
      window.GSPromosReady = true;
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback([]);
    }
  }

  init();
})();
