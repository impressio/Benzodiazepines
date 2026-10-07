/* =====================================================================
 * pk.js - Pharmacokinetics Simulation & Visualizations
 * Powered by Plotly.js and Models.simulate
 * ===================================================================== */
window.PK = (function () {
  'use strict';

  /** Drug name for use mid-sentence: INNs are common nouns (acronyms such as DMCM kept) */
  const inn = (name) => (/^[A-Z0-9-]+$/.test(name) ? name : name.replace(/[A-Z]/, c => c.toLowerCase()));

  function waitForPlotly(cb, maxRetries = 60) {
    if (typeof Plotly !== 'undefined') {
      cb();
      return;
    }
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (typeof Plotly !== 'undefined') {
        clearInterval(interval);
        cb();
      } else if (count >= maxRetries) {
        clearInterval(interval);
        console.warn('Plotly library took too long to load.');
      }
    }, 100);
  }

  function init() {
    attachAccumulationButtons();
    populateControls();
    populateRouteSelect();
    renderModifierPills();
    attachListeners();
    waitForPlotly(update);
  }

  function populateControls() {
    const drugSel = document.getElementById('pk-drug');
    if (drugSel && drugSel.options.length === 0) {
      Object.entries(BZD.drugs).forEach(([k, v]) => {
        if (!v.pk) return; // skip drugs without PK models
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = `${v.name} (${v.role})`;
        if (k === 'diazepam') opt.selected = true;
        drugSel.appendChild(opt);
      });
    }
  }

  function renderModifierPills() {
    const container = document.getElementById('pk-mods');
    if (!container) return;

    let html = `<span class="mods-title">${BZD.t('pk.mods')}</span>`;
    Object.entries(BZD.modifiers).forEach(([k, m]) => {
      html += `
        <label class="mod-pill" data-key="${k}">
          <input type="checkbox" value="${k}" />
          <span>${m.short}</span>
        </label>
      `;
    });
    container.innerHTML = html;

    container.querySelectorAll('.mod-pill').forEach(pill => {
      const cb = pill.querySelector('input');
      if (!cb) return;
      cb.addEventListener('change', () => {
        pill.classList.toggle('on', cb.checked);
        update();
      });
    });
  }

  const ROUTE_ORDER = ['oral', 'sl', 'buccal', 'nasal', 'rectal', 'im', 'iv'];

  function routeInfo(routeKey) {
    return (BZD.routes || []).find(r => r.id === routeKey) || null;
  }

  function getRouteLabel(routeKey) {
    const r = routeInfo(routeKey);
    return r ? r.name : String(routeKey).toUpperCase();
  }

  function getAllowedRoutes(drug) {
    if (!drug) return ['oral'];
    return drug.routes || (drug.pk ? ['oral'] : []);
  }

  function populateRouteSelect() {
    const routeSel = document.getElementById('pk-route');
    if (!routeSel) return;
    const current = routeSel.value;
    routeSel.innerHTML = '';
    ROUTE_ORDER.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = getRouteLabel(id);
      routeSel.appendChild(opt);
    });
    routeSel.value = ROUTE_ORDER.includes(current) ? current : 'oral';
  }

  /**
   * Enable only the routes the selected drug is formulated for and make sure
   * the current route is valid. Returns the (possibly corrected) route.
   */
  function syncRouteOptions(drugKey) {
    const routeSel = document.getElementById('pk-route');
    if (!routeSel) return null;
    const drug = BZD.drugs[drugKey];
    if (!drug) return routeSel.value;

    const allowed = getAllowedRoutes(drug);

    Array.from(routeSel.options).forEach(opt => {
      const isAllowed = allowed.includes(opt.value);
      opt.disabled = !isAllowed;
      opt.hidden = !isAllowed;
      opt.textContent = isAllowed
        ? getRouteLabel(opt.value)
        : BZD.t('pk.notFormulated', { route: getRouteLabel(opt.value) });
    });

    if (!allowed.includes(routeSel.value)) {
      const fallback = (drug.defaultRoute && allowed.includes(drug.defaultRoute))
        ? drug.defaultRoute
        : (allowed[0] || 'oral');
      routeSel.value = fallback;
    }
    return routeSel.value;
  }

  function attachListeners() {
    const routeEl0 = document.getElementById('pk-route');
    if (routeEl0) {
      routeEl0.addEventListener('change', () => {
        if (window.syncRouteSelection) window.syncRouteSelection(routeEl0.value, 'pk-route');
        else update();
      });
    }

    ['pk-dose', 'pk-n', 'pk-tau', 'pk-wt', 'pk-scale'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => { normaliseInputs(); update(); });
        if (el.tagName === 'INPUT') el.addEventListener('input', update);
      }
    });

    // When drug changes, update default dose and interval
    const drugSel = document.getElementById('pk-drug');
    if (drugSel) {
      drugSel.addEventListener('change', () => {
        const val = drugSel.value;
        const d = BZD.drugs[val];
        if (d && d.pk) {
          const doseEl = document.getElementById('pk-dose');
          const tauEl = document.getElementById('pk-tau');
          if (doseEl && d.pk.dose) doseEl.value = d.pk.dose;
          if (tauEl && d.pk.tau) tauEl.value = d.pk.tau;
          syncRouteOptions(val);
        }
        if (window.syncDrugSelection) {
          window.syncDrugSelection(val, 'pk-drug');
        } else {
          update();
        }
      });
    }
  }

  /** Accumulation preset: repeat the dose until the slowest active species reaches ~97% of steady state (5 t½) */
  function attachAccumulationButtons() {
    const nEl = document.getElementById('pk-n');
    document.getElementById('pk-accum-btn')?.addEventListener('click', () => {
      const drug = BZD.drugs[document.getElementById('pk-drug')?.value || 'diazepam'];
      if (!drug || !drug.pk || !nEl) return;
      const tau = BZD.numInput('pk-tau', drug.pk.tau || 24);
      const e = Models.effectivePK(drug, getSelectedModifiers(), BZD.numInput('pk-wt', 70));
      const slowest = Math.max(e.t12, ...e.metabolites.map(m => m.t12));
      nEl.value = Math.min(60, Math.max(4, Math.ceil(5 * slowest / tau) + 1));
      update();
    });
    document.getElementById('pk-single-btn')?.addEventListener('click', () => {
      if (nEl) { nEl.value = 1; update(); }
    });
  }

  /** Numeric PK inputs, limited to the min/max of each field (empty or invalid input: default) */
  function readInputs() {
    return {
      dose: BZD.numInput('pk-dose', 10),
      n: BZD.numInput('pk-n', 1, true),
      tau: BZD.numInput('pk-tau', 24),
      weight: BZD.numInput('pk-wt', 70),
    };
  }

  /** On commit (change event), show the values actually simulated in the fields */
  function normaliseInputs() {
    const v = readInputs();
    [['pk-dose', v.dose], ['pk-n', v.n], ['pk-tau', v.tau], ['pk-wt', v.weight]].forEach(([id, x]) => {
      const el = document.getElementById(id);
      if (el && parseFloat(el.value) !== x) el.value = x;
    });
  }

  function getSelectedModifiers() {
    const checked = [];
    document.querySelectorAll('#pk-mods input:checked').forEach(cb => {
      checked.push(cb.value);
    });
    return checked;
  }

  function update() {
    if (typeof Plotly === 'undefined') {
      waitForPlotly(update);
      return;
    }

    const drugKey = document.getElementById('pk-drug')?.value || 'diazepam';
    const drug = BZD.drugs[drugKey];
    if (!drug || !drug.pk) return;

    syncRouteOptions(drugKey);
    const route = document.getElementById('pk-route')?.value || 'oral';
    const { dose, n, tau, weight } = readInputs();
    const scale = document.getElementById('pk-scale')?.value || 'linear';
    const mods = getSelectedModifiers();

    const sim = inRegionUnits(Models.simulate({ drug, dose, route, n, tau, weight, mods }), drug);

    plotConcentrationTime(sim, drug, scale, route);
    renderParamsTable(sim, drug, route);
    plotDurationComparison(weight, mods);

    // Keep the Administration-routes section in step with the PK route/drug
    if (window.Routes && typeof window.Routes.reflect === 'function') {
      window.Routes.reflect(route, drugKey);
    }
    // Section 1 derives its free concentration from this regimen
    if (window.Receptor && typeof window.Receptor.syncFromPK === 'function') window.Receptor.syncFromPK();
  }

  /**
   * Simulation result in the plasma concentration unit of the selected region. The model works in
   * ng/mL (= µg/L); for molar units (SE, nmol/L) each species is converted with its own molecular
   * weight. The unconverted result stays available as .raw (dose recovery, thresholds).
   */
  function inRegionUnits(sim, drug) {
    if (!BZD.molar()) return sim;
    const defs = drug.pk.metabolites || (drug.pk.metabolite ? [drug.pk.metabolite] : []);
    const c = (v, mw) => (v === null || v === undefined ? v : BZD.conc(v, mw));
    return {
      ...sim, raw: sim, cp: sim.cp.map(v => c(v, drug.mw)),
      params: { ...sim.params, cmax: c(sim.params.cmax, drug.mw), cmaxAll: c(sim.params.cmaxAll, drug.mw), cssAvg: c(sim.params.cssAvg, drug.mw), auc: c(sim.params.auc, drug.mw) },
      metabolites: (sim.metabolites || []).map((m, i) => ({ ...m, cp: m.cp.map(v => c(v, (defs[i] || {}).mw)), cmax: c(m.cmax, (defs[i] || {}).mw) })),
    };
  }

  /**
   * Plot E: Plasma concentration vs time
   */
  function plotConcentrationTime(sim, drug, scale, route) {
    const target = document.getElementById('pk-plot-ct');
    if (!target) return;

    const traces = [];

    // Shaded reference therapeutic window if available
    if (drug.pk.ref) {
      const [refLow, refHigh] = drug.pk.ref.map(v => BZD.conc(v, drug.mw));
      traces.push({
        x: [0, sim.tEnd, sim.tEnd, 0],
        y: [refLow, refLow, refHigh, refHigh],
        fill: 'toself',
        fillcolor: 'rgba(56, 217, 169, 0.12)',
        line: { color: 'transparent' },
        name: BZD.t('pk.target', { lo: BZD.fmt(refLow), hi: BZD.fmt(refHigh), unit: BZD.concUnit() }),
        hoverinfo: 'none'
      });
    }

    const routeLabel = route === 'iv' ? BZD.t('pk.ivBolus') : getRouteLabel(route).replace(/\s*\(.*\)/, '').toLowerCase();

    // Parent drug concentration curve
    traces.push({
      x: sim.t,
      y: sim.cp,
      type: 'scatter',
      mode: 'lines',
      name: `${drug.name} (${routeLabel})`,
      line: { color: drug.color || '#1971c2', width: 3 }
    });

    // Active metabolite curves (all metabolites of Diazepam: Nordiazepam, Temazepam, Oxazepam)
    const dashStyles = ['dash', 'dashdot', 'dot', 'longdash'];
    if (sim.metabolites && sim.metabolites.length > 0) {
      sim.metabolites.forEach((m, idx) => {
        if (m.cp && m.cp.some(v => v !== null && v > 0.02)) {
          traces.push({
            x: sim.t,
            y: m.cp,
            type: 'scatter',
            mode: 'lines',
            name: BZD.t('pk.metTrace', { name: m.name, t: BZD.fmt(m.t12, 1) }),
            line: {
              color: m.color || '#e8590c',
              width: 2.3,
              dash: dashStyles[idx % dashStyles.length]
            }
          });
        }
      });
    }

    // Total active benzodiazepine (parent + active metabolites, ng/mL summed; potency differences ignored)
    const activeMets = (sim.metabolites || []).filter(m => m.cp && m.cp.some(v => v > 0.02));
    if (activeMets.length) {
      const total = sim.cp.map((c, i) => c + activeMets.reduce((acc, m) => acc + (m.cp[i] || 0), 0));
      traces.push({
        x: sim.t, y: total, type: 'scatter', mode: 'lines', name: BZD.t('pk.total'),
        line: { color: '#212529', width: 1.6 }, opacity: 0.75,
      });
    }

    // Accumulation: pre-dose troughs rising toward steady state, and predicted steady-state averages
    const annotations = [];
    if (sim.doseTimes.length > 1) {
      const troughIdx = sim.doseTimes.slice(1).map(dt => {
        let i = sim.t.findIndex(t => t >= dt);
        return Math.max(0, (i < 0 ? sim.t.length : i) - 1);
      });
      const series = [{ name: drug.name, cp: sim.cp, color: drug.color || '#1971c2' }]
        .concat(activeMets.filter(m => m.t12 > 0).map(m => ({ name: m.name, cp: m.cp, color: m.color })));
      series.forEach((sr, k) => {
        traces.push({
          x: troughIdx.map(i => sim.t[i]), y: troughIdx.map(i => sr.cp[i]),
          type: 'scatter', mode: 'lines+markers', name: k === 0 ? BZD.t('pk.troughs') : '', showlegend: k === 0,
          line: { color: sr.color, width: 1.5, dash: 'dot' }, marker: { size: 5, color: sr.color, symbol: 'diamond' },
          hovertemplate: `${BZD.t('pk.troughHover', { name: sr.name })}: %{y:.1f} ${BZD.concUnit()}<extra></extra>`,
        });
      });
      const ssLines = steadyStateLevels(sim, drug);
      ssLines.forEach(l => {
        traces.push({
          x: [0, sim.tEnd], y: [l.css, l.css], type: 'scatter', mode: 'lines', showlegend: false,
          line: { color: l.color, width: 1.2, dash: 'longdash' }, hoverinfo: 'skip',
        });
        annotations.push({ x: sim.tEnd, y: l.css, xanchor: 'right', yanchor: 'bottom', showarrow: false,
          text: `${l.name} C<sub>ss,avg</sub> ≈ ${BZD.fmt(l.css)} · R ≈ ${BZD.fmt(l.R, 1)}×`, font: BZD.plotFont({ size: 11, color: l.color }) });
      });
    }

    // Vertical markers for doses
    if (sim.doseTimes.length > 1) {
      sim.doseTimes.forEach((dt, idx) => {
        traces.push({
          x: [dt, dt],
          y: [0, sim.params.cmaxAll * 1.05],
          type: 'scatter',
          mode: 'lines',
          name: idx === 0 ? BZD.t('pk.doseGiven') : '',
          showlegend: idx === 0,
          line: { color: '#adb5bd', width: 1, dash: 'dot' },
          hoverinfo: 'none'
        });
      });
    }

    const layout = {
      xaxis: { title: { text: BZD.t('pk.axis.time'), standoff: 8 }, automargin: true, gridcolor: '#f1f3f5' },
      yaxis: {
        title: { text: BZD.t('pk.axis.conc', { unit: BZD.concUnit() }) },
        type: scale === 'log' ? 'log' : 'linear',
        gridcolor: '#f1f3f5',
        rangemode: scale === 'log' ? 'normal' : 'tozero'
      },
      margin: { l: 60, r: 25, t: 30, b: 130 },
      annotations,
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'top', y: -0.30, x: 0 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() }, separators: BZD.plotSeparators()
    };

    Plotly.react(target, traces, layout, { responsive: true, displayModeBar: false });
    renderAccumulationSummary(sim, drug);
  }

  /**
   * Predicted steady-state averages for the parent and its direct active metabolites:
   * C_ss,avg = F·D/(CL·τ) (parent); fm·F·D/(CL_m·τ) (metabolite); R = 1/(1 − e^(−kτ)).
   */
  function steadyStateLevels(sim, drug) {
    const raw = sim.raw || sim;                                        // ng/mL values (dose recovery, threshold)
    const tau = raw.doseTimes[1] - raw.doseTimes[0];
    const dose = raw.params.auc * raw.params.CL / raw.params.F / 1000;   // recover the dose (mg)
    const out = [{ name: drug.name, color: drug.color || '#1971c2', ng: raw.params.cssAvg, mw: drug.mw, R: raw.params.R, t12: raw.params.t12 }];
    const defs = drug.pk.metabolites || (drug.pk.metabolite ? [Object.assign({ parent: 'parent' }, drug.pk.metabolite)] : []);
    (raw.metabolites || []).forEach((m, i) => {
      const d = defs[i];
      if (!d || d.parent !== 'parent' || !d.fm || !m.CL) return;
      const k = m.CL / m.V;
      out.push({ name: m.name, color: m.color, ng: d.fm * raw.params.F * dose / (m.CL * tau) * 1000, mw: d.mw, R: 1 / (1 - Math.exp(-k * tau)), t12: m.t12 });
    });
    return out.filter(l => l.ng > 0.5).map(l => ({ ...l, css: BZD.conc(l.ng, l.mw) }));
  }

  function renderAccumulationSummary(sim, drug) {
    const el = document.getElementById('pk-accum-summary');
    if (!el) return;
    const days = (h) => (h / 24 < 1 ? `${BZD.fmt(h)} h` : BZD.t('pk.days', { d: BZD.fmt(h / 24, 1) }));
    if (sim.doseTimes.length < 2) {
      const slow = Math.max(sim.params.t12, ...(sim.metabolites || []).map(m => m.t12));
      el.innerHTML = BZD.t('pk.accum.single', { drug: inn(drug.name), t: BZD.fmt(slow), time: days(4.5 * slow) });
      return;
    }
    const tau = sim.doseTimes[1] - sim.doseTimes[0];
    const lines = steadyStateLevels(sim, drug);
    const items = lines.map(l => `<b style="color:${l.color}">${l.name}</b>: ${BZD.t('pk.accum.item', { t: BZD.fmt(l.t12), r: BZD.fmt(l.R, 1), time: days(3.3 * l.t12) })}`).join('<br/>');
    const slowest = lines.reduce((a, b) => (b.t12 > a.t12 ? b : a), lines[0]);
    el.innerHTML = `
      ${BZD.t('pk.accum.multi', { tau: BZD.fmt(tau) })}<br/>${items}
      ${slowest && slowest.name !== drug.name ? `<br/>${BZD.t('pk.accum.clinical', { met: inn(slowest.name), drug: inn(drug.name) })}` : ''}`;
  }

  /**
   * Render derived PK parameters table
   */
  function renderParamsTable(sim, drug, route = 'oral') {
    const table = document.getElementById('pk-params');
    const notes = document.getElementById('pk-notes');
    if (!table) return;

    const p = sim.params;
    const baseT12 = drug.pk.t12;
    const t12Delta = p.t12 / baseT12;
    const routeText = getRouteLabel(route);

    table.innerHTML = `
      <tbody>
        <tr>
          <td>${BZD.t('pk.p.route')}</td>
          <td><b>${routeText}</b></td>
        </tr>
        <tr>
          <td>${BZD.t('pk.p.cmax')}</td>
          <td><b>${BZD.fmt(p.cmax, 1)} ${BZD.concUnit()}</b></td>
        </tr>
        <tr>
          <td>${BZD.t('pk.p.tmax')}</td>
          <td><b>${BZD.fmt(p.tmax, 2)} h</b></td>
        </tr>
        <tr>
          <td>${BZD.t('pk.p.thalf')}</td>
          <td>
            <b>${BZD.fmt(p.t12, 1)} h</b>
            ${Math.abs(t12Delta - 1) > 0.05
              ? `<span class="delta ${t12Delta > 1 ? 'up' : 'down'}">(${t12Delta > 1 ? '+' : ''}${BZD.fmt((t12Delta - 1) * 100)}%)</span>`
              : ''}
          </td>
        </tr>
        <tr>
          <td>${BZD.t('pk.p.vd')}</td>
          <td><b>${BZD.fmt(p.V, 1)} L</b>${sim.eff.vMult > 1.01 ? ` (${BZD.t('pk.p.vdBase', { v: BZD.fmt(p.V / sim.eff.vMult) })})` : ''}</td>
        </tr>
        <tr>
          <td>${BZD.t('pk.p.cl')}</td>
          <td><b>${BZD.fmt(p.CL, 2)} L/h</b></td>
        </tr>
        <tr>
          <td>${BZD.t('pk.p.f')}</td>
          <td><b>${BZD.fmt(p.F * 100)}%</b></td>
        </tr>
        <tr>
          <td>${BZD.t('pk.p.auc')}</td>
          <td><b>${BZD.fmt(p.auc)} ${BZD.aucUnit()}</b></td>
        </tr>
        ${p.R > 1.05 ? `
          <tr>
            <td>${BZD.t('pk.p.r')}</td>
            <td><b>${BZD.fmt(p.R, 2)}×</b></td>
          </tr>
          <tr>
            <td>${BZD.t('pk.p.css')}</td>
            <td><b>${p.cssAvg ? `${BZD.fmt(p.cssAvg, 1)} ${BZD.concUnit()}` : '-'}</b></td>
          </tr>
          <tr>
            <td>${BZD.t('pk.p.t90')}</td>
            <td><b>${BZD.fmt(3.3 * p.t12)} h</b> (~${BZD.t('pk.days', { d: BZD.fmt(3.3 * p.t12 / 24, 1) })})</td>
          </tr>
        ` : ''}
        ${sim.metabolites && sim.metabolites.length > 0 ? sim.metabolites.map(m => `
          <tr style="background:#faf8f5">
            <td>${BZD.t('pk.p.met', { name: `<b style="color:${m.color}">${m.name}</b>`, t: BZD.fmt(m.t12, 1) })}</td>
            <td><b style="color:${m.color}">${m.cmax ? `${BZD.fmt(m.cmax, 1)} ${BZD.concUnit()}` : '-'}</b></td>
          </tr>
        `).join('') : ''}
      </tbody>
    `;

    if (notes) {
      let modText = [];
      if (sim.eff.clMult < 0.95) modText.push(BZD.t('pk.mod.clDown', { p: BZD.fmt(sim.eff.clMult * 100) }));
      if (sim.eff.clMult > 1.05) modText.push(BZD.t('pk.mod.clUp', { p: BZD.fmt(sim.eff.clMult * 100) }));
      if (sim.eff.vMult > 1.05) modText.push(BZD.t('pk.mod.vUp'));

      let routeNote = '';
      const ri = routeInfo(route);
      if (route === 'im' && drug === BZD.drugs.diazepam) {
        routeNote = `<br/>${BZD.t('pk.note.imDiazepam')}`;
      } else if (route === 'im' && (drug === BZD.drugs.midazolam || drug === BZD.drugs.lorazepam)) {
        routeNote = `<br/>${BZD.t('pk.note.imGood')}`;
      } else if (ri && route !== 'oral') {
        routeNote = `<br/><b style="color:${ri.badgeColor}">${ri.name}:</b> ${ri.advantages}. <span style="color:#c92a2a">${BZD.t('pk.note.limitations')}</span> ${ri.limitations}.`;
      }
      const allowedNames = getAllowedRoutes(drug).map(getRouteLabel).join(', ');
      routeNote += `<br/>${BZD.t('pk.note.formulations', { drug: inn(drug.name), routes: allowedNames })}`;

      notes.innerHTML = `
        <p>${BZD.t('pk.note.summary', { drug: inn(drug.name), t: BZD.fmt(baseT12, baseT12 % 1 ? 1 : 0) })}
        ${modText.length > 0 ? BZD.t('pk.note.mods', { mods: modText.join(BZD.t('pk.and')) }) : BZD.t('pk.note.noMods')}
        ${p.met ? `<br/>${BZD.t('pk.note.met', { name: p.met.name, t: BZD.fmt(p.met.t12, 1) })}` : ''}
        ${routeNote}
        </p>
      `;
    }
  }

  /**
   * Plot F: Duration of action comparison across 6 drugs
   */
  function plotDurationComparison(weight, mods) {
    const target = document.getElementById('pk-plot-cmp');
    if (!target) return;

    // Drugs and doses compared: assets/data/properties.json (BZD.model.durationComparison)
    const cmpDrugs = BZD.model.durationComparison.map(c => ({ key: c.key, dose: c.dose, name: c.label }));

    const traces = cmpDrugs.map(cd => {
      const d = BZD.drugs[cd.key];
      const sim = Models.simulate({
        drug: d,
        dose: cd.dose,
        route: 'oral',
        n: 1,
        tau: 24,
        weight,
        mods,
        tEnd: 48
      });

      const peak = sim.params.cmax || 1;
      const normY = sim.cp.map(c => (c / peak) * 100);

      return {
        x: sim.t,
        y: normY,
        type: 'scatter',
        mode: 'lines',
        name: cd.name,
        line: { color: d.color, width: 2.5, dash: cd.key === 'oxazepam' ? 'dash' : 'solid' }
      };
    });

    const layout = {
      xaxis: { title: { text: BZD.t('pk.cmp.x'), standoff: 8 }, automargin: true, range: [0, 48], gridcolor: '#f1f3f5' },
      yaxis: { title: { text: BZD.t('pk.cmp.y') }, range: [0, 105], gridcolor: '#f1f3f5' }, separators: BZD.plotSeparators(),
      margin: { l: 55, r: 20, t: 25, b: 115 },
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'top', y: -0.34, x: 0 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() }
    };

    Plotly.react(target, traces, layout, { responsive: true, displayModeBar: false });

    const summary = document.getElementById('pk-cmp-summary');
    if (summary) {
      const t50 = traces.map((tr, i) => {
        const iPk = tr.y.indexOf(Math.max(...tr.y));
        const k = tr.y.findIndex((v, j) => j > iPk && v <= 50);
        return { name: cmpDrugs[i].key, color: BZD.drugs[cmpDrugs[i].key].color, t: k > 0 ? tr.x[k] : null };
      });
      const fmt = (e) => `<b style="color:${e.color}">${BZD.drugs[e.name].name}</b> ${e.t === null ? '> 48 h' : '≈ ' + BZD.fmt(e.t, e.t < 10 ? 1 : 0) + ' h'}`;
      summary.innerHTML = BZD.t('pk.cmp.summary', { list: t50.map(fmt).join(' · '), mods: mods.length ? BZD.t('pk.cmp.withMods') : '' });
    }
  }

  return { init, update, syncRouteOptions, getAllowedRoutes };
})();
