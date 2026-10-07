/* =====================================================================
 * substrates.js - 2D chemical structures (pre-rendered SVGs in assets/images/structures/, built by
 * tools/build_structures.py with RDKit),
 * metabolic pathway diagrams, and interactive substances web table.
 * ===================================================================== */
window.Substrates = (function () {
  'use strict';

  function init() {
    renderLigandGallery();
    renderPathways();
    renderSubstancesTable();
    renderBoxedWarning('diazepam');
  }

  /**
   * FDA boxed warning of a substance: topics (BZD.boxedWarnings) from the boxed warning of the cited
   * US label (drugs.*.boxedWarning), with the label and its revision date as source.
   */
  const NOT_US = ['zopiclone'], RESEARCH = ['bretazenil', 'dmcm'];
  function renderBoxedWarning(key) {
    const host = document.getElementById('boxed-warning');
    if (!host) return;
    const d = BZD.drugs[key];
    if (!d) { host.innerHTML = `<p class="bw-none">${BZD.t('bw.select')}</p>`; return; }
    const eu = BZD.region !== 'us' ? `<p class="bw-eu">${BZD.t('bw.eu')}</p>` : '';
    const bw = d.boxedWarning;
    if (!bw) {
      const key2 = NOT_US.includes(key) ? 'bw.notUS' : RESEARCH.includes(key) ? 'bw.research' : 'bw.none';
      host.classList.remove('has-warning');
      host.innerHTML = `<p class="bw-none">${BZD.t(key2, { drug: d.name })}</p>${eu}`;
      return;
    }
    const ref = BZD.references[bw.ref];
    host.classList.add('has-warning');
    host.innerHTML = `
      <h3 class="bw-title">${BZD.t('bw.title', { drug: d.name })}</h3>
      <div class="summary dose-text">${bw.topics.map(t => `<p><b>${BZD.boxedWarnings[t].title}.</b> ${BZD.boxedWarnings[t].text}</p>`).join('')}</div>
      <p class="bw-source">${BZD.t('bw.source', { label: ref.title.split(':')[0], url: ref.url, rev: ref.revised })}</p>${eu}`;   // paragraphs with bold lead-ins, as in the overdose card
  }

  /**
   * Render Ligand gallery with 2D molecular structures
   */
  function renderLigandGallery() {
    const gallery = document.getElementById('ligand-gallery');
    if (!gallery) return;

    // Clinically used / investigational BZD-site agonists only (GABA, the antagonist and the inverse agonist are shown elsewhere)
    const EXCLUDE = ['flumazenil', 'dmcm'];
    const all = Object.entries(BZD.drugs).filter(([k]) => !EXCLUDE.includes(k)).map(([k, d]) => ({ key: k, ...d }));

    let html = '';
    all.forEach(item => {
      html += `
        <div class="card lig-card" data-drug-key="${item.key}" style="cursor:pointer;" title="${BZD.t('sub.selectAll', { drug: item.name })}">
          <span class="role" style="background:${item.roleColor || item.color || '#495057'}; color:#ffffff">
            ${item.role}
          </span>
          <div class="mol-panel" style="--mol-tint:${item.roleColor || item.color || '#5b5bd6'}"><img src="assets/images/structures/${item.key}.svg" width="200" height="150" alt="${BZD.t('sub.structureAlt', { drug: item.name })}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'mol-missing', textContent: '${BZD.t('sub.structureMissing')}' }))"></div>
          <h4>${item.name}</h4>
          ${item.brand ? `<p class="muted lig-meta">${BZD.t('sub.brand', { brand: item.brand })}</p>` : ''}
          ${item.mw ? `<p class="muted lig-meta">${BZD.t('sub.mw', { mw: BZD.fmt(item.mw, 1) })}</p>` : ''}
          <p>${item.use}</p>
          ${item.pd ? `<p class="muted lig-meta">${BZD.t('sub.type', { kind: BZD.t('kind.' + item.pd.kind), emax: BZD.fmt(item.pd.emax, item.pd.emax % 1 ? 1 : 0) })}</p>` : ''}
        </div>
      `;
    });

    gallery.innerHTML = html;

    // Attach click to auto-select drug
    gallery.querySelectorAll('.lig-card[data-drug-key]').forEach(card => {
      card.addEventListener('click', () => {
        const key = card.getAttribute('data-drug-key');
        if (key && key !== 'gaba' && window.syncDrugSelection) {
          window.syncDrugSelection(key, 'gallery');
        }
      });
    });
  }

  /**
   * Render metabolic cascades
   */
  function renderPathways() {
    const host = document.getElementById('metabolic-pathways');
    if (!host) return;

    let html = '';
    BZD.pathways.forEach(pw => {
      html += `
        <div class="card" style="margin-bottom: 0.8rem;">
          <h4 class="pw-title">${pw.name}</h4>
          <div class="pw-row">
      `;

      // Each step's enzyme/reaction describes the conversion leaving that compound
      const arrow = (from) => `
            <div class="pw-arrow">
              <span class="enz ${from.enzClass}">${from.enzyme}</span>
              <div class="line"></div>
              <span>${from.reaction}</span>
            </div>
          `;
      pw.steps.forEach((step, idx) => {
        if (idx > 0) html += arrow(pw.steps[idx - 1]);
        html += `
          <div class="pw-node ${step.status}">
            <b>${step.compound}</b>
            ${step.tHalf ? `<br/><small class="muted">t½ ${/^[~≈]/.test(step.tHalf) ? step.tHalf.replace(/^~/, '≈ ') : '≈ ' + step.tHalf}</small>` : ''}
          </div>
        `;
      });
      const last = pw.steps[pw.steps.length - 1];
      if (last && last.enzyme) html += arrow(last) + `<div class="pw-node excreted"><b>${BZD.t('sub.urine')}</b></div>`;

      html += `
          </div>
          <p class="muted pw-note">${pw.note}</p>
        </div>
      `;
    });

    host.innerHTML = html;
  }

  // Duration / class abbreviations used in the table (t½ ranges include active metabolites where relevant)
  // Classes are recognised from the English category in the data file; names and descriptions are translated
  const CLASS_ABBR = [
    { code: 'USA', test: /ultra-short/i }, { code: 'SA', test: /^short-acting/i }, { code: 'SA-IA', test: /short\/intermediate/i },
    { code: 'IA', test: /intermediate-acting/i }, { code: 'LA', test: /long-acting/i }, { code: 'Z', test: /z-drug/i }, { code: 'PAR', test: /partial/i },
  ].map(c => ({ ...c, get name() { return BZD.t(`cls.${c.code}.name`); }, get desc() { return BZD.t(`cls.${c.code}.desc`); } }));
  const classOf = (category) => CLASS_ABBR.find(c => c.test.test(category)) || { code: category, name: category, desc: '' };

  /**
   * Render searchable and filterable Substances Comparison Web Table
   */
  function renderSubstancesTable() {
    const host = document.getElementById('substances-table-container');
    if (!host) return;

    // class logic uses the English category of the data file (BZD.raw); the display uses the translated text
    const rawCat = (d) => ((BZD.raw.substances || []).find(s => s.key === d.key) || d).category;
    const data = (BZD.substancesTable || []).filter(d => !/antagonist/i.test(rawCat(d)));

    host.innerHTML = `
      <div class="table-toolbar">
        <div class="search-box">
          <input type="text" id="substances-search" placeholder="${BZD.t('sub.search.placeholder')}" title="${BZD.t('sub.search.title')}" aria-label="${BZD.t('sub.search.aria')}" />
        </div>
        <div class="filter-pills" id="substances-filters">
          <button type="button" class="pill active" data-filter="all">${BZD.t('sub.filter.all', { n: data.length })}</button>
          <button type="button" class="pill" data-filter="lot" title="${BZD.t('sub.filter.lot')}">LOT</button>
          <button type="button" class="pill" data-filter="short" title="${BZD.t('sub.filter.short')}">USA / SA</button>
          <button type="button" class="pill" data-filter="intermediate" title="${BZD.t('cls.IA.name')}">IA</button>
          <button type="button" class="pill" data-filter="long" title="${BZD.t('cls.LA.name')}">LA</button>
          <button type="button" class="pill" data-filter="z" title="${BZD.t('sub.filter.z')}">Z</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="web-table">
          <thead>
            <tr>
              <th>${BZD.t('sub.th.name')}</th>
              <th>${BZD.t('sub.th.class')}</th>
              <th>${BZD.t('sub.th.thalf')}</th>
              <th>${BZD.t('sub.th.metabolites')}</th>
              <th>${BZD.t('sub.th.f')}</th>
              <th>${BZD.t('sub.th.clearance')}</th>
              <th>${BZD.t('sub.th.equiv')}</th>
              <th>${BZD.t('sub.th.indications')}</th>
            </tr>
          </thead>
          <tbody id="substances-tbody">
            <!-- Populated dynamically -->
          </tbody>
        </table>
      </div>
      <p class="table-footer-note abbr-legend">
        <b>${BZD.t('sub.abbr')}</b> ${CLASS_ABBR.map(c => `<span class="abbr-item"><b>${c.code}</b> = ${/^Z-/.test(c.name) ? c.name : c.name.toLowerCase()} (${c.desc})</span>`).join(' · ')}
      </p>
      <p class="table-footer-note">
        ${BZD.t('sub.footnote')}
      </p>
    `;

    const searchInput = document.getElementById('substances-search');
    const filterButtons = host.querySelectorAll('.filter-pills button');
    const tbody = document.getElementById('substances-tbody');

    let currentFilter = 'all';
    let currentQuery = '';

    function updateTable() {
      let filtered = data.filter(d => {
        // Category / LOT filter
        if (currentFilter === 'lot' && !d.lot) return false;
        const code = classOf(rawCat(d)).code;
        if (currentFilter === 'short' && !['USA', 'SA', 'SA-IA'].includes(code)) return false;
        if (currentFilter === 'intermediate' && !['IA', 'SA-IA'].includes(code)) return false;
        if (currentFilter === 'long' && code !== 'LA') return false;
        if (currentFilter === 'z' && code !== 'Z') return false;

        // Query filter
        if (currentQuery.trim() !== '') {
          const q = currentQuery.toLowerCase();
          const match =
            d.name.toLowerCase().includes(q) ||
            d.category.toLowerCase().includes(q) ||
            classOf(rawCat(d)).code.toLowerCase() === q ||
            d.indications.toLowerCase().includes(q) ||
            d.clearance.toLowerCase().includes(q) ||
            d.metabolites.toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">${BZD.t('sub.none')}</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(d => `
        <tr class="${d.lot ? 'row-lot' : ''}" data-drug-key="${d.key || d.name.toLowerCase().replace(/[^a-z]/g, '')}" style="cursor:pointer;" title="${BZD.t('sub.selectAll', { drug: d.name })}">
          <td>
            <b>${d.name}</b>
            ${d.brand ? `<small class="cat-extra">${d.brand}</small>` : ''}
            ${d.lot ? `<span class="tag-lot" title="${BZD.t('sub.lotTag')}">LOT</span>` : ''}
            ${/\(/.test(d.category) ? `<small class="cat-extra">${d.category.replace(/^.*\((.*)\).*$/, '$1')}</small>` : ''}
          </td>
          <td>
            <abbr class="badge-cat" style="background:${d.color || '#495057'}" title="${classOf(rawCat(d)).name}: ${classOf(rawCat(d)).desc}">${classOf(rawCat(d)).code}</abbr>
          </td>
          <td>${d.tHalf}</td>
          <td>
            ${/^(Active|Aktiv)/.test(d.metabolites) ? `<span class="tag-active-met">${d.metabolites}</span>` : `<span>${d.metabolites}</span>`}
          </td>
          <td>${d.bioavailability}</td>
          <td>${d.clearance}</td>
          <td>${d.equivDose}</td>
          <td>${d.indications}</td>
        </tr>
      `).join('');

      // Attach row click to auto-select
      tbody.querySelectorAll('tr[data-drug-key]').forEach(row => {
        row.addEventListener('click', () => {
          const key = row.getAttribute('data-drug-key');
          if (key && window.syncDrugSelection) {
            window.syncDrugSelection(key, 'table');
          }
        });
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', e => {
        currentQuery = e.target.value;
        updateTable();
      });
    }

    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        updateTable();
      });
    });

    updateTable();
  }

  return { init, renderBoxedWarning };
})();
