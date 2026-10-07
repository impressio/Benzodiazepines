/* =====================================================================
 * main.js - Application entry point and coordination
 * ===================================================================== */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // Centralized Drug Selection Synchronizer
  let isSyncingDrug = false;

  window.syncDrugSelection = function (drugKey, sourceId) {
    if (!drugKey || isSyncingDrug) return;
    isSyncingDrug = true;

    try {
      const mSel = document.getElementById('m-ligand');
      const pdSel = document.getElementById('pd-drug');
      const pkSel = document.getElementById('pk-drug');

      // 1. Sync Mechanism ligand select
      if (mSel) {
        const hasOpt = Array.from(mSel.options).some(o => o.value === drugKey);
        if (hasOpt && mSel.value !== drugKey) {
          mSel.value = drugKey;
        }
        if (window.Receptor && typeof window.Receptor.update === 'function') {
          window.Receptor.update();
        }
      }

      // 2. Sync Pharmacodynamics drug select
      if (pdSel) {
        const hasOpt = Array.from(pdSel.options).some(o => o.value === drugKey);
        if (hasOpt && pdSel.value !== drugKey) {
          pdSel.value = drugKey;
        }
        if (window.PD && typeof window.PD.update === 'function') {
          window.PD.update();
        }
      }

      // 3. Sync Pharmacokinetics drug select
      if (pkSel) {
        const hasOpt = Array.from(pkSel.options).some(o => o.value === drugKey);
        if (hasOpt) {
          if (pkSel.value !== drugKey) {
            pkSel.value = drugKey;
          }
          const d = window.BZD?.drugs?.[drugKey];
          if (d && d.pk) {
            const doseEl = document.getElementById('pk-dose');
            const tauEl = document.getElementById('pk-tau');
            if (doseEl && d.pk.dose) doseEl.value = d.pk.dose;
            if (tauEl && d.pk.tau) tauEl.value = d.pk.tau;
            if (window.PK && typeof window.PK.syncRouteOptions === 'function') {
              window.PK.syncRouteOptions(drugKey);
            }
          }
          if (window.PK && typeof window.PK.update === 'function') {
            window.PK.update();
          }
        }
      }

      highlightDrugElements(drugKey);
    } catch (err) {
      console.error('Error syncing drug selection:', err);
    } finally {
      isSyncingDrug = false;
    }
  };

  // Centralized Route Selection Synchronizer.
  // The selected route lives in #pk-route; this applies a route chosen anywhere
  // (route bars/table, PK dropdown) to the PK simulator and the routes section.
  let isSyncingRoute = false;
  const PREFERRED_DRUG_FOR_ROUTE = {
    oral: 'diazepam', sl: 'lorazepam', buccal: 'midazolam', nasal: 'midazolam',
    rectal: 'diazepam', im: 'midazolam', iv: 'diazepam'
  };

  window.syncRouteSelection = function (routeId, sourceId) {
    if (!routeId || isSyncingRoute) return;
    isSyncingRoute = true;

    try {
      const pkRoute = document.getElementById('pk-route');
      const pkDrug = document.getElementById('pk-drug');
      let drugKey = pkDrug?.value || 'diazepam';
      let drug = window.BZD.drugs[drugKey];
      const routeName = (window.BZD.routes.find(r => r.id === routeId) || {}).name || routeId;
      const allowed = (drug && drug.routes) || ['oral'];
      let notice = '';

      if (!allowed.includes(routeId)) {
        // Selected drug has no such formulation -> switch to a drug that does
        const pref = PREFERRED_DRUG_FOR_ROUTE[routeId];
        const cand = (pref && (window.BZD.drugs[pref].routes || []).includes(routeId))
          ? pref
          : Object.keys(window.BZD.drugs).find(k => window.BZD.drugs[k].pk && (window.BZD.drugs[k].routes || []).includes(routeId));
        if (cand) {
          notice = BZD.t('main.routeSwitched', { route: routeName, drug: drug.name, other: window.BZD.drugs[cand].name });
          isSyncingRoute = false;               // allow the nested drug sync
          window.syncDrugSelection(cand, 'route');
          isSyncingRoute = true;
          drugKey = cand;
          drug = window.BZD.drugs[cand];
        } else {
          routeId = drug.defaultRoute || 'oral';
        }
      }

      if (pkRoute) {
        if (window.PK && window.PK.syncRouteOptions) window.PK.syncRouteOptions(drugKey);
        pkRoute.value = routeId;
      }
      if (window.Routes) window.Routes.setNotice(routeId, drugKey, notice);
      if (window.PK && window.PK.update) window.PK.update();
      else if (window.Routes) window.Routes.reflect(routeId, drugKey);
    } catch (err) {
      console.error('Error syncing route selection:', err);
    } finally {
      isSyncingRoute = false;
    }
  };

  function highlightDrugElements(drugKey) {
    document.querySelectorAll('.lig-card[data-drug-key]').forEach(c => {
      c.classList.toggle('selected-drug', c.getAttribute('data-drug-key') === drugKey);
    });

    document.querySelectorAll('#substances-tbody tr[data-drug-key]').forEach(r => {
      r.classList.toggle('selected-drug', r.getAttribute('data-drug-key') === drugKey);
    });
  }

  // Centralized Subunit Selection Synchronizer
  let isSyncingSub = false;

  window.syncSubunitSelection = function (subKey, sourceId) {
    if (!subKey || isSyncingSub) return;
    isSyncingSub = true;

    try {
      const mSub = document.getElementById('m-sub');
      const pdSub = document.getElementById('pd-sub');

      // 1. Sync Mechanism subunit select
      if (mSub) {
        const hasOpt = Array.from(mSub.options).some(o => o.value === subKey);
        if (hasOpt && mSub.value !== subKey) {
          mSub.value = subKey;
        }
        if (window.Receptor && typeof window.Receptor.update === 'function') {
          window.Receptor.update();
          window.Receptor.showSubunitInfo('alpha');
        }
      }

      // 2. Sync Pharmacodynamics subunit select
      if (pdSub) {
        const hasOpt = Array.from(pdSub.options).some(o => o.value === subKey);
        if (hasOpt && pdSub.value !== subKey) {
          pdSub.value = subKey;
        }
        if (window.PD && typeof window.PD.update === 'function') {
          window.PD.update();
        }
      }

      // 3. Sync regional distribution map
      if (window.Distribution) window.Distribution.update(subKey);

    } catch (err) {
      console.error('Error syncing subunit selection:', err);
    } finally {
      isSyncingSub = false;
    }
  };

  // Load the numeric properties (assets/data/properties.json) first, then start the modules
  BZD.load().then(() => {
    BZD.translatePage();
    BZD.initSettings();
    // Initialize individual interactive modules
    try { if (window.Receptor) window.Receptor.init(); } catch (e) { console.error('Receptor init error:', e); }
    try { if (window.Substrates) window.Substrates.init(); } catch (e) { console.error('Substrates init error:', e); }
    try { if (window.Routes) window.Routes.init(); } catch (e) { console.error('Routes init error:', e); }
    try { if (window.Distribution) window.Distribution.init(); } catch (e) { console.error('Distribution init error:', e); }
    try { if (window.PD) window.PD.init(); } catch (e) { console.error('PD init error:', e); }
    try { if (window.PK) window.PK.init(); } catch (e) { console.error('PK init error:', e); }
    try { if (window.Structure) window.Structure.init(); } catch (e) { console.error('Structure init error:', e); }

    // Cl⁻ flux parameters quoted in Notes & limitations, from the data file and the GHK model
    const sc = BZD.model.singleChannel, ch = window.Models.CL_CHANNEL;
    const dec = (v) => (v % 1 ? Math.min(3, String(v).split('.')[1].length) : 0);
    const scText = { ...Object.fromEntries(Object.entries(sc).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, BZD.fmt(v, dec(v))])),
      eCl_mV: BZD.fmt(ch.eCl_mV, 1), eGABA_mV: BZD.fmt(ch.eGABA_mV, 1), iCl_pA: BZD.fmt(ch.iCl_pA, 3),
      kinTempLow_C: BZD.fmt(BZD.model.kinetics.temperatureLow_C), kinTempHigh_C: BZD.fmt(BZD.model.kinetics.temperatureHigh_C) };
    document.querySelectorAll('[data-sc]').forEach(el => { el.textContent = String(scText[el.dataset.sc]).replace('-', '−'); });

    // Set initial highlights and mirror the initial route into the routes section
    highlightDrugElements('diazepam');
    try {
      const d0 = document.getElementById('pk-drug')?.value || 'diazepam';
      if (window.PK && window.PK.syncRouteOptions) window.PK.syncRouteOptions(d0);
      if (window.Routes) window.Routes.reflect(document.getElementById('pk-route')?.value || 'oral', d0);
    } catch (e) { console.error('Initial route sync error:', e); }
  }).catch(err => {
    console.error('Data loading error:', err);
    const main = document.querySelector('main');
    if (main) main.insertAdjacentHTML('afterbegin', `<div class="card data-error"><b>${BZD.t('main.dataError')}</b> ${err.message}</div>`);
  });

  // Number fields: typed values are applied once typing pauses (or on Enter / leaving the field),
  // so entering "20" does not first simulate "2"; spinner arrows and the mouse wheel apply at once.
  // Empty or invalid entries are not applied. Implemented once here, in the capture phase, for all modules.
  const NUM_SETTLE_MS = 700;
  const isNumberField = (el) => el instanceof HTMLInputElement && el.type === 'number';
  const settleNumber = (el) => {
    clearTimeout(el._numTimer); el._numTimer = null;
    if (el.value === '' || !el.checkValidity()) return;
    const ev = new Event('input', { bubbles: true });
    ev.numberSettled = true;
    el.dispatchEvent(ev);
  };
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!isNumberField(el) || e.numberSettled) return;
    if (!e.inputType || e.inputType === 'insertReplacementText') return; // stepper / wheel: apply now
    e.stopImmediatePropagation();
    clearTimeout(el._numTimer);
    el._numTimer = setTimeout(() => settleNumber(el), NUM_SETTLE_MS);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && isNumberField(e.target) && e.target._numTimer) settleNumber(e.target);
  }, true);
  document.addEventListener('change', (e) => {
    if (isNumberField(e.target) && e.target._numTimer) settleNumber(e.target);
  }, true);

  // Section anchors land exactly under the sticky header (its height varies with screen width)
  const topbar = document.querySelector('.topbar');
  const setTopbarHeight = () => {
    if (topbar) document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
  };
  setTopbarHeight();
  if (topbar) new ResizeObserver(setTopbarHeight).observe(topbar);

  // Compact menu: one button on the right opens the section list (closes on choice, Escape or
  // outside click). It shows the menu icon above the first section and the current section below.
  const menuBtn = document.getElementById('menu-toggle');
  const menuLabel = menuBtn && menuBtn.querySelector('.menu-label');
  const siteNav = document.getElementById('site-nav');
  const setSubtitle = (id) => {
    const link = id && document.querySelector(`header nav a[href="#${id}"]`);
    const label = link ? link.textContent : '';
    if (!menuLabel || menuLabel.textContent === label) return;
    menuLabel.textContent = label;
    menuBtn.classList.toggle('has-label', !!label);
  };
  const setMenu = (open) => {
    if (!menuBtn || !siteNav) return;
    siteNav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', `${BZD.t(open ? 'main.closeMenu' : 'main.openMenu')}${menuLabel && menuLabel.textContent ? ` (${menuLabel.textContent})` : ''}`);
  };
  // the logo returns to the top of the page
  const home = document.getElementById('brand-home');
  if (home) home.addEventListener('click', (e) => {
    e.preventDefault();
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  if (menuBtn) menuBtn.addEventListener('click', () => setMenu(!siteNav.classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  document.addEventListener('click', (e) => { if (siteNav && siteNav.classList.contains('open') && !e.target.closest('.topbar')) setMenu(false); });

  // Smooth scrolling for navigation links
  document.querySelectorAll('header nav a[href^="#"]').forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      setMenu(false);
      setSubtitle(this.getAttribute('href').slice(1));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Highlight active nav item on scroll
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('header nav a');

  window.addEventListener('scroll', () => {
    let current = '';
    const scrollY = window.pageYOffset;
    sections.forEach(sec => {
      const top = sec.offsetTop - 120;
      const height = sec.offsetHeight;
      if (scrollY >= top && scrollY < top + height) {
        current = sec.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
    setSubtitle(current);
  }, { passive: true });
});
