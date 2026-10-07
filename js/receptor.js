/* =====================================================================
 * receptor.js - Mechanism controls, receptor model state & readouts
 * (the rotatable cryo-EM structure itself is drawn by structure.js)
 * ===================================================================== */
window.Receptor = (function () {
  'use strict';

  // Colors
  const COLORS = {
    alpha: '#5B8DEF',
    beta: '#3CCB8F',
    gamma: '#F4A340',
    cl: '#22B8CF',
    gaba: '#E5484D',
    bzd: '#8E4EC6',
    flu: '#FA5252',
    membrane: '#FCE9C8',
    membraneBorder: '#E0B873',
    headgroup: '#FFB4A2',
  };

  // What occupies the BZD site: the selected ligand, or flumazenil when it dominates
  function bzdDisplay(state) {
    const { ligandKey, bzdCalc, fluOn, drug } = state;
    const ligPresent = ligandKey !== 'none' && bzdCalc.occD > 0.05;
    const fluPresent = fluOn && bzdCalc.occF > 0.05;
    const showFlu = ligandKey === 'flumazenil' || (fluPresent && (!ligPresent || bzdCalc.occF >= bzdCalc.occD));
    return {
      active: ligPresent || fluPresent,
      kind: showFlu ? 'flumazenil' : 'bzd',
      color: showFlu ? COLORS.flu : (drug?.color || COLORS.bzd),
      name: showFlu ? (fluPresent || ligPresent ? 'flumazenil' : '') : (ligPresent ? drug.name : ''),
    };
  }

  let currentInfo = 'alpha';

  /**
   * Initialize receptor module: attach event listeners and do initial render
   */
  function init() {
    if (!document.getElementById('m-readouts')) return;

    // Populate select dropdowns
    populateControls();

    // Attach listeners
    ['m-gaba', 'm-flu', 'm-neuron'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', update);
    });
    document.getElementById('m-vm')?.addEventListener('input', update);

    const subSel = document.getElementById('m-sub');
    if (subSel) {
      subSel.addEventListener('change', () => {
        if (window.syncSubunitSelection) {
          window.syncSubunitSelection(subSel.value, 'm-sub');
        } else {
          update();
          showSubunitInfo('alpha');
        }
      });
    }

    const ligSel = document.getElementById('m-ligand');
    if (ligSel) {
      ligSel.addEventListener('change', () => {
        if (window.syncDrugSelection) {
          window.syncDrugSelection(ligSel.value, 'm-ligand');
        } else {
          update();
        }
      });
    }

    const concEl = document.getElementById('m-conc');
    if (concEl) {
      concEl.addEventListener('input', () => {
        doseMode = false;
        updateDoseNote();
        updateConcDisplay();
        update();
        // keep the Pharmacodynamics free-concentration slider (same log scale) in step
        const pdConc = document.getElementById('pd-conc');
        if (pdConc && pdConc.value !== concEl.value) {
          pdConc.value = concEl.value;
          if (window.PD && window.PD.syncConc) window.PD.syncConc();
        }
      });
    }


    // Dose → peak unbound concentration
    ['m-dose', 'm-n', 'm-tau'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { doseMode = true; pushDosingToPK(true); applyDose(); update(); });
    });

    // Initial draw
    updateConcDisplay();
    update();
  }

  function populateControls() {
    const subSel = document.getElementById('m-sub');
    if (subSel && subSel.options.length === 0) {
      Object.entries(BZD.subtypes).forEach(([k, v]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = BZD.isoformLabel(k);
        if (k === 'a1') opt.selected = true;
        subSel.appendChild(opt);
      });
    }

    const ligSel = document.getElementById('m-ligand');
    if (ligSel && ligSel.options.length === 0) {
      const noneOpt = document.createElement('option');
      noneOpt.value = 'none';
      noneOpt.textContent = BZD.t('rx.noLigand');
      ligSel.appendChild(noneOpt);

      Object.entries(BZD.drugs).forEach(([k, v]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = `${v.name} (${v.role.replace(/ \(([^)]+)\)/, ' · $1')})`; // no nested brackets
        if (k === 'diazepam') opt.selected = true;
        ligSel.appendChild(opt);
      });
    }

    // Cl⁻ conditions of the single-channel model (values and Vm range from BZD.model.singleChannel)
    const sc = BZD.model.singleChannel;
    const neuronSel = document.getElementById('m-neuron');
    if (neuronSel) {
      neuronSel.options[0].textContent = BZD.t('mechanism.neuronMature', { cl: BZD.fmt(sc.clIn_mM) });
      neuronSel.options[1].textContent = BZD.t('mechanism.neuronImmature', { cl: BZD.fmt(sc.clInImmature_mM) });
    }
    const vmEl = document.getElementById('m-vm');
    if (vmEl) { vmEl.min = sc.vmMin_mV; vmEl.max = sc.vmMax_mV; vmEl.value = sc.vm_mV; }
  }

  /** Membrane potential and intracellular Cl⁻ selected for the Cl⁻ flux model */
  function channelConditions() {
    const sc = BZD.model.singleChannel;
    const vm_mV = BZD.numInput('m-vm', sc.vm_mV);
    const clIn_mM = document.getElementById('m-neuron')?.value === 'immature' ? sc.clInImmature_mM : sc.clIn_mM;
    const lbl = document.getElementById('m-vm-val');
    if (lbl) lbl.textContent = `${BZD.fmt(vm_mV).replace('-', '−')} mV`;
    return { vm_mV, clIn_mM };
  }

  /**
   * Dose → free (unbound) concentration: peak plasma concentration after a single
   * dose by the drug's default route (one-compartment PK model, 70 kg adult),
   * multiplied by the unbound fraction fu and converted to nM (brain unbound ≈
   * plasma unbound for these lipophilic drugs).
   */
  let doseMode = true;
  let lastLigand = null;
  let doseInfo = null;

  function setDefaultDose() {
    const key = document.getElementById('m-ligand')?.value || 'none';
    const drug = BZD.drugs[key];
    const el = document.getElementById('m-dose');
    if (!el) return;
    const ok = !!(drug && drug.pk);
    ['m-dose', 'm-n', 'm-tau'].forEach(id => { const e = document.getElementById(id); if (e) e.disabled = !ok; });
    if (ok) {
      el.value = drug.pk.dose;
      const tauEl = document.getElementById('m-tau');
      if (tauEl && drug.pk.tau) tauEl.value = drug.pk.tau;
      pushDosingToPK(false);
    }
    doseMode = ok;
  }

  /** Copy the section 1 dosing regimen into the Pharmacokinetics inputs (optionally re-plotting PK) */
  function pushDosingToPK(replot) {
    let changed = false;
    [['m-dose', 'pk-dose'], ['m-n', 'pk-n'], ['m-tau', 'pk-tau']].forEach(([a, b]) => {
      const src = document.getElementById(a), dst = document.getElementById(b);
      if (src && dst && dst.value !== src.value) { dst.value = src.value; changed = true; }
    });
    if (replot && changed && window.PK && window.PK.update) window.PK.update();
  }

  /** Regimen + patient settings that determine the derived concentration */
  function regimen() {
    const key = document.getElementById('m-ligand')?.value || 'none';
    const drug = BZD.drugs[key];
    const allowed = drug && window.PK && window.PK.getAllowedRoutes ? window.PK.getAllowedRoutes(drug) : null;
    const pkRoute = document.getElementById('pk-route')?.value;
    const route = drug ? ((allowed && allowed.includes(pkRoute)) ? pkRoute : (drug.pk?.defaultRoute || drug.defaultRoute || 'oral')) : 'oral';
    const mods = [...document.querySelectorAll('#pk-mods input:checked')].map(cb => cb.value);
    return { key, drug, dose: BZD.numInput('m-dose', 0), n: BZD.numInput('m-n', 1, true), tau: BZD.numInput('m-tau', 24), route, weight: BZD.numInput('pk-wt', 70), mods };
  }
  let lastSig = '';
  const sigOf = (r) => JSON.stringify([r.key, r.dose, r.n, r.tau, r.route, r.weight, r.mods]);

  /** Called by the PK section after it updates: mirror its dosing inputs and re-derive the concentration */
  function syncFromPK() {
    [['pk-dose', 'm-dose'], ['pk-n', 'm-n'], ['pk-tau', 'm-tau']].forEach(([a, b]) => {
      const src = document.getElementById(a), dst = document.getElementById(b);
      if (src && dst && dst.value !== src.value) dst.value = src.value;
    });
    if (sigOf(regimen()) === lastSig) return;
    doseMode = true;
    applyDose();
    update();
  }

  function applyDose() {
    const key = document.getElementById('m-ligand')?.value || 'none';
    const drug = BZD.drugs[key];
    const concEl = document.getElementById('m-conc');
    doseInfo = null;
    if (!doseMode || !drug || !drug.pk || !concEl) { updateDoseNote(); return; }
    const r = regimen();
    lastSig = sigOf(r);
    if (!(r.dose > 0)) { updateDoseNote(); return; }
    const sim = Models.simulate({ drug, dose: r.dose, route: r.route, n: r.n, tau: r.tau, weight: r.weight, mods: r.mods });
    const cmax = r.n > 1 ? sim.params.cmaxAll : sim.params.cmax;   // ng/mL (total), peak over the regimen
    const free = cmax * (drug.pk.fu ?? 1) * 1000 / drug.mw;          // nM unbound
    doseInfo = { ...r, cmax, free, fu: drug.pk.fu ?? 1 };
    concEl.value = Math.max(-1, Math.min(4, Math.log10(Math.max(free, 1e-3)))).toFixed(2);
    updateConcDisplay();
    updateDoseNote();
    const pdConc = document.getElementById('pd-conc');
    if (pdConc && pdConc.value !== concEl.value) {
      pdConc.value = concEl.value;
      if (window.PD && window.PD.syncConc) window.PD.syncConc();
    }
  }

  function updateDoseNote() {
    const note = document.getElementById('m-dose-note');
    if (!note) return;
    const key = document.getElementById('m-ligand')?.value || 'none';
    const drug = BZD.drugs[key];
    if (!drug) { note.textContent = BZD.t('rx.note.select'); return; }
    if (!drug.pk) { note.textContent = BZD.t('rx.note.noPk', { drug: drug.name }); return; }
    if (!doseMode || !doseInfo) { note.textContent = BZD.t('rx.note.manual'); return; }
    const di = doseInfo;
    // equation (KaTeX via tex.js) with the values of the selected regimen
    note.innerHTML = BZD.t('rx.note.derived', { cmax: BZD.fmt(BZD.conc(di.cmax, drug.mw), 1), unit: BZD.concUnit(), regimen: di.n > 1 ? BZD.t('rx.note.regimen', { n: di.n, tau: di.tau }) : '', fu: BZD.fmt(di.fu * 100), freeNM: BZD.fmt(di.free, di.free < 10 ? 1 : 0), mw: BZD.fmt(drug.mw, 1) });
  }

  function getConcNM() {
    const concEl = document.getElementById('m-conc');
    const val = concEl ? parseFloat(concEl.value) : 2;
    return Math.pow(10, val);
  }

  function updateConcDisplay() {
    const val = getConcNM();
    const lbl = document.getElementById('m-conc-val');
    if (!lbl) return;
    if (val < 1) lbl.textContent = `${BZD.fmt(val * 1000)} pM`;
    else if (val < 1000) lbl.textContent = `${BZD.fmt(val, val < 10 ? 1 : 0)} nM`;
    else lbl.textContent = `${BZD.fmt(val / 1000, 2)} µM`;
  }

  function getState() {
    const gaba = parseFloat(document.getElementById('m-gaba')?.value || '10');
    const ligandKey = document.getElementById('m-ligand')?.value || 'diazepam';
    const subKey = document.getElementById('m-sub')?.value || 'a1';
    const fluOn = document.getElementById('m-flu')?.checked || false;
    const cNM = ligandKey === 'none' ? 0 : getConcNM();
    const fluNM = fluOn ? 200 : 0;

    const bzdCalc = Models.bzdSite(ligandKey, subKey, cNM, fluNM);
    // open probability from the kinetic scheme during sustained GABA: peak (po) and steady state (kin)
    const kin = Models.kineticSummary(gaba, bzdCalc.shift);
    const po = kin.peak;
    const ec50 = Models.ec50App(subKey, bzdCalc.shift);
    const baseEc50 = BZD.subtypes[subKey].gabaEC50;

    return {
      gaba, ligandKey, subKey, fluOn, cNM, fluNM,
      bzdCalc, po, kin, ec50, baseEc50,
      channel: Models.clChannel(channelConditions()),
      subInfo: BZD.subtypes[subKey],
      drug: ligandKey !== 'none' ? BZD.drugs[ligandKey] : null
    };
  }

  /**
   * Master update function called when controls change
   */
  function update() {
    const ligNow = document.getElementById('m-ligand')?.value || 'none';
    if (ligNow !== lastLigand) {
      lastLigand = ligNow;
      setDefaultDose();
      applyDose();
    }
    const state = getState();
    renderHeader(state);
    renderReadouts(state);
    if (window.Structure && typeof window.Structure.setState === 'function') {
      window.Structure.setState(state);
    }
    scheduleKinetics(state);

    if (currentInfo === 'alpha') showSubunitInfo('alpha');
  }

  /**
   * Kinetic scheme (Models.kineticResponse): open and desensitised fractions after GABA is applied
   * at the selected concentration, for GABA alone and with the selected ligand. Log time axis from
   * 0.1 ms to 10 s shows activation, the peak and desensitisation to steady state.
   */
  let kinTimer = null;
  function scheduleKinetics(state) {
    clearTimeout(kinTimer);
    kinTimer = setTimeout(() => renderKinetics(state), 120);   // debounce slider drags
  }
  let kinKey = '';
  function renderKinetics(state) {
    const target = document.getElementById('m-plot-kin');
    const summary = document.getElementById('m-kin-summary');
    if (!target) return;
    if (typeof Plotly === 'undefined') { setTimeout(() => renderKinetics(state), 300); return; }
    // the plot depends only on GABA and the ligand's EC50 shift (not on Vm or the neuron type)
    const key = JSON.stringify([state.gaba, (state.bzdCalc.shift || 1).toPrecision(4), state.drug && state.drug.name]);
    if (key === kinKey) return;
    kinKey = key;
    const kc = BZD.model.kinetics;
    const note = BZD.t('kin.note', { lo: BZD.fmt(kc.temperatureLow_C), hi: BZD.fmt(kc.temperatureHigh_C) });
    const gaba = state.gaba, shift = state.bzdCalc.shift || 1;
    // One log time axis: GABA applied for APP s, then washed out until END s (recovery from desensitisation).
    // Washout lowers GABA exponentially (time constant WASH_TAU s, as with perfusion), so the curves stay smooth.
    const APP = 4, END = 30, WASH_TAU = 0.5;
    const tA = Array.from({ length: 141 }, (_, i) => 1e-4 * Math.pow(APP / 1e-4, i / 140));            // s, during GABA
    // after washout: dense, log-spaced in time since washout (0.1 ms … END − APP), so fast deactivation is drawn as a curve
    const tW = Array.from({ length: 101 }, (_, i) => APP + 1e-4 * Math.pow((END - APP) / 1e-4, i / 100));   // s
    const tMs = tA.concat(tW).map(t => t * 1000);
    const pctArr = (a) => a.map(v => 100 * v);
    const traces = [];
    const modulated = state.drug && Math.abs(shift - 1) > 0.005;
    const inn = state.drug ? (/^[A-Z0-9-]+$/.test(state.drug.name) ? state.drug.name : state.drug.name.toLowerCase()) : '';   // INN lower case mid-sentence
    const run = (f) => {
      const a = Models.kineticResponse(gaba, f, tA);
      // washout: step through the samples with GABA at the interval midpoint of its exponential decline
      let p = a.p, t0 = APP; const wOpen = [], wDes = [];
      tW.forEach(t1 => {
        const g = gaba * Math.exp(-((t0 + t1) / 2 - APP) / WASH_TAU);
        const r = Models.kineticResponse(g, f, [t1], p, t0);
        p = r.p; t0 = t1; wOpen.push(r.open[0]); wDes.push(r.des[0]);
      });
      return { open: a.open.concat(wOpen), des: a.des.concat(wDes), desW: wDes, desApp: a.des[a.des.length - 1] };
    };
    let wash = null, kPeak = null;
    if (gaba > 0) {
      const base = run(1);
      traces.push({ x: tMs, y: pctArr(base.open), name: BZD.t('kin.openGaba'), mode: 'lines', line: { color: '#868e96', width: 2, dash: 'dash' } });
      const mod = modulated ? run(shift) : base;
      if (modulated) traces.push({ x: tMs, y: pctArr(mod.open), name: BZD.t('kin.openDrug', { drug: inn }), mode: 'lines', line: { color: state.drug.color || '#0ca678', width: 3 } });
      traces.push({ x: tMs, y: pctArr(mod.des), name: modulated ? BZD.t('kin.desDrug', { drug: inn }) : BZD.t('kin.des'), mode: 'lines', line: { color: '#e8590c', width: 2, dash: 'dot' } });
      wash = { des: [mod.desApp].concat(mod.desW), t: [0].concat(tW.map(t => t - APP)), app: APP, tau: WASH_TAU };
      kPeak = Models.kineticSummary(gaba, modulated ? shift : 1);
    }
    // x ticks: decades plus the peak time and the start of washout (decades too close to them are dropped)
    const msLabel = (ms) => (ms >= 1000 ? `${BZD.fmt(ms / 1000, ms % 1000 ? 1 : 0)} s` : `${BZD.fmt(ms, ms % 1 && ms < 10 ? 1 : 0)} ms`);
    const special = [];
    if (kPeak && kPeak.tPeak) special.push({ v: kPeak.tPeak * 1000, label: BZD.t('kin.peakTick', { t: msLabel(kPeak.tPeak * 1000) }) });
    if (gaba > 0) special.push({ v: APP * 1000, label: BZD.t('kin.washTick', { t: msLabel(APP * 1000) }) });
    const decades = [0.1, 1, 10, 100, 1000, 10000, 30000].filter(v => special.every(sp => Math.abs(Math.log10(v / sp.v)) > 0.3));
    const ticks = decades.map(v => ({ v, label: msLabel(v) })).concat(special.map(sp => ({ v: sp.v, label: `<b>${sp.label}</b>` }))).sort((a, b) => a.v - b.v);
    const layout = {
      xaxis: { type: 'log', title: { text: BZD.t('kin.x') }, gridcolor: '#f1f3f5', automargin: true, range: [Math.log10(0.1), Math.log10(END * 1000)],
        tickvals: ticks.map(t => t.v), ticktext: ticks.map(t => t.label) },
      yaxis: { title: { text: BZD.t('kin.y') }, range: [0, 100], gridcolor: '#f1f3f5' },
      separators: BZD.plotSeparators(), margin: { l: 55, r: 20, t: 20, b: 60 },
      showlegend: true, legend: { orientation: 'h', yanchor: 'top', y: -0.22, x: 0 },
      plot_bgcolor: '#ffffff', paper_bgcolor: '#ffffff', font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() },
      // dotted marker lines at the peak and at the start of washout
      shapes: special.map(sp => ({ type: 'line', xref: 'x', yref: 'paper', x0: sp.v, x1: sp.v, y0: 0, y1: 1, line: { color: '#adb5bd', width: 1, dash: 'dot' } })),
      annotations: gaba > 0 ? [] : [{ text: BZD.t('kin.noGaba'), xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false }],
    };
    Plotly.react(target, traces, layout, { responsive: true, displayModeBar: false });
    if (summary) summary.innerHTML = kinSummary(state, gaba, shift, modulated, inn, note, wash);
  }

  function kinSummary(state, gaba, shift, modulated, inn, note, wash) {
    if (!(gaba > 0)) return note;
    const k0 = Models.kineticSummary(gaba, 1), k1 = Models.kineticSummary(gaba, shift);
    const pct = (x) => BZD.fmt(100 * x, x < 0.1 ? 1 : 0), ms = (t) => BZD.fmt(t * 1000, t < 0.01 ? 1 : 0);
    return BZD.t('kin.sum', { g: BZD.fmt(gaba), pk: pct(k0.peak), t: ms(k0.tPeak), ss: pct(k0.steady), d: pct(k0.des) })
      + (modulated ? ' ' + BZD.t('kin.sumDrug', { drug: inn, pk: pct(k1.peak), t: ms(k1.tPeak), ss: pct(k1.steady), s: BZD.fmt(shift, 2) }) : '')
      + ' ' + washSummary(wash) + ' ' + note;
  }

  /** Recovery after washout: time until half of the desensitised receptors have recovered, and recovery at the end */
  function washSummary(wash) {
    if (!wash || !(wash.des[0] > 0)) return '';
    const { des, t } = wash, half = des[0] / 2, k = des.findIndex(d => d <= half);
    const t50 = k > 0 ? t[k - 1] + (t[k] - t[k - 1]) * (des[k - 1] - half) / (des[k - 1] - des[k]) : null;
    const end = t[t.length - 1], rec = 100 * (1 - des[des.length - 1] / des[0]);
    return t50 === null ? BZD.t('kin.sumWashSlow', { app: BZD.fmt(wash.app), tau: BZD.fmt(wash.tau, 1), end: BZD.fmt(end), rec: BZD.fmt(rec) })
      : BZD.t('kin.sumWash', { app: BZD.fmt(wash.app), tau: BZD.fmt(wash.tau, 1), t50: BZD.fmt(t50, t50 < 1 ? 2 : 1), end: BZD.fmt(end), rec: BZD.fmt(rec) });
  }

  // Gating state derived from the receptor model (header and gate badge)
  function gatingParams(state) {
    const { gaba, ligandKey, bzdCalc, po, drug } = state;
    const gabaBound = gaba > 0;
    const isOpen = po > 0.05;
    const ligPresent = ligandKey !== 'none' && bzdCalc.occD > 0.05;
    const isPAM = !!(drug && drug.pd && (drug.pd.kind === 'PAM' || drug.pd.kind === 'Partial PAM'));
    const isNAM = !!(drug && drug.pd && drug.pd.kind === 'Inverse agonist');
    const site = bzdDisplay(state);

    const camp = !!(isPAM && ligPresent && bzdCalc.shift > 1.05);

    let gateLabel;
    if (!gabaBound) gateLabel = BZD.t('rx.gate.noAgonist');
    else if (!isOpen) gateLabel = BZD.t('rx.gate.closed');
    else if (camp) gateLabel = BZD.t('rx.gate.pam');
    else if (site.kind === 'flumazenil' && site.active) gateLabel = BZD.t('rx.gate.flu');
    else gateLabel = BZD.t('rx.gate.gaba');

    return { gabaBound, isOpen, ligPresent, isPAM, isNAM, site, camp, gateLabel };
  }

  // Condition header ("GABA & Diazepam", as in cryo-EM figure panels) and gate badge around the 3D viewer
  function renderHeader(state) {
    const title = document.getElementById('rx-title');
    const badge = document.getElementById('rx-badge');
    const { gabaBound, isOpen, ligPresent, camp, gateLabel } = gatingParams(state);
    if (title) {
      const parts = [];
      if (gabaBound) parts.push('GABA');
      if (ligPresent) parts.push(state.drug.name);
      if (state.fluOn && state.bzdCalc.occF > 0.05 && state.ligandKey !== 'flumazenil') parts.push(BZD.drugs.flumazenil.name);
      title.textContent = !parts.length ? BZD.t('rx.noLigands')
        : (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' & ' + parts[parts.length - 1] : parts[0]);
    }
    if (badge) {
      badge.textContent = gateLabel;
      badge.style.background = isOpen ? (camp ? '#2b8a3e' : '#0b7285') : '#c92a2a';
      badge.classList.toggle('pulse-open', isOpen && camp);
    }
  }

  function showSubunitInfo(type) {
    const infoBox = document.getElementById('m-subinfo');
    if (!infoBox) return;
    currentInfo = type;

    if (type === 'alpha') {
      const cur = document.getElementById('m-sub')?.value || 'a1';
      const s = BZD.subtypes[cur];
      infoBox.innerHTML = `
        <h4 style="color:var(--alpha)">${BZD.t('rx.info.alphaTitle', { label: s.label })}</h4>
        <p>${BZD.t(s.bzdSensitive ? 'rx.info.sensitive' : 'rx.info.insensitive', { residue: s.residue })}</p>
        <p><b>${BZD.t('rx.info.effects')}</b> ${s.effect}</p>
        <p><b>${BZD.t('rx.info.distribution')}</b> ${s.location}</p>
      `;
    } else if (type === 'beta') {
      infoBox.innerHTML = `
${BZD.t('rx.info.beta')}
      `;
    } else if (type === 'gamma') {
      infoBox.innerHTML = `
${BZD.t('rx.info.gamma')}
      `;
    } else if (type === 'bzd-site') {
      infoBox.innerHTML = `
${BZD.t('rx.info.bzdSite')}
      `;
    } else if (type === 'gaba-site') {
      infoBox.innerHTML = `
${BZD.t('rx.info.gabaSite')}
      `;
    } else if (type === 'pore') {
      infoBox.innerHTML = `
${BZD.t('rx.info.pore')}
      `;
    }
  }

  function renderReadouts(state) {
    const container = document.getElementById('m-readouts');
    if (!container) return;

    const { bzdCalc, po, kin, ec50, baseEc50, subInfo, drug, fluOn } = state;
    const occDPercent = BZD.fmt(bzdCalc.occD * 100, 1);
    const occFPercent = BZD.fmt(bzdCalc.occF * 100, 1);
    const pct = (x) => BZD.fmt(100 * x, x < 0.1 ? 1 : 0);

    container.innerHTML = `
      <div class=\"readout\">
        <div class=\"k\">${BZD.t('rx.ro.occupancy')}</div>
        <div class=\"v\" style=\"color:${COLORS.bzd}\">${drug ? occDPercent + '%' : '0%'}</div>
        ${fluOn ? `<div class=\"v small\" style=\"color:${COLORS.flu}\">+ ${BZD.drugs.flumazenil.name}: ${occFPercent}%</div>` : ''}
      </div>

      <div class=\"readout\">
        <div class=\"k\">${BZD.t('rx.ro.ec50')}</div>
        <div class=\"v\">${BZD.fmt(ec50, 1)} µM</div>
        <div class=\"v small\">${BZD.t('rx.ro.baseline', { v: BZD.fmt(baseEc50, baseEc50 % 1 ? 1 : 0) })}</div>
      </div>

      <div class=\"readout full\">
        <div class=\"k\">${BZD.t('rx.ro.po')}</div>
        <div class=\"v\" style=\"color:#0b7285\">${BZD.t('rx.ro.poPeak', { v: pct(po) })}</div>
        <div class=\"v small\">${po > 0 ? BZD.t('rx.ro.poSteady', { ss: pct(kin.steady), d: pct(kin.des) }) : BZD.t('rx.ro.poNone')}</div>
        <div class=\"bar\"><i style=\"width:${Math.min(100, po * 100)}%\"></i></div>
      </div>


    `;
  }

  /** Called when the Pharmacodynamics slider moves: mirror its value here */
  function syncConc() { updateConcDisplay(); update(); }

  return { init, update, showSubunitInfo, getState, gatingParams, syncConc, syncFromPK };
})();
