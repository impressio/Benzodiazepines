/* =====================================================================
 * data.js - Loads the app's domain data.
 *
 * All drug, molecular, receptor, route, regional and model data live in
 * assets/data/properties.json, the single source to correct them (units are
 * documented in its "meta" section). BZD.load() fetches that file once and
 * exposes its content on window.BZD before the app starts (see js/main.js):
 * subtypes, otherSubunits, drugs, gaba, routes, drugRoutes, pathways,
 * modifiers, regions, model, substancesTable, references and sources (the
 * literature behind each value) and validation (observed data for the PK model).
 *
 * Settings (URL ?lang=sv&region=eu, remembered in localStorage):
 *  - language: interface texts from assets/i18n/<lang>.json (BZD.t); its "data"
 *    section translates descriptive texts of properties.json by path;
 *  - region: "us" (base data: FDA labels, US brands, ng/mL), "eu" (values that
 *    differ in EU SmPCs as published in FASS, Swedish product names, µg/L) or
 *    "se" (the EU values with plasma concentrations in nmol/L), merged from
 *    properties.json "jurisdictions" over the base data.
 * BZD.raw keeps the unmodified file (sources, validation and calibration refer to it).
 * ===================================================================== */
window.BZD = (function () {
  'use strict';

  const INSENSITIVE = 1e5; // nM: stands for "no measurable binding" (null Ki in the data file)

  /* Display colour per α isoform (shades of the α colour; grey = BZD-insensitive) */
  const isoformColor = { a1: '#5B8DEF', a2: '#3B6FD8', a3: '#274EA8', a5: '#4C3FB0', a4: '#868E96', a6: '#868E96' };

  const BZD = { INSENSITIVE, isoformColor, load };

  /** One label format for every α-isoform selector */
  BZD.isoformLabel = (k) => {
    const v = BZD.subtypes[k];
    return `${v.label} · ${BZD.t(v.bzdSensitive ? 'iso.sensitive' : 'iso.insensitive')} (${v.residue.split(' (')[0]})`;
  };

  /** Plot font from the CSS typography tokens (TYPOGRAPHY.md): Inter stack, --fs-small (12px), --ink */
  BZD.plotFont = (extra) => {
    const css = getComputedStyle(document.documentElement), v = (k) => css.getPropertyValue(k).trim();
    return { family: v('--font') || 'Inter, sans-serif', size: parseFloat(v('--fs-small')) || 12, color: v('--ink') || '#1e1e1e', ...extra };
  };

  /* ---------- Settings: language and region ---------- */
  const LANGS = ['en', 'sv'], REGIONS = ['us', 'eu', 'se'];
  const pick = (name, allowed, fallback) => {
    const q = new URLSearchParams(location.search).get(name);
    let v = allowed.includes(q) ? q : null;
    try { if (v) localStorage.setItem(`bzd-${name}`, v); else v = localStorage.getItem(`bzd-${name}`); } catch (e) { /* storage unavailable */ }
    return allowed.includes(v) ? v : fallback;
  };
  // Defaults from the browser: the first preferred language we support; the region from its country
  // (Swedish browser or interface → SE; en-US and non-European locales → US; other European locales such as en-GB → EU)
  const browserLangs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']).map(l => String(l).split(';')[0].trim().toLowerCase());
  const EUROPE = ['at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'no', 'is', 'li', 'ch', 'gb', 'uk'];
  const defaultRegion = (lang) => {
    const country = browserLangs.map(l => l.split('-')[1]).find(Boolean);
    if (lang === 'sv' || country === 'se' || browserLangs[0].split('-')[0] === 'sv') return 'se';   // Swedish browser or interface
    return country && EUROPE.includes(country) ? 'eu' : 'us';
  };
  const detected = (browserLangs.find(l => LANGS.includes(l.split('-')[0])) || 'en').split('-')[0];
  BZD.lang = pick('lang', LANGS, detected);
  BZD.region = pick('region', REGIONS, defaultRegion(BZD.lang));
  document.documentElement.lang = BZD.lang;
  /** Reload with a changed setting (all modules start from the data again). Changing the language also
   *  selects that language's regional values and units; the region can then be changed on its own. */
  BZD.setSetting = (name, value) => {
    const set = { [name]: value };
    if (name === 'lang') set.region = defaultRegion(value);
    const u = new URL(location.href);
    Object.entries(set).forEach(([k, v]) => {
      try { localStorage.setItem(`bzd-${k}`, v); } catch (e) { /* storage unavailable */ }
      u.searchParams.set(k, v);
    });
    location.href = u.toString();
  };

  /* ---------- Interface texts ---------- */
  let ui = {}, uiEn = {};
  /** Interface text by key, with {name} placeholders filled from vars; falls back to English, then the key */
  BZD.t = (key, vars) => {
    const s = ui[key] ?? uiEn[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
  };
  /** Number in the interface language (decimal comma in Swedish); d = fixed decimals */
  BZD.fmt = (x, d = 0) => (x === null || x === undefined || Number.isNaN(+x) ? '-'
    : new Intl.NumberFormat(BZD.lang === 'sv' ? 'sv-SE' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).format(+x));
  /**
   * Numeric value of an <input type="number">, limited to its min/max attributes (and rounded if
   * int); empty or non-numeric input gives the fallback. Every model input is read through this.
   */
  BZD.numInput = (id, fallback, int = false) => {
    const el = document.getElementById(id);
    let v = el ? parseFloat(el.value) : NaN;
    if (!Number.isFinite(v)) return fallback;
    if (int) v = Math.round(v);
    const lo = parseFloat(el.min), hi = parseFloat(el.max);
    if (Number.isFinite(lo)) v = Math.max(lo, v);
    if (Number.isFinite(hi)) v = Math.min(hi, v);
    return v;
  };
  /** Plotly decimal and thousands separators for the interface language */
  BZD.plotSeparators = () => (BZD.lang === 'sv' ? ', ' : '.,');
  /** Plasma concentration unit of the selected region (ng/mL and µg/L are numerically equal; SE uses nmol/L) */
  BZD.concUnit = () => (BZD.jurisdiction && BZD.jurisdiction.concentrationUnit) || 'ng/mL';
  BZD.molar = () => BZD.concUnit() === 'nmol/L';
  /** A plasma concentration stored in ng/mL, in the unit of the selected region (mw in g/mol for molar units) */
  BZD.conc = (ngPerMl, mw) => (BZD.molar() && mw ? ngPerMl * 1000 / mw : ngPerMl);
  /** Unit of an area under the curve (concentration × time) */
  BZD.aucUnit = () => ({ 'µg/L': 'µg·h/L', 'nmol/L': 'nmol·h/L' }[BZD.concUnit()] || 'ng·h/mL');

  /** Translate static page text: [data-i18n] (inner HTML) and [data-i18n-<attribute>] */
  BZD.translatePage = (root = document) => {
    root.querySelectorAll('[data-i18n]').forEach(el => { const s = BZD.t(el.dataset.i18n); if (s !== el.dataset.i18n) el.innerHTML = s; });
    ['placeholder', 'title', 'aria-label', 'alt'].forEach(a => root.querySelectorAll(`[data-i18n-${a}]`).forEach(el => {
      const k = el.getAttribute(`data-i18n-${a}`), s = BZD.t(k); if (s !== k) el.setAttribute(a, s);
    }));
    root.querySelectorAll('[data-setting]').forEach(b => b.setAttribute('aria-pressed', String(BZD[b.dataset.setting] === b.dataset.value)));
    const tog = root.getElementById ? root.getElementById('settings-toggle') : null;
    if (tog) tog.textContent = `${BZD.lang.toUpperCase()} · ${BZD.region.toUpperCase()}`;
  };

  /** Settings panel in the top bar (both pages): language and region, applied by reloading */
  BZD.initSettings = () => {
    const tog = document.getElementById('settings-toggle'), panel = document.getElementById('settings-panel');
    if (!tog || !panel) return;
    const show = (open) => { panel.hidden = !open; tog.setAttribute('aria-expanded', String(open)); };
    tog.addEventListener('click', (e) => { e.stopPropagation(); show(panel.hidden); });
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-setting]'); if (!b) return;
      if (BZD[b.dataset.setting] !== b.dataset.value) BZD.setSetting(b.dataset.setting, b.dataset.value); else show(false);
    });
    document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.settings')) show(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  /** Deep merge of an overlay into data (objects by key, arrays by index) */
  const merge = (base, over) => {
    Object.entries(over || {}).forEach(([k, v]) => {
      const key = Array.isArray(base) ? +k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && base[key] && typeof base[key] === 'object') merge(base[key], v);
      else base[key] = clone(v);
    });
    return base;
  };
  /** Set a value by path ("drugs.diazepam.use", array indexes allowed) */
  const setPath = (o, path, v) => {
    const ks = path.split('.'); let x = o;
    for (let i = 0; i < ks.length - 1; i++) { x = x?.[Array.isArray(x) ? +ks[i] : ks[i]]; if (!x) return; }
    const last = ks[ks.length - 1]; if (x && (Array.isArray(x) ? +last : last) in x) x[Array.isArray(x) ? +last : last] = v;
  };
  const kiFix = (drugs) => Object.values(drugs).forEach(d => {
    d.pd.ki = Object.fromEntries(Object.entries(d.pd.ki).map(([s, x]) => [s, x === null ? INSENSITIVE : x]));
  });

  let loading = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      if (location.protocol === 'file:') {
        throw new Error('the data file needs a web server: run "python3 -m http.server" in the project folder and open http://localhost:8000');
      }
      const res = await fetch('assets/data/properties.json');
      if (!res.ok) throw new Error(`could not load assets/data/properties.json (HTTP ${res.status})`);
      const raw = await res.json();
      const [en, tr] = await Promise.all(['en', BZD.lang].map(async (l, i) => {
        if (i === 1 && l === 'en') return null;
        const r = await fetch(`assets/i18n/${l}.json`);
        return r.ok ? r.json() : {};
      }));
      uiEn = en.ui || {}; ui = (tr || en).ui || {};
      // translations first (paths into the base data or into jurisdictions.<region>.data), then the region overlay
      const p = clone(raw);
      Object.entries((tr && tr.data) || {}).forEach(([path, v]) => setPath(p, path, v));
      BZD.jurisdiction = (p.jurisdictions || {})[BZD.region] || null;
      const parent = BZD.jurisdiction && BZD.jurisdiction.inherits ? p.jurisdictions[BZD.jurisdiction.inherits] : null;
      if (parent) merge(p, parent.data);                       // e.g. SE: EU values with Swedish units
      if (BZD.jurisdiction) merge(p, BZD.jurisdiction.data);
      BZD.baseDrugs = clone(raw.drugs); kiFix(BZD.baseDrugs);
      kiFix(p.drugs);
      BZD.raw = raw;
      Object.assign(BZD, {
        subtypes: p.subunits,
        otherSubunits: p.otherSubunits,
        drugs: p.drugs,
        gaba: p.gaba,
        routes: p.routes,
        drugRoutes: p.drugRoutes,
        pathways: p.pathways,
        modifiers: p.modifiers,
        regions: p.regions,
        model: p.model,
        substancesTable: p.substances,
        references: p.references,
        sources: p.sources,
        validation: p.validation,
      });
      return p;
    })();
    return loading;
  }

  return BZD;
})();
