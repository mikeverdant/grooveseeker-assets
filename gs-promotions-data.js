/**
 * gs-promotions-data.js
 * GrooveSeeker Promotions — Data Enrichment Layer
 * Upload to: grooveseeker-assets GitHub repo
 */
(function () {

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaSiUQPUQggMlzKNtVgoKZbK2KQRH10F5CodNY1zdJxdAuDdY6MWy-Xdgap7VA-hqQ571QvHOcwpOL/pub?output=csv';

  // No proxies needed -- using direct CORS-enabled APIs

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

  // ── Fetch description via Clearbit autocomplete (CORS-enabled, no key) ──
  async function fetchDescription(venue) {
    try {
      const domain = new URL(venue.url).hostname.replace('www.', '');
      // First try domain lookup
      const res  = await fetch(
        'https://autocomplete.clearbit.com/v1/companies/suggest?query=' + encodeURIComponent(domain),
        { headers: { 'Accept': 'application/json' } }
      );
      const data = await res.json();
      if (data && data.length > 0) {
        // Find best match by domain
        const match = data.find(c => c.domain && c.domain.includes(domain)) || data[0];
        if (match.description && match.description.length > 10) {
          venue._desc = match.description.substring(0, 160);
          return;
        }
      }
      // Fallback: try venue name search
      const res2  = await fetch(
        'https://autocomplete.clearbit.com/v1/companies/suggest?query=' + encodeURIComponent(venue.name),
        { headers: { 'Accept': 'application/json' } }
      );
      const data2 = await res2.json();
      if (data2 && data2.length > 0) {
        const match2 = data2.find(c => c.domain && c.domain.includes(domain)) || null;
        if (match2 && match2.description && match2.description.length > 10) {
          venue._desc = match2.description.substring(0, 160);
        }
      }
    } catch { /* silent -- card renders without description */ }
  }

  // ── Geocode via Nominatim (direct, CORS-enabled) ──────────────────
  async function geocodeVenue(venue) {
    try {
      const q   = encodeURIComponent(venue.name + ' San Francisco CA');
      const res = await fetch(
        'https://nominatim.openstreetmap.org/search?format=json&q=' + q + '&limit=1&addressdetails=1',
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'GrooveSeeker/1.0' } }
      );
      const data = await res.json();
      if (data && data.length > 0) {
        venue._lat = parseFloat(data[0].lat);
        venue._lng = parseFloat(data[0].lon);
        const a    = data[0].address || {};
        const street = [(a.house_number || ''), (a.road || '')].filter(Boolean).join(' ');
        const city   = a.city || a.town || a.village || 'San Francisco';
        venue._address = [street, city].filter(Boolean).join(', ');
      }
    } catch { /* no coords -- geo filter skips this venue */ }
  }

  // ── Enrich both ───────────────────────────────────────────────────
  async function enrich(venue) {
    await Promise.all([fetchDescription(venue), geocodeVenue(venue)]);
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
        category:         (r.category || '').trim(),
        _desc:    '',
        _address: '',
        _lat:     null,
        _lng:     null,
      }));

      // Set immediately -- cards render from sheet data right away
      window.GSPromos      = venues;
      window.GSPromosReady = true;
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback(venues);

      // Enrich in background -- always re-render when done
      try {
        await Promise.all(venues.map(enrich));
      } catch(enrichErr) {
        console.warn('[GSPromos] Enrichment error:', enrichErr);
      }
      // Re-render regardless -- picks up any desc/address that populated
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback(venues);

    } catch (e) {
      console.warn('[GSPromos] Load failed:', e);
      window.GSPromosReady = true;
      if (typeof window.GSPromosCallback === 'function') window.GSPromosCallback([]);
    }
  }

  init();
})();
