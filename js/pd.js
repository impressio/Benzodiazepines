/* =====================================================================
 * pd.js - Pharmacodynamics (allosteric shift, occupancy, IPSC, selectivity)
 * Powered by Plotly.js
 * ===================================================================== */
window.PD = (function () {
  'use strict';

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
    populateControls();
    attachListeners();
    waitForPlotly(update);
  }

  function populateControls() {
    const drugSel = document.getElementById('pd-drug');
    if (drugSel && drugSel.options.length === 0) {
      const noneOpt = document.createElement('option');
      noneOpt.value = 'none';
      noneOpt.textContent = BZD.t('pd.noLigand');
      drugSel.appendChild(noneOpt);

      Object.entries(BZD.drugs).forEach(([k, v]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = `${v.name} (${v.role})`;
        if (k === 'diazepam') opt.selected = true;
        drugSel.appendChild(opt);
      });
    }

    const subSel = document.getElementById('pd-sub');
    if (subSel && subSel.options.length === 0) {
      Object.entries(BZD.subtypes).forEach(([k, v]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = BZD.isoformLabel(k);
        if (k === 'a1') opt.selected = true;
        subSel.appendChild(opt);
      });
    }
  }

  function attachListeners() {
    const fluOn = document.getElementById('pd-flu-on');
    if (fluOn) fluOn.addEventListener('change', update);

    const subSel = document.getElementById('pd-sub');
    if (subSel) {
      subSel.addEventListener('change', () => {
        if (window.syncSubunitSelection) {
          window.syncSubunitSelection(subSel.value, 'pd-sub');
        } else {
          update();
        }
      });
    }

    const drugSel = document.getElementById('pd-drug');
    if (drugSel) {
      drugSel.addEventListener('change', () => {
        if (window.syncDrugSelection) {
          window.syncDrugSelection(drugSel.value, 'pd-drug');
        } else {
          update();
        }
      });
    }

    ['pd-conc', 'pd-flu'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          updateLabels();
          update();
          if (id === 'pd-conc') {
            const mConc = document.getElementById('m-conc');
            if (mConc && mConc.value !== el.value) {
              mConc.value = el.value;
              if (window.Receptor && window.Receptor.syncConc) window.Receptor.syncConc();
            }
          }
        });
      }
    });

    updateLabels();
  }

  function getDrugConcNM() {
    const el = document.getElementById('pd-conc');
    return el ? Math.pow(10, parseFloat(el.value)) : 50;
  }

  function getFluConcNM() {
    const el = document.getElementById('pd-flu');
    return el ? Math.pow(10, parseFloat(el.value)) : 100;
  }

  function updateLabels() {
    const c = getDrugConcNM();
    const cEl = document.getElementById('pd-conc-val');
    if (cEl) cEl.textContent = formatConc(c);

    const f = getFluConcNM();
    const fEl = document.getElementById('pd-flu-val');
    if (fEl) fEl.textContent = formatConc(f);
  }

  function formatConc(nM) {
    if (nM < 1) return `${BZD.fmt(nM * 1000)} pM`;
    if (nM < 1000) return `${BZD.fmt(nM, nM < 10 ? 1 : 0)} nM`;
    return `${BZD.fmt(nM / 1000, 2)} µM`;
  }

  function update() {
    if (typeof Plotly === 'undefined') {
      waitForPlotly(update);
      return;
    }

    const drugKey = document.getElementById('pd-drug')?.value || 'diazepam';
    const subKey = document.getElementById('pd-sub')?.value || 'a1';
    const fluOnEl = document.getElementById('pd-flu-on');

    // If Flumazenil is chosen as the primary drug, uncheck the competing flumazenil modifier
    if (drugKey === 'flumazenil' && fluOnEl && fluOnEl.checked) {
      fluOnEl.checked = false;
    }
    const fluOn = fluOnEl?.checked || false;

    const cNM = drugKey === 'none' ? 0 : getDrugConcNM();
    const fluNM = (fluOn && drugKey !== 'flumazenil') ? getFluConcNM() : 0;

    const bzdCalc = Models.bzdSite(drugKey, subKey, cNM, fluNM);
    const drug = drugKey !== 'none' ? BZD.drugs[drugKey] : null;

    plotConcentrationResponse(subKey, bzdCalc, drug, fluNM);
    plotOccupancy(drugKey, cNM, fluNM);
    plotIPSC(subKey, bzdCalc, drug);
    plotSelectivity(drugKey);
    renderSubunitEffects(drugKey, cNM, fluNM, subKey);
    plotDoseEffect(drugKey);
  }

  /**
   * Plot A: GABA concentration-response with allosteric shift
   */
  function plotConcentrationResponse(subKey, bzdCalc, drug, fluNM = 0) {
    const target = document.getElementById('pd-plot-cr');
    const summary = document.getElementById('pd-cr-summary');
    if (!target) return;

    const gabaVals = [];
    for (let logG = -2; logG <= 3.5; logG += 0.05) {
      gabaVals.push(Math.pow(10, logG));
    }

    const baseResp = gabaVals.map(g => Models.gabaResponse(g, subKey, 1) * 100);
    const modResp = gabaVals.map(g => Models.gabaResponse(g, subKey, bzdCalc.shift) * 100);

    const baseEC50 = BZD.subtypes[subKey].gabaEC50;
    const appEC50 = Models.ec50App(subKey, bzdCalc.shift);

    const isAntagonist = drug && drug.pd && drug.pd.kind === 'Antagonist';
    const isShifted = Math.abs(appEC50 - baseEC50) > 0.15;

    let modLineName = BZD.t('pd.cr.modulated');
    const ec = (v) => BZD.fmt(v, v % 1 ? 1 : 0), flu = BZD.drugs.flumazenil.name;
    let modLineColor = '#8e4ec6';

    if (drug) {
      if (isAntagonist) {
        modLineName = BZD.t('pd.cr.antagonist', { drug: drug.name });
        modLineColor = '#fa5252';
      } else if (drug.pd.kind === 'Inverse agonist') {
        modLineName = BZD.t('pd.cr.nam', { drug: drug.name, b: BZD.fmt(drug.pd.emax, 2) });
        modLineColor = '#e03131';
      } else if (drug.pd.kind === 'Partial PAM') {
        modLineName = fluNM > 0
          ? BZD.t('pd.cr.antagonised', { drug: drug.name, flu })
          : BZD.t('pd.cr.partial', { drug: drug.name, b: BZD.fmt(drug.pd.emax, 1) });
        modLineColor = '#74b816';
      } else {
        modLineName = fluNM > 0
          ? BZD.t('pd.cr.antagonised', { drug: drug.name, flu })
          : BZD.t('pd.cr.shift', { drug: drug.name });
      }
    }

    const ec50Markers = isShifted ? [
      {
        x: [baseEC50],
        y: [50],
        type: 'scatter',
        mode: 'markers+text',
        name: BZD.t('pd.cr.baseName'),
        text: [BZD.t('pd.cr.baseText', { v: ec(baseEC50) })],
        textposition: 'bottom right',
        marker: { size: 9, color: '#868e96' }
      },
      {
        x: [appEC50],
        y: [50],
        type: 'scatter',
        mode: 'markers+text',
        name: BZD.t('pd.cr.appName'),
        text: [BZD.t('pd.cr.appText', { v: BZD.fmt(appEC50, 1) })],
        textposition: 'top left',
        marker: { size: 9, color: modLineColor }
      }
    ] : [
      {
        x: [baseEC50],
        y: [50],
        type: 'scatter',
        mode: 'markers+text',
        name: BZD.t('pd.cr.noShiftName'),
        text: [BZD.t('pd.cr.noShiftText', { v: ec(baseEC50) })],
        textposition: 'bottom right',
        marker: { size: 9, color: isAntagonist ? '#fa5252' : '#868e96' }
      }
    ];

    const traces = [
      {
        x: gabaVals,
        y: baseResp,
        type: 'scatter',
        mode: 'lines',
        name: BZD.t('pd.cr.gabaAlone'),
        line: { color: '#868e96', width: 2.5, dash: 'dash' }
      },
      {
        x: gabaVals,
        y: modResp,
        type: 'scatter',
        mode: 'lines',
        name: modLineName,
        line: { color: modLineColor, width: 3.5 }
      },
      ...ec50Markers
    ];

    const layout = {
      xaxis: { type: 'log', title: { text: BZD.t('pd.cr.x'), standoff: 8 }, automargin: true, gridcolor: '#f1f3f5' },
      yaxis: { title: { text: BZD.t('pd.cr.y') }, range: [0, 105], gridcolor: '#f1f3f5' }, separators: BZD.plotSeparators(),
      margin: { l: 55, r: 20, t: 25, b: 115 },
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'top', y: -0.34, x: 0 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() }
    };

    Plotly.react(target, traces, layout, { responsive: true, displayModeBar: false });

    if (summary) {
      const fold = BZD.fmt(baseEC50 / appEC50, 2);
      if (isAntagonist) {
        summary.innerHTML = `
          ${BZD.t('pd.cr.sumAntagonist', { flu, occ: BZD.fmt(bzdCalc.occD * 100, 1), ec: ec(baseEC50) })}
        `;
      } else if (drug && drug.pd && drug.pd.kind === 'Inverse agonist') {
        summary.innerHTML = `
          ${BZD.t('pd.cr.sumNam', { drug: drug.name, b: BZD.fmt(drug.pd.emax, 2), ec: BZD.fmt(appEC50, 1) })}
        `;
      } else if (fluNM > 0 && bzdCalc.occF > 0.05) {
        summary.innerHTML = `
          ${BZD.t('pd.cr.sumCompetitive', { flu, occ: BZD.fmt(bzdCalc.occF * 100), drug: drug ? drug.name : BZD.t('pd.cr.thePam'), base: ec(baseEC50), cur: BZD.fmt(appEC50, 1) })}
        `;
      } else if (drug && drug.pd && drug.pd.kind === 'Partial PAM') {
        summary.innerHTML = `
          ${BZD.t('pd.cr.sumPartial', { drug: drug.name, sub: BZD.subtypes[subKey].label, b: BZD.fmt(drug.pd.emax, 1), base: ec(baseEC50), cur: BZD.fmt(appEC50, 1), fold })}
        `;
      } else if (bzdCalc.shift <= 1.02) {
        summary.innerHTML = `
          ${BZD.t('pd.cr.sumNone', { ec: ec(baseEC50) })} ${drug ? BZD.t('pd.cr.noModulation', { drug: drug.name }) : BZD.t('pd.cr.noLigandPresent')}
        `;
      } else {
        summary.innerHTML = `
          ${BZD.t('pd.cr.sumPam', { base: ec(baseEC50), cur: BZD.fmt(appEC50, 1), fold })}
        `;
      }
    }
  }

  /**
   * Plot B: BZD-site occupancy curve across α isoforms
   */
  function plotOccupancy(drugKey, curConcNM, fluNM) {
    const target = document.getElementById('pd-plot-occ');
    if (!target) return;

    const concVals = [];
    for (let logC = -2; logC <= 5; logC += 0.05) {
      concVals.push(Math.pow(10, logC));
    }

    const subKeys = ['a1', 'a2', 'a3', 'a5', 'a4'];
    const colors = { a1: '#5B8DEF', a2: '#3B6FD8', a3: '#274EA8', a5: '#183278', a4: '#868E96' };

    const traces = subKeys.map(sk => {
      const occs = concVals.map(c => {
        const res = Models.bzdSite(drugKey, sk, c, fluNM);
        return res.occD * 100;
      });
      return {
        x: concVals,
        y: occs,
        type: 'scatter',
        mode: 'lines',
        name: BZD.subtypes[sk].label + (BZD.subtypes[sk].bzdSensitive ? '' : BZD.t('pd.occ.insensitive')),
        line: { color: colors[sk], width: sk === 'a4' ? 1.5 : 2.5, dash: sk === 'a4' ? 'dot' : 'solid' }
      };
    });

    // Add vertical line at current concentration
    traces.push({
      x: [curConcNM, curConcNM],
      y: [0, 100],
      type: 'scatter',
      mode: 'lines',
      name: BZD.t('pd.occ.selected', { c: formatConc(curConcNM) }),
      line: { color: '#c92a2a', width: 2, dash: 'dash' }
    });

    const layout = {
      xaxis: { type: 'log', title: { text: BZD.t('pd.occ.x'), standoff: 8 }, automargin: true, gridcolor: '#f1f3f5' },
      yaxis: { title: { text: BZD.t('pd.occ.y') }, range: [0, 105], gridcolor: '#f1f3f5' }, separators: BZD.plotSeparators(),
      margin: { l: 55, r: 20, t: 25, b: 115 },
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'top', y: -0.34, x: 0 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() }
    };

    Plotly.react(target, traces, layout, { responsive: true, displayModeBar: false });

    const summary = document.getElementById('pd-occ-summary');
    if (!summary) return;
    const d = drugKey !== 'none' ? BZD.drugs[drugKey] : null;
    if (!d) {
      summary.innerHTML = BZD.t('pd.occ.none');
      return;
    }
    const occAt = (sk) => Models.bzdSite(drugKey, sk, curConcNM, fluNM).occD * 100;
    const ki = d.pd.ki;
    const kiTxt = ['a1', 'a2', 'a3', 'a5'].map(sk => `${BZD.subtypes[sk].label} ${ki[sk] >= BZD.INSENSITIVE ? '-' : BZD.fmt(ki[sk], ki[sk] % 1 ? (ki[sk] < 1 ? 2 : 1) : 0) + ' nM'}`).join(', ');
    summary.innerHTML = `
      ${BZD.t('pd.occ.sum', { eq: `<span class="tex" data-tex="\\theta = C\\,/\\,(C + K_i${fluNM ? '\\,(1 + C_{\\mathrm{flu}}/K_{\\mathrm{flu}})' : ''})">θ = C / (C + K<sub>i</sub>${fluNM ? '·(1 + C<sub>flu</sub>/K<sub>flu</sub>)' : ''})</span>`, ki: kiTxt, c: formatConc(curConcNM),
        a1: BZD.fmt(occAt('a1')), a2: BZD.fmt(occAt('a2')), a3: BZD.fmt(occAt('a3')), a5: BZD.fmt(occAt('a5')) })}
      ${fluNM ? BZD.t('pd.occ.flu', { flu: BZD.drugs.flumazenil.name }) : ''}`;
  }

  /**
   * Plot C: Simulated synaptic GABAergic IPSC
   */
  function plotIPSC(subKey, bzdCalc, drug) {
    const target = document.getElementById('pd-plot-ipsc');
    const summary = document.getElementById('pd-ipsc-summary');
    if (!target) return;

    const timeMs = [];
    for (let t = 0; t <= 500; t += t < 20 ? 0.25 : 2) timeMs.push(t);

    const baseIPSC = Models.ipsc(subKey, 1, timeMs);
    const modIPSC = Models.ipsc(subKey, bzdCalc.shift, timeMs);

    const traces = [
      {
        x: timeMs,
        y: baseIPSC,
        type: 'scatter',
        mode: 'lines',
        name: BZD.t('pd.ipsc.control', { tau: BZD.fmt(Models.ipscDecay(1).weighted) }),
        line: { color: '#868e96', width: 2, dash: 'dash' }
      },
      {
        x: timeMs,
        y: modIPSC,
        type: 'scatter',
        mode: 'lines',
        name: drug ? BZD.t('pd.ipsc.drug', { drug: drug.name }) : BZD.t('pd.ipsc.modulated'),
        line: { color: '#0ca678', width: 3 }
      }
    ];

    const layout = {
      xaxis: { title: { text: BZD.t('pd.ipsc.x'), standoff: 8 }, automargin: true, gridcolor: '#f1f3f5' },
      yaxis: { title: { text: BZD.t('pd.ipsc.y') }, gridcolor: '#f1f3f5' }, separators: BZD.plotSeparators(),
      margin: { l: 55, r: 20, t: 25, b: 115 },
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'top', y: -0.34, x: 0 },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() }
    };

    Plotly.react(target, traces, layout, { responsive: true, displayModeBar: false });

    if (summary) {
      // weighted decay time constant (fast and slow components) without and with the ligand
      summary.innerHTML = BZD.t('pd.ipsc.sum', { base: BZD.fmt(Models.ipscDecay(1).weighted), tau: BZD.fmt(Models.ipscDecay(bzdCalc.shift).weighted) });
    }
  }

  /**
   * Subunit binding selectivity as a radar diagram (polar pKi).
   */
  function plotSelectivity(drugKey) {
    const target = document.getElementById('pd-plot-sel');
    if (!target) return;

    const d = drugKey !== 'none' ? BZD.drugs[drugKey] : null;
    const subKeys = ['a1', 'a2', 'a3', 'a5', 'a4', 'a6'];
    const labels = ['α1 (His101)', 'α2 (His101)', 'α3 (His126)', 'α5 (His105)', 'α4 (Arg)', 'α6 (Arg)'];
    const prof = subKeys.map(sk => {
      const kiNM = d ? (d.pd.ki[sk] ?? BZD.INSENSITIVE) : BZD.INSENSITIVE;
      const bound = kiNM < BZD.INSENSITIVE;
      return { pKi: bound ? 9 - Math.log10(kiNM) : null, bound };
    });
    const FLOOR = 4.0;
    const atFloor = (v) => (v === null ? FLOOR : Math.max(FLOOR, +v.toFixed(2)));
    const close = (a) => [...a, a[0]];
    const theta = close(labels);
    const color = d?.color || '#5B8DEF';

    const pKiOf = (x, sk) => { const k = x.pd.ki[sk] ?? BZD.INSENSITIVE; return k < BZD.INSENSITIVE ? 9 - Math.log10(k) : null; };
    const traces = [
      {
        type: 'scatterpolar', r: close(subKeys.map(() => FLOOR)), theta, mode: 'lines',
        line: { color: '#adb5bd', width: 1.5, dash: 'dot' }, name: BZD.t('pd.sel.limit'), hoverinfo: 'name',
      },
      {
        type: 'scatterpolar', r: close(prof.map(p => atFloor(p.pKi))), theta, fill: 'toself',
        fillcolor: d ? `${color}26` : 'rgba(91, 141, 239, 0.15)',
        line: { color, width: 2.5 }, marker: { size: 6, color }, name: BZD.t('pd.sel.affinity'),
        text: close(prof.map(p => (p.pKi === null ? BZD.t('pd.sel.notBoundTip') : `pKᵢ ${BZD.fmt(p.pKi, 2)}`))),
        hoverinfo: 'theta+text',
      },
    ];

    Plotly.react(target, traces, {
      polar: {
        radialaxis: {
          visible: true, range: [3.5, 10], tickvals: [4, 5.5, 7, 8.5, 10],
          ticktext: ['<4.0', '5.5', '7.0', '8.5', '10'], gridcolor: '#e9ecef', linecolor: '#dee2e6',
        },
        angularaxis: { gridcolor: '#e9ecef', linecolor: '#dee2e6', direction: 'clockwise', rotation: 90 },
      },
      margin: { l: 40, r: 40, t: 20, b: 20 },
      showlegend: true, legend: { orientation: 'h', y: -0.12, x: 0 },
      plot_bgcolor: '#ffffff', paper_bgcolor: '#ffffff', font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() },
    }, { responsive: true, displayModeBar: false });


    const summary = document.getElementById('pd-sel-summary');
    if (!summary) return;
    if (!d) {
      summary.innerHTML = BZD.t('pd.sel.none');
      return;
    }
    const sens = prof.map((p, i) => ({ sk: subKeys[i], ...p })).slice(0, 4).filter(e => e.bound);
    const range = (key) => {
      const v = sens.map(e => e[key]).filter(x => x !== null);
      return v.length ? Math.max(...v) - Math.min(...v) : 0;
    };
    const affSpread = range('pKi');
    const best = sens.reduce((a, b) => (b.pKi > a.pKi ? b : a), sens[0] || { sk: 'a1', pKi: 0 });
    const fold = (x) => (x < 0.5 ? null : Math.round(Math.pow(10, x)));
    const k1 = d.pd.ki.a1;
    const ratios = ['a2', 'a3', 'a5'].map(sk => {
      const k = d.pd.ki[sk];
      if (!k1 || k1 >= BZD.INSENSITIVE) return null;
      return `${BZD.subtypes[sk].label} ${k >= BZD.INSENSITIVE ? BZD.t('pd.sel.notBound') : BZD.fmt(k / k1, k / k1 < 10 ? 1 : 0)}`;
    }).filter(Boolean).join(', ') || BZD.t('pd.sel.noA1');
    const insens = ['a4', 'a6'].filter(sk => (d.pd.ki[sk] ?? BZD.INSENSITIVE) >= BZD.INSENSITIVE).map(sk => BZD.subtypes[sk].label);

    const maxP = (x) => { const v = ['a1', 'a2', 'a3', 'a5'].map(sk => pKiOf(x, sk)).filter(y => y !== null); return v.length ? Math.max(...v) : null; };
    const ranked = Object.values(BZD.drugs).filter(x => x.pd && x.pd.ki && maxP(x) !== null).sort((a, b) => maxP(b) - maxP(a));
    const name = d.name === d.name.toUpperCase() ? d.name : d.name.toLowerCase();   // INN lower case mid-sentence; abbreviations (DMCM) unchanged
    const bindsArg = ['a4', 'a6'].filter(sk => (d.pd.ki[sk] ?? BZD.INSENSITIVE) < BZD.INSENSITIVE).map(sk => BZD.subtypes[sk].label);
    const and = BZD.t('pk.and');
    const profile = affSpread >= 1   // selective: at least tenfold difference across α1/2/3/5
      ? BZD.t('pd.sel.selective', { fold: BZD.fmt(fold(affSpread)), sub: BZD.subtypes[best.sk].label })
      : BZD.t('pd.sel.nonSelective', { spread: fold(affSpread) ? BZD.t('pd.sel.spread', { fold: BZD.fmt(fold(affSpread)) }) : '', name, rank: ranked.indexOf(d) + 1, n: ranked.length, pki: BZD.fmt(best.pKi || 0, 1) })
        + (bindsArg.length ? BZD.t('pd.sel.bindsArg', { name, subs: bindsArg.join(and) }) : '');
    summary.innerHTML = `
      ${BZD.t('pd.sel.intro', { eq: '<span class="tex" data-tex="\\mathrm{p}K_i = -\\log_{10} K_i">pK<sub>i</sub> = −log<sub>10</sub>K<sub>i</sub></span>' })}
      ${BZD.t('pd.sel.ratio', { drug: d.name, ratios })}; ${profile}.
      ${insens.length ? BZD.t(insens.length > 1 ? 'pd.sel.insensPlural' : 'pd.sel.insensSingular', { subs: insens.join(and) }) : ''}`;
  }

  /**
   * Dose-dependent effects & ceiling effect (section 7).
   * Illustrative model: dose (× usual therapeutic dose) → free concentration
   * giving ~30% α1 occupancy at 1×; effect = GABA-A response at a fixed,
   * sub-saturating endogenous GABA tone (5 µM), so a PAM can at most multiply
   * GABA's potency by its cooperativity β - the ceiling. A barbiturate-like
   * agent additionally gates the channel directly at high concentration.
   */
  /** Dose-effect plot as tall as the text beside it (two-column layout only) */
  let doseObserver = null;
  function syncDoseHeight() {
    const plot = document.getElementById('dose-plot');
    const text = document.getElementById('dose-summary');
    if (!plot || !text) return;
    const sideBySide = text.getBoundingClientRect().left > plot.getBoundingClientRect().right - 1;
    const h = sideBySide ? Math.max(380, Math.round(text.getBoundingClientRect().height)) : 420;
    if (Math.abs(plot.getBoundingClientRect().height - h) > 1) {
      plot.style.height = `${h}px`;
      if (plot.data) Plotly.Plots.resize(plot);
    }
    if (!doseObserver && window.ResizeObserver) {
      doseObserver = new ResizeObserver(() => syncDoseHeight());
      doseObserver.observe(text);
    }
  }

  function plotDoseEffect(drugKey) {
    const target = document.getElementById('dose-plot');
    const summary = document.getElementById('dose-summary');
    if (!target) return;
    const key = drugKey !== 'none' ? drugKey : 'diazepam';
    const d = BZD.drugs[key];
    // Model constants from assets/data/properties.json (BZD.model.doseResponse)
    const DR = BZD.model.doseResponse;
    const GABA = DR.gabaTone_uM, sub = DR.subunit;
    const kiA1 = d.pd.ki[sub] >= BZD.INSENSITIVE ? 1e9 : d.pd.ki[sub];
    const doses = [];
    for (let lg = -1.3; lg <= 3.001; lg += 0.02) doses.push(Math.pow(10, lg));
    const pct = (f) => +(f * 100).toFixed(2);
    const bzd = doses.map(m => pct(Models.gabaResponse(GABA, sub, Models.bzdSite(key, sub, m * DR.concAt1xDose_xKi * kiA1, 0).shift)));
    const barb = doses.map(m => {
      const BA = DR.barbiturate;
      const th = m / (m + BA.allostericHalfDose), r = Models.gabaResponse(GABA, sub, 1 + BA.allostericGain * th);
      const direct = (m * m) / (m * m + BA.directHalfDose * BA.directHalfDose);
      return pct(r + (1 - r) * direct);
    });
    // BZD + opioid: the opioid (usual dose, ~35% depression on its own via μ-opioid receptors in brainstem
    // respiratory centres) interacts supra-additively with GABAergic inhibition; its effective depression
    // rises with BZD-site occupancy (Bliss independence with a synergy term)
    const occ = doses.map(m => Models.bzdSite(key, sub, m * DR.concAt1xDose_xKi * kiA1, 0).occD);
    const combo = bzd.map((v, i) => {
      const o = Math.min(DR.opioidEffectMax, DR.opioidEffect * (1 + DR.opioidSynergy * occ[i]));
      return +(100 - (100 - v) * (1 - o)).toFixed(2);
    });
    const base = pct(Models.gabaResponse(GABA, sub, 1));
    const ceiling = bzd[bzd.length - 1];
    const i90 = bzd.findIndex(v => v >= base + 0.9 * (ceiling - base));
    const dose90 = i90 >= 0 ? doses[i90] : null;

    const zones = DR.zones.map(z => [z.from, z.to, z.label, z.color]);
    const shapes = zones.map(([y0, y1, , c]) => ({ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0, y1, fillcolor: c, line: { width: 0 }, layer: 'below' }));
    const annotations = zones.map(([y0, y1, label]) => ({ xref: 'paper', x: 0.01, y: (y0 + y1) / 2, text: label, showarrow: false, xanchor: 'left', font: BZD.plotFont({ color: '#6b7280' }) })); // size inherits layout.font, as the legend does
    annotations.push({ x: 3, y: ceiling, xref: 'x', yref: 'y', text: BZD.t('pd.dose.ceiling', { v: BZD.fmt(ceiling) }), showarrow: true, ay: -26, ax: -40, font: BZD.plotFont({ color: d.color }) });

    const traces = [
      { x: doses, y: bzd, name: d.name, mode: 'lines', line: { color: d.color || '#7048E8', width: 3 } },
      { x: doses, y: combo, name: BZD.t('pd.dose.opioid', { drug: d.name }), mode: 'lines', line: { color: '#c92a2a', width: 2, dash: 'dash' } },
      { x: doses, y: barb, name: BZD.t('pd.dose.barb'), mode: 'lines', line: { color: '#495057', width: 2, dash: 'dot' } },
    ];
    const layout = {
      xaxis: { type: 'log', title: { text: BZD.t('pd.dose.x'), standoff: 8 }, tickvals: [0.1, 1, 10, 100, 1000], ticktext: [0.1, 1, 10, 100, 1000].map(v => `${BZD.fmt(v, v < 1 ? 1 : 0)}×`), gridcolor: '#f1f3f5', automargin: true },
      yaxis: { title: { text: BZD.t('pd.dose.y') }, range: [0, 100], gridcolor: '#f1f3f5' }, separators: BZD.plotSeparators(),
      shapes, annotations,
      margin: { l: 60, r: 15, t: 15, b: 70 },
      legend: { orientation: 'h', yanchor: 'top', y: -0.13, x: 0 },
      plot_bgcolor: '#ffffff', paper_bgcolor: '#ffffff', font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() },
    };
    Plotly.react(target, traces, layout, { responsive: true, displayModeBar: false });

    if (!summary) return;
    const kind = d.pd.kind;
    const note = kind === 'Antagonist' ? BZD.t('pd.dose.noteAntagonist', { drug: d.name })
      : kind === 'Inverse agonist' ? BZD.t('pd.dose.noteNam', { drug: d.name })
        : kind === 'Partial PAM' ? BZD.t('pd.dose.notePartial', { drug: d.name, b: BZD.fmt(d.pd.emax, 1), c: BZD.fmt(ceiling) })
          : BZD.t('pd.dose.notePam', { drug: d.name, x: dose90 ? BZD.fmt(dose90, dose90 < 10 ? 1 : 0) : '-' });
    summary.innerHTML = `
      ${BZD.t('pd.dose.summary')}
      <p><b>${BZD.t('pd.dose.selected')}</b> ${note}</p>
      <p class="dose-model-note">${BZD.t('pd.dose.model', { gaba: BZD.fmt(DR.gabaTone_uM, DR.gabaTone_uM % 1 ? 1 : 0), sub: BZD.subtypes[sub].label, occ: BZD.fmt(occ[doses.findIndex(m => m >= 1)] * 100), op: BZD.fmt(DR.opioidEffect * 100), amp: BZD.fmt(1 + DR.opioidSynergy, 1) })}</p>`;

    syncDoseHeight();

    const warn = document.getElementById('dose-warn');
    if (warn) warn.innerHTML = BZD.t('pd.dose.warn');
  }

  /**
   * Render alpha subunit functional effects and calculated occupancy
   */
  function renderSubunitEffects(drugKey, cNM, fluNM, currentSubKey) {
    const grid = document.getElementById('pd-subunits-grid');
    const badge = document.getElementById('pd-occ-summary-badge');
    if (!grid) return;

    const drug = drugKey !== 'none' ? BZD.drugs[drugKey] : null;
    const subList = ['a1', 'a2', 'a3', 'a5', 'a4', 'a6'];

    if (badge) {
      badge.textContent = drug
        ? `${drug.name} @ ${formatConc(cNM)}`
        : BZD.t('pd.sub.noLigand');
      badge.style.background = drug ? (drug.color || 'var(--accent)') : '#868e96';
    }

    let html = '';
    subList.forEach(k => {
      const s = BZD.subtypes[k];
      const isSelected = k === currentSubKey;
      const kiNM = (drug && drug.pd && drug.pd.ki) ? (drug.pd.ki[k] ?? BZD.INSENSITIVE) : BZD.INSENSITIVE;
      const isSensitive = s.bzdSensitive && kiNM < BZD.INSENSITIVE;

      // Fractional occupancy:
      let occPct = 0;
      if (drug && isSensitive && cNM > 0) {
        const kiFlu = BZD.drugs.flumazenil.pd.ki[k] ?? 1.0;
        const appKi = kiNM * (1 + fluNM / kiFlu);
        occPct = (cNM / (cNM + appKi)) * 100;
      }

      let statusBadge = '';
      let barColor = '#adb5bd';

      if (!s.bzdSensitive) {
        statusBadge = `<span class="sub-effect-status" style="background:#dee2e6; color:#495057;">${BZD.t('pd.sub.insensitive')}</span>`;
      } else if (!drug || drugKey === 'none') {
        statusBadge = `<span class="sub-effect-status" style="background:#e9ecef; color:#868e96;">${BZD.t('pd.sub.zero')}</span>`;
      } else if (drug.pd.kind === 'Antagonist') {
        statusBadge = `<span class="sub-effect-status" style="background:#fa5252; color:#fff;">${BZD.t('pd.sub.blockade', { p: BZD.fmt(occPct) })}</span>`;
        barColor = '#fa5252';
      } else if (occPct >= 50) {
        statusBadge = `<span class="sub-effect-status" style="background:#2b8a3e; color:#fff;">${BZD.t('pd.sub.high', { p: BZD.fmt(occPct) })}</span>`;
        barColor = '#2b8a3e';
      } else if (occPct >= 15) {
        statusBadge = `<span class="sub-effect-status" style="background:#f59f00; color:#fff;">${BZD.t('pd.sub.moderate', { p: BZD.fmt(occPct) })}</span>`;
        barColor = '#f59f00';
      } else if (occPct > 0) {
        statusBadge = `<span class="sub-effect-status" style="background:#868e96; color:#fff;">${BZD.t('pd.sub.low', { p: BZD.fmt(occPct, 1) })}</span>`;
        barColor = '#868e96';
      } else {
        statusBadge = `<span class="sub-effect-status" style="background:#e9ecef; color:#868e96;">${BZD.t('pd.sub.none')}</span>`;
      }

      html += `
        <div class="sub-effect-card ${isSelected ? 'active-isoform' : ''} ${!s.bzdSensitive ? 'insensitive' : ''}" data-sub-key="${k}" style="cursor:pointer;" title="${BZD.t('sub.selectAll', { drug: s.label })}">
          <div class="sub-effect-header">
            <div class="sub-effect-title">
              <span class="sub-effect-badge" style="background:${s.bzdSensitive ? 'var(--alpha)' : '#868e96'};">${s.label}</span>
              <strong class="sub-effect-name">${BZD.t('rx.info.alphaTitle', { label: s.label })}</strong>
            </div>
            ${statusBadge}
          </div>

          <div class="sub-facts">
            <div><b>${BZD.t('pd.sub.residue')}</b> <code>${s.residue}</code></div>
            <div><b>${BZD.t('pd.sub.ec50')}</b> ${BZD.fmt(s.gabaEC50, s.gabaEC50 % 1 ? 1 : 0)} µM</div>
            ${drug ? `<div><b>K<sub>i</sub> (${drug.name}):</b> ${isSensitive ? BZD.fmt(kiNM, kiNM % 1 ? (kiNM < 1 ? 2 : 1) : 0) + ' nM' : BZD.t('pd.sel.notBound')}</div>` : ''}
          </div>

          <div class="sub-occ-wrapper">
            <div class="sub-occ-scale">
              <span>${BZD.t('pd.sub.target')}</span>
              <span><b>${s.bzdSensitive && drug ? BZD.fmt(occPct, 1) + '%' : (s.bzdSensitive ? '0%' : BZD.t('pd.sub.insensShort'))}</b></span>
            </div>
            <div class="sub-occ-bar-bg">
              <div class="sub-occ-bar-fill" style="width:${s.bzdSensitive ? occPct.toFixed(1) : 0}%; background-color:${barColor};"></div>
            </div>
          </div>

          <div class="sub-effects"><b>${BZD.t('pd.sub.effects')}</b> ${s.effect}.${s.clinical ? ' ' + s.clinical : ''}</div>
          <div class="sub-loc"><b>${BZD.t('rx.info.distribution')}</b> ${s.location}</div>
        </div>
      `;
    });

    // β, γ2 and δ subunits in the same card format (no BZD-site occupancy to report)
    BZD.otherSubunits.forEach(o => {
      html += `
        <div class="sub-effect-card ${o.sens === false ? 'insensitive' : ''}">
          <div class="sub-effect-header">
            <div class="sub-effect-title">
              <span class="sub-effect-badge" style="background:${o.color};">${o.label}</span>
              <strong class="sub-effect-name">${BZD.t('rx.info.alphaTitle', { label: o.label })}</strong>
            </div>
            <span class="sub-effect-status" style="background:${o.sens === false ? '#dee2e6' : o.color}; color:${o.sens === false ? '#495057' : '#fff'};">${o.status}</span>
          </div>
          <div class="sub-facts">${o.facts.map(([k, v]) => `<div><b>${k}:</b> ${v}</div>`).join('')}</div>
          <div class="sub-effects"><b>${BZD.t('pd.sub.effects')}</b> ${o.effect}. ${o.clinical}</div>
          <div class="sub-loc"><b>${BZD.t('rx.info.distribution')}</b> ${o.location}</div>
        </div>
      `;
    });

    grid.innerHTML = html;

    // Attach click listeners to cards so user can click to switch subunit
    grid.querySelectorAll('.sub-effect-card[data-sub-key]').forEach(card => {
      card.addEventListener('click', () => {
        const sk = card.getAttribute('data-sub-key');
        if (sk && window.syncSubunitSelection) {
          window.syncSubunitSelection(sk, 'effect-card');
        }
      });
    });
  }

  /** Called when the receptor (section 1) slider moves */
  function syncConc() { updateLabels(); update(); }

  return { init, update, syncConc };
})();
