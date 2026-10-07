/* =====================================================================
 * routes.js - Interactive Administration Routes Web Table & Comparator
 *
 * The selected route lives in ONE place (the PK simulator's #pk-route).
 * Clicking a bar/row here calls window.syncRouteSelection(), and every
 * change of route or drug elsewhere calls Routes.reflect() so this section
 * always mirrors the current state.
 * ===================================================================== */
window.Routes = (function () {
  'use strict';

  let notice = null; // { key: 'route|drug', text }

  function init() {
    renderRoutesSection();
  }

  function renderRoutesSection() {
    const host = document.getElementById('routes-container');
    if (!host) return;

    const routes = BZD.routes || [];

    host.innerHTML = `
      <div class="routes-overview">
        <div class="card routes-visualizer">
          <h3>${BZD.t('rt.bars.title')}</h3>
          <p class="muted">${BZD.t('rt.bars.intro')}</p>
          <div class="route-bars" id="route-bars">
            ${[...routes].sort((a, b) => a.onsetMin - b.onsetMin).map(r => `
              <div class="route-bar-row" data-route-id="${r.id}">
                <div class="route-bar-label">
                  <b>${r.name.split('(')[0].trim()}</b>
                  <span class="route-bar-tag" style="background:${r.badgeColor}">${r.onset}</span>
                </div>
                <div class="route-bar-track">
                  <div class="route-bar-fill" style="width:${Math.max(8, Math.min(100, (r.onsetMin / Math.max(...routes.map(x => x.onsetMin))) * 100))}%; background:${r.badgeColor}"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card route-detail-card" id="route-detail-card">
          <!-- Populated by reflect() -->
        </div>
      </div>

      <div class="card">
        <h3>${BZD.t('rt.table.title')}</h3>
        <p class="muted">${BZD.t('rt.table.intro')}</p>
        <div class="table-responsive">
          <table class="web-table">
            <thead>
              <tr>
                <th>${BZD.t('rt.th.route')}</th>
                <th>${BZD.t('rt.th.onset')}</th>
                <th>T<sub>max</sub></th>
                <th>${BZD.t('rt.th.f')}</th>
                <th>${BZD.t('rt.th.drugs')}</th>
                <th>${BZD.t('rt.th.ind')}</th>
                <th>${BZD.t('rt.th.advlim')}</th>
              </tr>
            </thead>
            <tbody id="routes-tbody">
              ${routes.map(r => `
                <tr data-route-id="${r.id}">
                  <td>
                    <b style="color:${r.badgeColor}">${r.name}</b>
                  </td>
                  <td><b>${r.onset}</b></td>
                  <td>${r.tmax}</td>
                  <td>${r.bioavailability}</td>
                  <td><b>${r.commonDrugs}</b></td>
                  <td>${r.primaryIndications}</td>
                  <td>
                    <span style="color:#2b8a3e">✓ ${r.advantages}</span><br/>
                    <span style="color:#c92a2a;margin-top:2px;display:inline-block">⚠ ${r.limitations}</span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Bars and table rows both route through the central synchroniser
    host.querySelectorAll('.route-bar-row, table.web-table tbody tr').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-route-id');
        if (!id) return;
        if (window.syncRouteSelection) window.syncRouteSelection(id, 'routes');
        else reflect(id, null);
      });
    });
  }

  function drugsForRoute(routeId) {
    return Object.entries(BZD.drugs)
      .filter(([, d]) => d.pk && (d.routes || ['oral']).includes(routeId))
      .map(([k, d]) => ({ key: k, name: d.name, color: d.color }));
  }

  /** Mirror the current route / drug in every element of this section. */
  /** Chip colour for a speed category (fast = warm, slow = neutral) */
  function speedColor(speed) {
    if (/^Very rapid/.test(speed)) return '#c92a2a';
    if (/^Rapid/.test(speed)) return '#e8590c';
    if (/^Intermediate|^Standard/.test(speed)) return '#1971c2';
    return '#868e96';
  }

  function reflect(routeId, drugKey) {
    const host = document.getElementById('routes-container');
    if (!host || !routeId) return;

    const drug = drugKey ? BZD.drugs[drugKey] : null;
    const allowed = drug ? (drug.routes || ['oral']) : null;

    host.querySelectorAll('.route-bar-row, table.web-table tbody tr').forEach(el => {
      const id = el.getAttribute('data-route-id');
      el.classList.toggle('selected', id === routeId);
      const unavailable = !!(allowed && !allowed.includes(id));
      el.classList.toggle('unavailable', unavailable);
      el.title = unavailable
        ? BZD.t('rt.notFormulatedTip', { drug: drug.name })
        : '';
    });

    updateBars(drugKey, allowed);
    showRouteDetail(routeId, drugKey);
  }

  /** Midpoint (min) of an onset string such as '15-60 min' or '≈ 10-15 min'; null if not numeric */
  function onsetMid(text) {
    const m = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*min/.exec(text) || /(\d+(?:\.\d+)?)\s*min/.exec(text);
    return m ? (m[2] ? (+m[1] + +m[2]) / 2 : +m[1]) : null;
  }

  /** Onset bars: drug-specific values where the drug is formulated, route-level range otherwise */
  function updateBars(drugKey, allowed) {
    const routes = BZD.routes || [];
    const dRoutes = drugKey && BZD.drugRoutes ? BZD.drugRoutes[drugKey] || {} : {};
    const rawRoutes = (drugKey && BZD.raw.drugRoutes && BZD.raw.drugRoutes[drugKey]) || {};   // English text for parsing
    const vals = routes.map(r => {
      const dr = allowed && allowed.includes(r.id) ? dRoutes[r.id] : null;
      if (!dr) return { id: r.id, label: r.onset, min: r.onsetMin };
      const rawOnset = (rawRoutes[r.id] || {}).onset || dr.onset;
      const mid = onsetMid(rawOnset), erratic = /erratic/i.test(rawOnset);
      const label = mid !== null ? dr.onset : (erratic ? BZD.t('rt.erratic') : dr.onset);
      // Erratic absorption (e.g. IM diazepam) is ranked last, with the slowest numeric route
      return { id: r.id, label, min: mid !== null ? mid : (erratic ? Infinity : r.onsetMin) };
    });
    const max = Math.max(...vals.map(v => v.min).filter(Number.isFinite));
    vals.forEach(v => { if (!Number.isFinite(v.min)) v.min = max; });
    const box = document.getElementById('route-bars');
    if (!box) return;
    vals.sort((a, b) => a.min - b.min).forEach(v => {
      const row = box.querySelector(`.route-bar-row[data-route-id="${v.id}"]`);
      if (!row) return;
      row.querySelector('.route-bar-tag').textContent = v.label;
      row.querySelector('.route-bar-fill').style.width = `${Math.max(8, Math.min(100, (v.min / max) * 100))}%`;
      box.appendChild(row);
    });
  }

  function setNotice(routeId, drugKey, text) {
    notice = text ? { key: `${routeId}|${drugKey}`, text } : null;
  }

  function showRouteDetail(routeId, drugKey) {
    const card = document.getElementById('route-detail-card');
    if (!card) return;

    const route = (BZD.routes || []).find(r => r.id === routeId);
    if (!route) return;

    const drug = drugKey ? BZD.drugs[drugKey] : null;
    const chips = drugsForRoute(routeId).map(d => `
      <button type="button" class="route-drug-chip ${d.key === drugKey ? 'active' : ''}" data-drug-key="${d.key}"
        style="--chip:${d.color}">${d.name}</button>`).join('');

    const showNotice = notice && notice.key === `${routeId}|${drugKey}` ? notice.text : '';

    // Bioavailability of the selected drug by this route, as used by the pharmacokinetic model
    const mods = [...document.querySelectorAll('#pk-mods input:checked')].map(cb => cb.value);
    const formulated = drug && drug.pk && window.PK && window.PK.getAllowedRoutes
      ? window.PK.getAllowedRoutes(drug).includes(routeId) : false;
    const F = formulated ? Models.bioavailability(drug, routeId, mods) : null;
    const fValue = !drug ? BZD.t('rt.f.noDrug')
      : !drug.pk ? BZD.t('rt.f.noPk')
        : !formulated ? BZD.t('rt.f.notFormulated')
          : `${BZD.fmt(F * 100)}%`;
    const fNote = drug && formulated && mods.length ? BZD.t('rt.f.mods') : '';

    // Elimination half-life: a drug property (route-independent), clinical range from the substances table
    const row = drug ? (BZD.substancesTable || []).find(t => (t.key || t.name.toLowerCase()) === drugKey) : null;
    const tHalf = row ? row.tHalf : (drug && drug.pk ? `≈ ${BZD.fmt(drug.pk.t12, drug.pk.t12 % 1 ? 1 : 0)} h` : '-');
    const met = row && /^(Active|Aktiva?): /.test(row.metabolites) ? row.metabolites.match(/^(?:Active|Aktiva?): ([^(,]+?) \(t½ ([^,)]+)/) : null;
    const tHalfNote = met ? BZD.t('rt.metNote', { met: met[1].charAt(0).toLowerCase() + met[1].slice(1), t: met[2] }) : '';

    // Drug-specific clinical information for this route; route-level text if none exists
    const dr = formulated && BZD.drugRoutes && BZD.drugRoutes[drugKey] ? BZD.drugRoutes[drugKey][routeId] : null;
    const genericSpeedKey = route.onsetMin <= 5 ? 'veryRapid' : (route.onsetMin <= 20 ? 'rapid' : 'standard');
    const rawDr = dr && BZD.raw.drugRoutes && BZD.raw.drugRoutes[drugKey] ? BZD.raw.drugRoutes[drugKey][routeId] : null;   // English, for the chip colour
    const info = dr
      ? { speed: dr.speed, speedColor: speedColor((rawDr || dr).speed), onset: dr.onset, tmax: dr.tmax, ind: dr.ind, adv: dr.adv, caut: dr.caut, note: '' }
      : { speed: BZD.t(`rt.speed.${genericSpeedKey}`), speedColor: speedColor({ veryRapid: 'Very rapid', rapid: 'Rapid', standard: 'Standard' }[genericSpeedKey]),
        onset: route.onset, tmax: route.tmax, ind: route.primaryIndications, adv: route.advantages, caut: route.limitations, note: BZD.t('rt.allDrugs') };

    card.innerHTML = `
      <p style="margin:0 0 .25rem"><b>${BZD.t('rt.formulated')}</b></p>
      <div class="route-drug-chips" style="margin-bottom:.75rem">${chips || `<span class="muted">${BZD.t('rt.noDrug')}</span>`}</div>
      <h3 style="margin-top:0.4rem">${drug && formulated ? `${drug.name} · ${route.name}` : BZD.t('rt.routePharmacology', { route: route.name })}</h3>

      ${showNotice ? `<div class="route-notice">${showNotice}</div>` : ''}

      <div class="readouts" style="grid-template-columns: 1fr 1fr; margin-bottom: 0.75rem;">
        <div class="readout route-metric">
          <div class="k">${BZD.t('rt.k.f')}</div>
          <div class="v" style="color:${route.badgeColor}">${fValue}</div>
          ${fNote ? `<div class="route-metric-note">${fNote}</div>` : ''}
        </div>
        <div class="readout route-metric">
          <div class="k">${BZD.t('rt.k.onset')}</div>
          <div class="v">${info.onset}</div>
        </div>
        <div class="readout route-metric">
          <div class="k">${BZD.t('rt.k.tmax')}</div>
          <div class="v">${info.tmax}</div>
        </div>
        <div class="readout route-metric">
          <div class="k">${BZD.t('rt.k.thalf')}</div>
          <div class="v">${tHalf}</div>
          ${tHalfNote ? `<div class="route-metric-note">${tHalfNote}</div>` : ''}
        </div>
      </div>

      <p class="route-speed"><b>${BZD.t('rt.speedCat')}</b>
        <span class="route-speed-chip" style="--chip:${info.speedColor}">${info.speed}</span>
        ${info.note ? `<span class="route-metric-note">${info.note}</span>` : ''}
      </p>

      <p><b>${BZD.t('rt.primaryInd')}</b> ${info.ind}</p>

      <div style="background:#f8f9fa; border-radius:8px; padding:0.6rem 0.8rem; margin:0.5rem 0; border-left:3px solid #2b8a3e">
        <b style="color:#2b8a3e">${BZD.t('rt.advantages')}</b> ${info.adv}
      </div>

      <div style="background:#fff5f5; border-radius:8px; padding:0.6rem 0.8rem; margin:0.5rem 0; border-left:3px solid #c92a2a">
        <b style="color:#c92a2a">${BZD.t('rt.cautions')}</b> ${info.caut}
      </div>
    `;

    card.querySelectorAll('.route-drug-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-drug-key');
        if (k && window.syncDrugSelection) window.syncDrugSelection(k, 'routes');
      });
    });
  }

  return { init, reflect, setNotice, showRouteDetail };
})();
