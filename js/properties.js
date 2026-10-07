/* =====================================================================
 * properties.js - Searchable, filterable tables of every numeric property
 * in assets/data/properties.json (loaded through BZD.load(), as in the app).
 * ===================================================================== */
(function () {
  'use strict';

  const ROUTE_NAMES = new Proxy({}, { get: (o, k) => BZD.t(`route.${String(k)}`) });
  const PATHWAYS = new Proxy({ cyp3a4: 'CYP3A4', cyp2c19: 'CYP2C19', ugt: 'UGT' }, { get: (o, k) => o[k] || (k === 'other' ? BZD.t('pt.other') : undefined) });
  const ISOFORMS = ['a1', 'a2', 'a3', 'a5', 'a4', 'a6'];

  const esc = (v) => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /** Decimal comma in Swedish for numbers and numeric text cells */
  const loc = (s) => (BZD.lang === 'sv' ? String(s).replace(/(\d)\.(\d)/g, '$1,$2') : String(s));
  const num = (v) => (v === null || v === undefined || v === '' ? '-' : loc(v));
  /* Units belong in the column titles: cells show numbers only */
  const pctN = (v) => (v === null || v === undefined ? '-' : String(Math.round(v * 100)));
  const pathsN = (o) => (o ? Object.entries(o).map(([k, v]) => `${PATHWAYS[k] || k} ${Math.round(v * 100)}`).join(', ') : '-');
  const noUnit = (text, unit) => loc(text).replace(unit === '%' ? /(\d)\s*%/g : new RegExp(`(\\d)\\s*${unit}(?![A-Za-zµ])`, 'g'), '$1');
  // numbers in data texts may use a decimal point (English) or comma (Swedish); output follows the interface language
  const N = '(\\d+(?:[.,]\\d+)?)', num2 = (s) => parseFloat(String(s).replace(',', '.'));
  const trim = (x, d) => BZD.fmt(+x.toFixed(d), (+x.toFixed(d)) % 1 ? Math.min(d, String(+x.toFixed(d)).split('.')[1].length) : 0);
  const toH = (m) => trim(num2(m) / 60, 2);
  const hours = (text) => noUnit(String(text).replace(new RegExp(`${N}(?:\\s*-\\s*${N})?\\s*min\\b`, 'g'), (x, a, b) => (b ? `${toH(a)}-${toH(b)}` : toH(a))), 'h');
  const toMin = (h) => trim(num2(h) * 60, 0);
  const minutes = (text) => noUnit(String(text).replace(new RegExp(`${N}(?:\\s*-\\s*${N})?\\s*h\\b`, 'g'), (x, a, b) => (b ? `${toMin(a)}-${toMin(b)}` : toMin(a))), 'min');
  const headCell = (h) => (Array.isArray(h) ? `${h[0]}<br><span class="props-unit">(${h[1]})</span>` : h);

  const STATUS = new Proxy({}, { get: (o, k) => [BZD.t(`status.${k}`), BZD.t(`status.${k}.tip`)] });
  const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const show = (v) => (v === null || v === undefined ? '-' : Array.isArray(v) ? v.join('-') : typeof v === 'object'
    ? Object.entries(v).map(([k, x]) => `${k} ${x === null ? BZD.t('pd.sel.notBound') : x}`).join(', ') : String(v));
  const cite = (r) => `${esc(r.authors)}${r.authors.endsWith('.') ? '' : '.'} ${esc(r.title)}. <i>${esc(r.journal)}</i> ${r.year}${r.volume ? `;${esc(r.volume)}` : ''}${r.pages ? `:${esc(r.pages)}` : ''}.`;
  const refLinks = (r) => [r.pmid && `<a href="https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/" target="_blank" rel="noopener">PubMed ${r.pmid}</a>`,
    r.doi && `<a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener">DOI</a>`,
    r.url && r.url !== `https://doi.org/${r.doi}` && `<a href="${esc(r.url)}" target="_blank" rel="noopener">${urlLabel(r.url)}</a>`].filter(Boolean).join(' · ');
  /** Link text by site (DailyMed label, FASS product information, other web page) */
  const urlLabel = (u) => (/dailymed\./.test(u) ? 'DailyMed' : /fass\.se/.test(u) ? 'FASS' : BZD.t('pt.web'));

  /* Pharmacokinetic model validation: single doses simulated as in the published studies (70 kg adult) */
  const mid = (v, geo) => (Array.isArray(v) ? (geo ? Math.sqrt(v[0] * v[1]) : (v[0] + v[1]) / 2) : v);
  const fmt = (x) => BZD.fmt(x, x >= 10 ? 0 : x >= 1 ? 1 : 2);
  function validationRows(B) {
    return (B.validation || []).map(v => {
      // base (US) parameters: calibration and validation refer to them, whatever region is selected
      const sim = window.Models.simulate({ drug: B.baseDrugs[v.drug], dose: v.dose, route: v.route, n: 1, tau: 24, weight: 70, mods: [], tEnd: 24 });
      let i = 0; sim.cp.forEach((c, k) => { if (c > sim.cp[i]) i = k; });
      const mw = B.baseDrugs[v.drug].mw, cc = (x) => (Array.isArray(x) ? x.map(y => BZD.conc(y, mw)) : x === undefined ? x : BZD.conc(x, mw));   // region unit
      return { ...v, cmax: cc(v.cmax), predCmax: BZD.conc(sim.cp[i], mw), predTmax: sim.t[i], obsCmax: v.cmax === undefined ? null : mid(cc(v.cmax), true), obsTmax: v.tmax === undefined ? null : mid(v.tmax, false) };
    });
  }
  const inBand = (pred, obs, upper) => (upper ? pred <= obs * 2 : pred / obs >= 0.5 && pred / obs <= 2);
  const ratioCell = (pred, obs, upper) => {
    if (obs === null) return '-';
    const r = pred / obs, ok = inBand(pred, obs, upper);
    if (upper) return `<span class="props-status props-status-${ok ? 'consistent' : 'differs'}" title="${BZD.t('pt.v.upperTip')}">${pred <= obs ? BZD.t('pt.v.withinBound') : BZD.fmt(r, 2)}</span>`;
    return `<span class="props-status props-status-${ok ? 'consistent' : 'differs'}" title="${BZD.t(ok ? 'pt.v.within' : 'pt.v.outside')}">${BZD.fmt(r, 2)}</span>`;
  };
  const sig = (x) => { if (typeof x !== 'number') return String(x); const n = +x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2); return BZD.fmt(n, (String(n).split('.')[1] || '').length); };
  const obsText = (v) => (v === undefined ? '-' : Array.isArray(v) ? `${sig(v[0])}-${sig(v[1])}` : sig(v));
  function drawValidation(B, rows) {
    const el = document.getElementById('val-plot');
    if (!el || !window.Plotly) return;
    const traces = [], lines = [], seen = new Set();
    const panel = (key, axis, unit, lo, hi) => {
      const pts = rows.filter(r => r.set === 'validation' && r['obs' + key] !== null && !(key === 'Tmax' && r.tmaxUpper));
      [1, 0.5, 2].forEach(f => lines.push({ x: [lo, hi], y: [lo * f, hi * f], xaxis: axis.x, yaxis: axis.y, mode: 'lines', hoverinfo: 'skip', showlegend: false,
        line: { color: f === 1 ? '#868e96' : '#ced4da', width: 1, dash: f === 1 ? 'solid' : 'dash' } }));
      pts.forEach(r => {
        const first = !seen.has(r.drug); seen.add(r.drug);
        const range = Array.isArray(r[key.toLowerCase()]) ? r[key.toLowerCase()] : null;
        traces.push({ x: [r['obs' + key]], y: [r['pred' + key]], xaxis: axis.x, yaxis: axis.y, mode: 'markers', name: B.drugs[r.drug].name, legendgroup: r.drug, showlegend: first,
          marker: { size: 9, color: B.drugs[r.drug].color, line: { color: '#fff', width: 1 } },
          error_x: range ? { type: 'data', symmetric: false, array: [range[1] - r['obs' + key]], arrayminus: [r['obs' + key] - range[0]], color: B.drugs[r.drug].color, thickness: 1 } : undefined,
          hovertemplate: `${B.drugs[r.drug].name} ${r.dose} mg ${ROUTE_NAMES[r.route] || r.route}<br>${BZD.t('pt.v.observed')} %{x:.3g} ${unit}<br>${BZD.t('pt.v.predicted')} %{y:.3g} ${unit}<extra></extra>` });
      });
    };
    const cu = BZD.concUnit();
    panel('Cmax', { x: 'x', y: 'y' }, cu, 0.5, 1000);
    panel('Tmax', { x: 'x2', y: 'y2' }, 'h', 0.1, 10);
    const ax = (title, domain, range, ticks) => ({ title: { text: title }, type: 'log', domain, range, tickvals: ticks, ticktext: ticks.map(x => BZD.fmt(x, x < 1 ? 1 : 0)), gridcolor: '#f1f3f5', zeroline: false });
    const CT = [1, 10, 100, 1000], TT = [0.1, 0.2, 0.5, 1, 2, 5, 10];
    Plotly.newPlot(el, [...lines, ...traces], {
      height: 420, margin: { l: 60, r: 20, t: 36, b: 52 }, font: BZD.plotFont(), hoverlabel: { font: BZD.plotFont() }, separators: BZD.plotSeparators(),
      paper_bgcolor: '#fff', plot_bgcolor: '#fff', hovermode: 'closest',
      xaxis: ax(BZD.t('pt.v.obsCmax', { unit: cu }), [0, 0.44], [Math.log10(0.5), 3], CT), yaxis: ax(BZD.t('pt.v.predCmax', { unit: cu }), [0, 1], [Math.log10(0.5), 3], CT),
      xaxis2: ax(BZD.t('pt.v.obsTmax'), [0.56, 1], [-1, 1], TT), yaxis2: { ...ax(BZD.t('pt.v.predTmax'), [0, 1], [-1, 1], TT), anchor: 'x2' },
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
      annotations: [{ text: BZD.t('pt.v.peak'), x: 0.22, xref: 'paper', y: 1.08, yref: 'paper', showarrow: false, font: BZD.plotFont() },
        { text: BZD.t('pt.v.timeToPeak'), x: 0.78, xref: 'paper', y: 1.08, yref: 'paper', showarrow: false, font: BZD.plotFont() }],
    }, { displayModeBar: false, responsive: true });
  }

  /* Table definitions: id, title, JSON path, column headers, row builder ([drugKey, cells]) */
  function tables(B, P) {
    const drugs = Object.entries(B.drugs);
    const valRows = validationRows(B);
    return [
      {
        id: 'binding', title: BZD.t('pt.binding.title'), source: 'drugs.*.mw, smiles, pd',
        head: [BZD.t('pt.h.drug'), BZD.t('pt.h.class'), ['MW', 'g/mol'], BZD.t('pt.h.mechanism'), 'β', ...ISOFORMS.map(s => [`Kᵢ ${B.subtypes[s].label}`, 'nM']), 'SMILES'],
        abbr: BZD.t('pt.binding.abbr'),
        rows: drugs.map(([k, d]) => [k, [d.name, d.role, num(d.mw), BZD.t('kind.' + d.pd.kind), num(d.pd.emax),
          ...ISOFORMS.map(s => (d.pd.ki[s] >= B.INSENSITIVE ? BZD.t('pd.sel.notBound') : num(d.pd.ki[s]))), `<code>${esc(d.smiles || '-')}</code>`]]),
      },
      {
        id: 'pk', title: BZD.t('pt.pk.title'), source: 'drugs.*.pk',
        head: [BZD.t('pt.h.drug'), ['F', '%'], ['kₐ', '1/h'], ['t½', 'h'], [BZD.t('pt.h.vd'), 'L/kg'], [BZD.t('pt.h.fu'), '%'], [BZD.t('pt.h.dose'), 'mg'], ['τ', 'h'], [BZD.t('pt.h.ref_range'), BZD.concUnit()], [BZD.t('pt.h.clearance_pathways'), BZD.t('pt.h.of_clearance')]],
        abbr: BZD.t('pt.pk.abbr'),
        rows: drugs.filter(([, d]) => d.pk).map(([k, d]) => [k, [d.name, pctN(d.pk.F), num(d.pk.ka), num(d.pk.t12), num(d.pk.vd), pctN(d.pk.fu),
          num(d.pk.dose), num(d.pk.tau), d.pk.ref ? d.pk.ref.map(x => sig(BZD.conc(x, d.mw))).join('-') : '-', pathsN(d.pk.pathways)]]),
      },
      {
        id: 'routes', title: BZD.t('pt.routes.title'), source: 'drugs.*.pk (F, ka, im, rt), drugs.*.routeClinical',
        head: [BZD.t('pt.h.drug'), BZD.t('pt.h.route'), ['F', '%'], ['kₐ', '1/h'], [BZD.t('pt.h.onset'), BZD.t('pt.h.min')], [BZD.t('pt.h.tmax'), BZD.t('pt.h.min')], [BZD.t('pt.h.tmax'), 'h']],
        abbr: BZD.t('pt.routes.abbr'),
        rows: drugs.filter(([, d]) => d.pk).flatMap(([k, d]) => (d.routes || ['oral']).map(r => {
          const abs = r === 'oral' ? { F: d.pk.F, ka: d.pk.ka } : (r === 'im' ? d.pk.im : (d.pk.rt || {})[r]) || (r === 'iv' ? { F: 1 } : {});
          const clin = (B.drugRoutes[k] || {})[r] || {};
          return [k, [d.name, ROUTE_NAMES[r] || r, pctN(abs.F), num(abs.ka), noUnit(clin.onset || '-', 'min'), minutes(clin.tmax || '-'), hours(clin.tmax || '-')]];
        })),
      },
      {
        id: 'metabolites', title: BZD.t('pt.metabolites.title'), source: 'drugs.*.pk.metabolites',
        head: [BZD.t('pt.h.parent_drug'), BZD.t('pt.h.metabolite'), [BZD.t('pt.h.fm'), '%'], ['t½', 'h'], [BZD.t('pt.h.vd'), 'L/kg'], [BZD.t('pt.h.clearance_pathways'), BZD.t('pt.h.of_clearance')]],
        abbr: BZD.t('pt.metabolites.abbr'),
        rows: drugs.filter(([, d]) => d.pk && d.pk.metabolites).flatMap(([k, d]) => d.pk.metabolites.map(m => [k, [d.name, m.name,
          m.fm !== undefined ? pctN(m.fm) : BZD.t('pt.fmBoth', { a: pctN(m.fmFromNord), b: pctN(m.fmFromTem) }), num(m.t12), num(m.vd), pathsN(m.pathways)]])),
      },
      {
        id: 'subunits', title: BZD.t('pt.subunits.title'), source: 'subunits.*',
        head: [BZD.t('pt.h.subunit'), [BZD.t('pt.h.gaba_ec'), 'µM'], BZD.t('pt.h.bzd_sensitivity'), BZD.t('pt.h.determinant_residue')],
        rows: Object.values(B.subtypes).map(s => [null, [s.label, num(s.gabaEC50), BZD.t(s.bzdSensitive ? 'pt.sensitive' : 'pd.sub.insensShort'), s.residue]]),
      },
      {
        id: 'routetypes', title: BZD.t('pt.routetypes.title'), source: 'routes.*',
        head: [BZD.t('pt.h.route'), [BZD.t('pt.h.onset'), BZD.t('pt.h.min')], [BZD.t('pt.h.typical_onset'), BZD.t('pt.h.min')], [BZD.t('pt.h.tmax'), BZD.t('pt.h.min')], [BZD.t('pt.h.tmax'), 'h'], ['F', '%']],
        abbr: BZD.t('pt.routetypes.abbr'),
        rows: B.routes.map(r => [null, [r.name, noUnit(r.onset, 'min'), num(r.onsetMin), minutes(r.tmax), hours(r.tmax), noUnit(r.bioavailability, '%')]]),
      },
      {
        id: 'modifiers', title: BZD.t('pt.modifiers.title'), source: 'modifiers.*',
        head: [BZD.t('pt.h.factor'), BZD.t('pt.h.cl_multipliers'), BZD.t('pt.h.vd_multiplier'), BZD.t('pt.h.description')],
        abbr: BZD.t('pt.modifiers.abbr'),
        rows: Object.values(B.modifiers).map(m => [null, [m.label, Object.entries(m.m).map(([k, v]) => `${PATHWAYS[k] || k} ×${v}`).join(', '), m.vLipo ? `×${m.vLipo}` : '-', m.desc]]),
      },
      {
        id: 'regions', title: BZD.t('pt.regions.title'), source: 'regions',
        head: [BZD.t('pt.h.brain_region'), BZD.t('pt.h.isoform'), BZD.t('pt.h.abundance'), [BZD.t('pt.h.level'), '0-3'], BZD.t('pt.h.cell_populations')],
        rows: Object.entries(B.regions.abundance).flatMap(([iso, regs]) => Object.entries(regs).map(([r, v]) =>
          [null, [B.regions.names[r], B.subtypes[iso].label, B.regions.levels[v.level], String(v.level), v.note || '-']])),
      },
      {
        id: 'model', title: BZD.t('pt.model.title'), source: 'model',
        head: [BZD.t('pt.h.parameter'), BZD.t('pt.h.value'), BZD.t('pt.h.unit'), BZD.t('pt.h.description')],
        rows: (() => {
          const M = B.model, DR = M.doseResponse, SC = M.singleChannel, rows = [];
          // numbers in the interface language (decimal comma in Swedish), with the decimals of the data value
          const num = (v) => (typeof v === 'number' ? BZD.fmt(v, v % 1 ? Math.min(3, String(v).split('.')[1]?.length || 0) : 0).replace('-', '−') : String(v));
          const add = (name, value, unit, desc) => rows.push([null, [name, num(value), unit || '-', desc]]);
          const T = (k, v) => BZD.t(`pt.m.${k}`, v);
          add(T('hill'), M.hill, '', T('hillD'));
          add(T('gamma'), SC.conductance_pS, 'pS', T('gammaD', { sym: SC.symmetricCl_mM }));
          add(T('clOut'), SC.clOut_mM, 'mM', T('neuronD'));
          add(T('clIn'), SC.clIn_mM, 'mM', T('neuronD'));
          add(T('clInImm'), SC.clInImmature_mM, 'mM', T('neuronImmD'));
          add(T('vm'), SC.vm_mV, 'mV', T('neuronD'));
          add(T('vmMin'), SC.vmMin_mV, 'mV', T('vmRangeD'));
          add(T('vmMax'), SC.vmMax_mV, 'mV', T('vmRangeD'));
          add(T('hco3Out'), SC.hco3Out_mM, 'mM', T('hco3D'));
          add(T('hco3In'), SC.hco3In_mM, 'mM', T('hco3D'));
          add(T('pHCO3'), SC.pHCO3_pCl, '', T('pHCO3D'));
          add(T('temp'), SC.temperature_C, '°C', T('tempD'));
          // kinetic (Markov) scheme and simulated IPSC
          const KC = M.kinetics, IP = M.ipsc;
          add(T('kinTemp'), `${KC.temperatureLow_C}-${KC.temperatureHigh_C}`, '°C', T('kinD'));
          Object.entries(KC.rates).forEach(([k, v]) => add(T('kinRate', { k }), v, k === 'kon' ? 'M⁻¹ s⁻¹' : 's⁻¹', T('kinD')));
          add(T('ipscAmp'), IP.amplitude_pA, 'pA', T('ipscD'));
          add(T('ipscGaba'), IP.peakGaba_uM, 'µM', T('ipscD'));
          add(T('ipscRise'), IP.tauRise_ms, 'ms', T('ipscD'));
          add(T('ipscFast'), IP.tauFast_ms, 'ms', T('ipscD'));
          add(T('ipscSlow'), IP.tauSlow_ms, 'ms', T('ipscD'));
          add(T('ipscFrac'), pctN(IP.fastFraction), '%', T('ipscD'));
          add(T('ipscExp'), IP.decayShiftExponent, '', T('ipscD'));
          Object.entries(M.routeDefaults).forEach(([r, v]) => {
            add(T('defF', { route: ROUTE_NAMES[r] || r }), pctN(v.F), '%', T('defD'));
            add(T('defKa', { route: ROUTE_NAMES[r] || r }), v.ka, '1/h', T('defD'));
          });
          add(T('gaba'), DR.gabaTone_uM, 'µM', T('gabaD', { sub: B.subtypes[DR.subunit].label }));
          add(T('conc1x'), DR.concAt1xDose_xKi, '× Kᵢ', T('doseFig'));
          add(T('opioid'), pctN(DR.opioidEffect), '%', T('opioidD'));
          add(T('synergy'), DR.opioidSynergy, '', T('synergyD'));
          add(T('opioidMax'), pctN(DR.opioidEffectMax), '%', T('opioidMaxD'));
          add(T('barbHalf'), DR.barbiturate.allostericHalfDose, T('xDose'), T('doseFig'));
          add(T('barbGain'), DR.barbiturate.allostericGain, '', T('doseFig'));
          add(T('barbDirect'), DR.barbiturate.directHalfDose, T('xDose'), T('doseFig'));
          DR.zones.forEach(z => add(T('band', { label: z.label }), `${z.from}-${z.to}`, T('ofMax'), T('cnsInhib')));
          M.durationComparison.forEach(c => add(T('duration', { drug: B.drugs[c.key].name }), c.dose, T('mgOral'), c.label));
          return rows;
        })(),
      },
      {
        id: 'clinical', title: BZD.t('pt.clinical.title'), source: 'substances',
        head: [BZD.t('pt.h.substance'), BZD.t('pt.h.category'), ['t½', 'h'], [BZD.t('pt.h.t_used'), 'h'], BZD.t('pt.h.metabolites'), ['F', '%'], BZD.t('pt.h.clearance'), [BZD.t('pt.h.equivalent_dose'), 'mg'], BZD.t('pt.h.indications')],
        abbr: BZD.t('pt.clinical.abbr'),
        note: BZD.t('pt.clinical.note'),
        rows: P.substances.map(s => [s.key || s.name.toLowerCase(), [s.name, s.category, noUnit(s.tHalf, 'h'), num(s.tHalfNum), s.metabolites,
          noUnit(s.bioavailability, '%'), s.clearance, noUnit(s.equivDose, 'mg'), s.indications]]),
      },
      {
        id: 'sources', title: BZD.t('pt.sources.title'), source: 'sources',
        head: [[BZD.t('pt.h.value'), BZD.t('pt.h.path_in_properties_json')], BZD.t('pt.h.value_used'), BZD.t('pt.h.reported_in_source'), BZD.t('pt.h.status'), BZD.t('pt.h.references'), BZD.t('pt.h.note')],
        abbr: BZD.t('pt.sources.abbr'),
        rows: Object.entries(P.sources).map(([path, s]) => {
          const [label, tip] = STATUS[s.status] || [s.status, ''];
          const drug = path.startsWith('drugs.') ? path.split('.')[1] : null;
          return [drug, [`<code class="props-path">${esc(path).replace(/\./g, '.<wbr>')}</code>`, esc(show(getPath(BZD.raw, path))), esc(s.reported),
            `<span class="props-status props-status-${s.status.replace(' ', '-')}" title="${tip}">${label}</span>`,
            s.refs.map(id => { const r = P.references[id]; return `<a href="#ref-${id}">${esc(r.setid ? BZD.t('pt.fdaLabel', { p: r.title.split(':')[0] }) : r.url && /fass/.test(r.url) ? BZD.t('pt.fass', { p: r.title.split(' (')[0] }) : r.authors.split(',')[0])} ${r.year}</a>`; }).join('; '), esc(s.note || '-')]];
        }),
      },
      {
        id: 'validation', title: BZD.t('pt.validation.title'), source: 'validation (observed); js/models.js (predicted)',
        intro: (() => {
          const v = valRows.filter(r => r.set === 'validation'), within = (k) => v.filter(r => r['obs' + k] !== null && inBand(r['pred' + k], r['obs' + k], k === 'Tmax' && r.tmaxUpper)).length;
          const n = (k) => v.filter(r => r['obs' + k] !== null).length;
          return BZD.t('pt.v.intro', { c: within('Cmax'), cn: n('Cmax'), t: within('Tmax'), tn: n('Tmax') });
        })(),
        after: '<div id="val-plot" class="val-plot"></div>',
        draw: () => drawValidation(B, valRows),
        head: [BZD.t('pt.h.set'), BZD.t('pt.h.drug'), BZD.t('pt.h.route'), [BZD.t('pt.h.dose'), 'mg'], [BZD.t('pt.h.cmax_obs'), BZD.concUnit()], [BZD.t('pt.h.cmax_pred'), BZD.concUnit()], [BZD.t('pt.h.ratio'), 'pred/obs'], [BZD.t('pt.h.tmax_obs'), 'h'], [BZD.t('pt.h.tmax_pred'), 'h'], [BZD.t('pt.h.ratio'), 'pred/obs'], BZD.t('pt.h.references'), BZD.t('pt.h.note')],
        abbr: BZD.t('pt.validation.abbr'),
        rows: valRows.map(r => [r.drug, [BZD.t(r.set === 'validation' ? 'pt.v.validation' : 'pt.v.calibration'), B.drugs[r.drug].name, ROUTE_NAMES[r.route] || r.route, num(r.dose), obsText(r.cmax), fmt(r.predCmax), ratioCell(r.predCmax, r.obsCmax),
          `${r.tmaxUpper ? '≤ ' : ''}${obsText(r.tmax)}`, fmt(r.predTmax), ratioCell(r.predTmax, r.obsTmax, r.tmaxUpper),
          r.refs.map(id => { const x = P.references[id]; return `<a href="#ref-${id}">${esc(x.setid ? BZD.t('pt.fdaLabel', { p: x.title.split(':')[0] }) : x.authors.split(',')[0])} ${x.year}</a>`; }).join('; '), esc(r.note || '-')]]),
      },
      {
        id: 'references', title: BZD.t('pt.references.title'), source: 'references',
        head: [BZD.t('pt.h.reference'), BZD.t('pt.h.links')],
        rows: Object.entries(P.references).sort(([, a], [, b]) => a.authors.localeCompare(b.authors) || a.year - b.year)
          .map(([id, r]) => [null, [`<span id="ref-${id}">${cite(r)}</span>`, refLinks(r)]]),
      },
    ];
  }

  let model = [];
  const state = { q: '', drug: '', shown: new Set() };

  function render() {
    const q = state.q.trim().toLowerCase();
    let visible = 0;
    const html = model.filter(t => state.shown.has(t.id)).map(t => {
      const rows = t.rows.filter(([key, cells]) => (!state.drug || key === state.drug)
        && (!q || cells.join(' ').replace(/<[^>]+>/g, '').toLowerCase().includes(q)));
      visible += rows.length;
      if (!rows.length) return '';
      return `
        <section class="card props-card" id="t-${t.id}">
          <h3>${t.title} <span class="props-count">${rows.length}</span></h3>
          <p class="muted props-source">${BZD.t('pt.source')} <code>${esc(t.source)}</code></p>${t.intro ? `<p class="props-intro">${t.intro}</p>` : ''}${t.after || ''}
          <div class="table-responsive">
            <table class="props-table">
              <thead><tr>${t.head.map(h => `<th>${headCell(h)}</th>`).join('')}</tr></thead>
              <tbody>${rows.map(([, cells]) => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>${t.abbr || t.note ? `<p class="props-abbr">${t.abbr ? `<b>${BZD.t('sub.abbr')}</b> ${t.abbr}.` : ''}${t.note ? ` ${t.note}.` : ''}</p>` : ''}
        </section>`;
    }).join('');
    document.getElementById('props-content').innerHTML = html;
    model.forEach(t => { if (t.draw && document.getElementById(`t-${t.id}`)) t.draw(); });
    document.getElementById('props-empty').hidden = visible > 0;
  }

  function init(P) {
    const B = window.BZD;
    model = tables(B, P);
    model.forEach(t => state.shown.add(t.id));

    const pills = document.getElementById('props-tables');
    pills.innerHTML = `<button type="button" class="pill active" data-t="all">${BZD.t('pt.all')}</button>` +
      model.map(t => `<button type="button" class="pill" data-t="${t.id}">${t.title.split(' (')[0]}</button>`).join('');
    pills.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      const id = b.getAttribute('data-t');
      state.shown = new Set(id === 'all' ? model.map(t => t.id) : [id]);
      pills.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      render();
    });

    const sel = document.getElementById('props-drug');
    Object.entries(B.drugs).forEach(([k, d]) => sel.insertAdjacentHTML('beforeend', `<option value="${k}">${esc(d.name)}</option>`));
    sel.addEventListener('change', () => { state.drug = sel.value; render(); });

    const search = document.getElementById('props-search');
    search.addEventListener('input', () => { state.q = search.value; render(); });

    // Links from a value to its reference: jump at once (smooth scrolling across the long page took
    // seconds), show the references table if it is filtered out, and highlight the row briefly
    document.getElementById('props-content').addEventListener('click', ev => {
      const a = ev.target.closest('a[href^="#ref-"]'); if (!a) return;
      ev.preventDefault();
      const id = a.getAttribute('href').slice(1);
      if (!document.getElementById(id)) {
        state.shown.add('references'); state.q = ''; state.drug = '';
        search.value = ''; sel.value = '';
        pills.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.getAttribute('data-t') === 'all' && state.shown.size === model.length));
        render();
      }
      const t = document.getElementById(id); if (!t) return;
      const row = t.closest('tr') || t;
      row.scrollIntoView({ behavior: 'instant', block: 'center' });
      history.replaceState(null, '', `#${id}`);
      row.classList.remove('ref-flash'); void row.offsetWidth; row.classList.add('ref-flash');
    });

    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    BZD.load().then((P) => { BZD.translatePage(); BZD.initSettings(); init(P); }).catch(err => {
      document.getElementById('props-content').innerHTML = `<div class="card data-error"><b>${BZD.t('pt.loadError')}</b> ${esc(err.message)}</div>`;
    });
  });
})();
