/* =====================================================================
 * models.js - Pharmacodynamic (allosteric) and pharmacokinetic models.
 * ===================================================================== */
window.Models = (function () {
  'use strict';
  const BZD = window.BZD;
  const LN2 = Math.LN2;
  /* Model parameters from assets/data/properties.json (BZD.model): Hill coefficient, maximal open
   * probability, single-channel Cl⁻ permeation (GHK), and default route absorption. */
  const M = () => BZD.model;
  /* Anion permeation through one open channel (Goldman-Hodgkin-Katz equations, z = −1).
   * The Cl⁻ permeability follows from γ measured in symmetrical Cl⁻, where GHK is linear:
   * γ = P·F²·c/(RT); HCO3⁻ permeates with P_HCO3 = (P_HCO3/P_Cl)·P_Cl. In the physiological
   * gradient (low intracellular Cl⁻) the current rectifies outwardly, so near E_Cl the channel
   * conducts far less than γ(Vm − E_Cl). Unidirectional fluxes give the Cl⁻ ions moving each way
   * (equal at E_Cl, so net flux is zero there while ions still cross in both directions).
   * cond: { vm_mV, clIn_mM } overrides the defaults (membrane potential, intracellular Cl⁻).
   * BZDs change opening frequency, not permeability or mean open time. */
  const F = 96485.33, R = 8.314462, E_CHARGE = 1.602177e-19;
  const ghk = (cond = {}) => {
    const c = M().singleChannel, RT_F = R * (c.temperature_C + 273.15) / F;   // V
    const vm_mV = cond.vm_mV ?? c.vm_mV, clIn_mM = cond.clIn_mM ?? c.clIn_mM;
    const w = -(vm_mV / 1000) / RT_F;                                            // zFV/RT, z = −1
    const g = c.conductance_pS * 1e-12 / c.symmetricCl_mM;                      // P·F²/RT, S per mM
    const s = Math.abs(w) < 1e-9 ? 1 : w / (1 - Math.exp(-w));                  // GHK factor (→ 1 at 0 mV)
    // unidirectional anion currents (A): efflux of anions = inward current, influx = outward current
    const uni = (cIn, cOut, rel) => ({ eff: rel * g * RT_F * cIn * s, inf: rel * g * RT_F * cOut * s * Math.exp(-w) });
    const cl = uni(clIn_mM, c.clOut_mM, 1), hco3 = uni(c.hco3In_mM, c.hco3Out_mM, c.pHCO3_pCl);
    const iCl = cl.inf - cl.eff, iHCO3 = hco3.inf - hco3.eff;                   // A, outward +
    const nernst = (cIn, cOut) => RT_F * Math.log(cIn / cOut) * 1000;           // mV, anion
    const p = c.pHCO3_pCl;
    return {
      vm_mV, clIn_mM,
      eCl_mV: nernst(clIn_mM, c.clOut_mM),
      eHCO3_mV: nernst(c.hco3In_mM, c.hco3Out_mM),
      eGABA_mV: nernst(clIn_mM + p * c.hco3In_mM, c.clOut_mM + p * c.hco3Out_mM),   // GHK voltage equation
      i_pA: (iCl + iHCO3) * 1e12, iCl_pA: iCl * 1e12, iHCO3_pA: iHCO3 * 1e12,
      ionsPerS: iCl / E_CHARGE,                                                   // net Cl⁻ influx (+) or efflux (−)
      clInPerS: cl.inf / E_CHARGE, clOutPerS: cl.eff / E_CHARGE,                  // unidirectional Cl⁻ fluxes
    };
  };

  /* ---------------- Receptor kinetics (Markov scheme) ----------------
   * α1β3γ2L scheme of Haas & Macdonald (1999, Fig. 7; rates as corrected in the 2004 erratum),
   * rates in BZD.model.kinetics (s⁻¹; kon in M⁻¹ s⁻¹). Two GABA binding steps lead to closed
   * doubly bound states C3 and C4; O1-O3 open from C2, C3 and C4; Df, Di and Ds are desensitised;
   * each open state has two brief distal closed states (C5-C10), which produce bursts.
   * BZD-site ligands multiply the GABA association rate (both binding steps) by the EC50 shift of
   * the allosteric model, so the apparent EC50 shifts by the same factor while open and burst
   * durations stay unchanged (Rogers et al. 1994; Lavoie & Twyman 1996). */
  const KIN_STATES = ['C1', 'C2', 'C3', 'C4', 'O1', 'O2', 'O3', 'Df', 'Di', 'Ds', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'];
  const KIN_OPEN = [4, 5, 6], KIN_DES = [7, 8, 9];
  const KIN_BURST = [4, 5, 6, 10, 11, 12, 13, 14, 15];   // open states and their brief intraburst closures (C5-C10)
  /** Transitions out of each state: out[i] = [[j, rate s⁻¹], …] for GABA (µM) and association factor */
  function kineticRates(gabaUM, factor = 1) {
    const r = M().kinetics.rates, kc = r.kon * factor * Math.max(0, gabaUM) * 1e-6;
    const out = KIN_STATES.map(() => []);
    const add = (a, b, k) => { if (k > 0) out[a].push([b, k]); };
    add(0, 1, 2 * kc); add(1, 0, r.koff);
    add(1, 2, kc); add(2, 1, 2 * r.koff);
    add(2, 3, r.k34); add(3, 2, r.k43);
    add(1, 4, r.beta1); add(4, 1, r.alpha1);
    add(2, 5, r.beta2); add(5, 2, r.alpha2);
    add(3, 6, r.beta3); add(6, 3, r.alpha3);
    add(2, 7, r.df); add(7, 2, r.rf);
    add(3, 8, r.di); add(8, 3, r.ri);
    add(8, 9, r.ds); add(9, 8, r.rs);
    [[4, 10, 11, r.a12c, r.a12o, r.b12c, r.b12o], [5, 12, 13, r.a12c, r.a12o, r.b12c, r.b12o], [6, 14, 15, r.a3c, r.a3o, r.b3c, r.b3o]]
      .forEach(([o, ca, cb, ac, ao, bc, bo]) => { add(o, ca, ac); add(ca, o, ao); add(o, cb, bc); add(cb, o, bo); });
    return out;
  }

  /** Stochastic trajectory (Gillespie): state after dt seconds of real time */
  function kineticStep(state, dt, gabaUM, factor = 1) {
    const out = kineticRates(gabaUM, factor);
    let t = 0;
    for (let guard = 0; guard < 2000; guard++) {
      const tr = out[state], total = tr.reduce((a, [, k]) => a + k, 0);
      if (total <= 0) break;
      t += -Math.log(1 - Math.random()) / total;
      if (t > dt) break;                                    // memoryless: the remaining dwell restarts next call
      let u = Math.random() * total;
      for (const [j, k] of tr) { u -= k; if (u <= 0) { state = j; break; } }
    }
    return state;
  }

  /** Steady-state occupancies (πQ = 0, Σπ = 1) by Gaussian elimination */
  function kineticSteady(gabaUM, factor = 1) {
    const n = KIN_STATES.length, out = kineticRates(gabaUM, factor);
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));   // rows: balance of state i
    out.forEach((tr, i) => tr.forEach(([j, k]) => { A[i][i] -= k; A[j][i] += k; }));
    A[n - 1] = new Array(n).fill(1).concat(1);                               // replace one equation by Σπ = 1
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < n; r++) if (r !== c && A[r][c]) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
    }
    return A.map((row, i) => Math.max(0, row[n] / row[i]));
  }

  /** Generator matrix Q (rows: from, columns: to; diagonal = −total exit rate) */
  function kineticQ(gabaUM, factor) {
    const Q = new Float64Array(N_KIN * N_KIN);
    kineticRates(gabaUM, factor).forEach((tr, i) => tr.forEach(([j, k]) => { Q[i * N_KIN + j] += k; Q[i * N_KIN + i] -= k; }));
    return Q;
  }
  const N_KIN = 16;
  const ident = () => { const I = new Float64Array(N_KIN * N_KIN); for (let i = 0; i < N_KIN; i++) I[i * N_KIN + i] = 1; return I; };
  function matMul(A, B, C) {                         // flat row-major N_KIN × N_KIN; C = A·B
    C.fill(0);
    for (let i = 0; i < N_KIN; i++) for (let k = 0; k < N_KIN; k++) {
      const a = A[i * N_KIN + k]; if (!a) continue;
      for (let j = 0; j < N_KIN; j++) C[i * N_KIN + j] += a * B[k * N_KIN + j];
    }
    return C;
  }
  /** exp(Q·t) by scaling and squaring with a degree-10 Taylor series (flat 16 × 16 matrix) */
  function expmQ(Q, t) {
    let norm = 0;
    for (let i = 0; i < N_KIN; i++) { let r = 0; for (let j = 0; j < N_KIN; j++) r += Math.abs(Q[i * N_KIN + j]); norm = Math.max(norm, r); }
    const sq = Math.max(0, Math.ceil(Math.log2(norm * t / 0.5)));
    const h = t / Math.pow(2, sq);
    const A = Q.map(x => x * h);
    let E = ident(), term = ident(), tmp = new Float64Array(N_KIN * N_KIN);
    for (let k = 1; k <= 10; k++) {
      matMul(term, A, tmp); [term, tmp] = [tmp, term];
      for (let i = 0; i < term.length; i++) { term[i] /= k; E[i] += term[i]; }
    }
    for (let i = 0; i < sq; i++) { matMul(E, E, tmp); [E, tmp] = [tmp, E]; }
    return E;
  }

  /**
   * Occupancy time course at the sample times tS (s, ascending), propagated exactly between samples
   * with exp(QΔt), starting from receptors at rest (all in C1) at t = 0, or from the occupancies p0 at
   * time t0 (e.g. the end of a GABA application, to follow washout with gabaUM = 0).
   * Returns { open, des, p } (fractions per sample; p = occupancies at the last sample).
   */
  function kineticResponse(gabaUM, factor, tS, p0, t0 = 0) {
    const n = KIN_STATES.length, Q = kineticQ(gabaUM, factor);
    let p = p0 ? Float64Array.from(p0) : new Float64Array(n); if (!p0) p[0] = 1;
    let t = t0;
    const open = [], des = [];
    for (const ts of tS) {
      const dt = ts - t;
      if (dt > 0) {
        const E = expmQ(Q, dt), q = new Float64Array(n);
        for (let i = 0; i < n; i++) if (p[i]) for (let j = 0; j < n; j++) q[j] += p[i] * E[i * n + j];
        p = q; t = ts;
      }
      open.push(KIN_OPEN.reduce((a, i) => a + p[i], 0)); des.push(KIN_DES.reduce((a, i) => a + p[i], 0));
    }
    return { open, des, p };
  }

  /** Peak and steady-state open probability for a sustained GABA application (peak searched over 0-4 s) */
  const kinCache = new Map();
  function kineticSummary(gabaUM, factor = 1) {
    if (!(gabaUM > 0)) return { peak: 0, tPeak: null, steady: 0, des: 0 };
    const key = `${gabaUM}|${factor.toPrecision(4)}`;
    if (kinCache.has(key)) return kinCache.get(key);
    if (kinCache.size > 200) kinCache.clear();
    const res = kineticSummaryRaw(gabaUM, factor);
    kinCache.set(key, res);
    return res;
  }
  function kineticSummaryRaw(gabaUM, factor) {
    const tS = Array.from({ length: 121 }, (_, i) => 1e-4 * Math.pow(4 / 1e-4, i / 120));   // 0.1 ms to 4 s, log-spaced
    const r = kineticResponse(gabaUM, factor, tS);
    let k = 0; r.open.forEach((v, i) => { if (v > r.open[k]) k = i; });
    const ss = kineticSteady(gabaUM, factor);
    return { peak: r.open[k], tPeak: tS[k], steady: KIN_OPEN.reduce((a, i) => a + ss[i], 0), des: KIN_DES.reduce((a, i) => a + ss[i], 0) };
  }

  /* ---------------- Pharmacodynamics ---------------- */

  /**
   * Competitive binding at the BZD site (ligand vs flumazenil) and resulting
   * allosteric shift of GABA affinity.
   * @returns {{occD:number, occF:number, shift:number}}
   */
  function bzdSite(drugKey, sub, cNM, fluNM) {
    const d = drugKey && drugKey !== 'none' ? BZD.drugs[drugKey] : null;
    const f = BZD.drugs.flumazenil;
    const xd = d ? (cNM || 0) / d.pd.ki[sub] : 0;
    const xf = fluNM > 0 && drugKey !== 'flumazenil' ? fluNM / f.pd.ki[sub] : 0;
    const den = 1 + xd + xf;
    const occD = xd / den;
    const occF = xf / den;
    const shift = 1 + (d ? (d.pd.emax - 1) * occD : 0) + (f.pd.emax - 1) * occF;
    return { occD, occF, shift };
  }

  const ec50App = (sub, shift) => BZD.subtypes[sub].gabaEC50 / shift;

  /** Fractional GABA response (0-1) for GABA in µM. */
  function gabaResponse(gabaUM, sub, shift = 1) {
    if (gabaUM <= 0) return 0;
    const ec = ec50App(sub, shift);
    const g = Math.pow(gabaUM, M().hill);
    return g / (g + Math.pow(ec, M().hill));
  }

  /** IPSC decay time constants (ms) for an allosteric shift (BZD.model.ipsc; PAMs prolong decay) */
  function ipscDecay(shift = 1) {
    const c = M().ipsc, f = Math.pow(shift, c.decayShiftExponent);
    const fast = c.tauFast_ms * f, slow = c.tauSlow_ms * f;
    return { fast, slow, weighted: c.fastFraction * fast + (1 - c.fastFraction) * slow };
  }

  /**
   * Simulated IPSC (pA, inward negative): rise and biexponential decay as recorded in hippocampal
   * neurons (Jones & Westbrook 1995); the amplitude changes with the allosteric shift at a
   * sub-saturating effective synaptic GABA concentration, and the decay is prolonged by PAMs
   * (calibrated to Mellor & Randall 1997). Parameters in BZD.model.ipsc.
   */
  function ipsc(sub, shift, tMs) {
    const c = M().ipsc, d = ipscDecay(shift);
    const amp = c.amplitude_pA * gabaResponse(c.peakGaba_uM, sub, shift) / gabaResponse(c.peakGaba_uM, sub, 1);
    return tMs.map(t => -amp * (1 - Math.exp(-t / c.tauRise_ms)) * (c.fastFraction * Math.exp(-t / d.fast) + (1 - c.fastFraction) * Math.exp(-t / d.slow)));
  }

  /* ---------------- Pharmacokinetics ---------------- */

  function combineMods(active) {
    const m = { cyp3a4: 1, cyp2c19: 1, ugt: 1, other: 1, vLipo: 1 };
    (active || []).forEach(k => {
      const mod = BZD.modifiers[k];
      if (!mod) return;
      Object.entries(mod.m).forEach(([p, v]) => { m[p] *= v; });
      if (mod.vLipo) m.vLipo *= mod.vLipo;
    });
    return m;
  }

  const pathMult = (pathways, m) =>
    Object.entries(pathways).reduce((s, [p, w]) => s + w * (m[p] ?? 1), 0);

  /** Effective PK parameters after applying modifiers. */
  function effectivePK(drug, mods, weight) {
    const p = drug.pk;
    const m = combineMods(mods);
    const clMult = pathMult(p.pathways, m);
    const vMult = p.lipophilic ? m.vLipo : 1;
    const V = p.vd * weight * vMult;                 // L
    const CL = (LN2 / p.t12) * p.vd * weight * clMult; // L/h
    const ke = CL / V;
    let F = p.F;
    if (p.highFirstPass) {                            // hepatic extraction scales with intrinsic CL
      const Eh = Math.min(0.97, (1 - p.F) * clMult);
      F = 1 - Eh;
    }

    const metabolites = [];
    if (p.metabolites && Array.isArray(p.metabolites)) {
      p.metabolites.forEach(mm => {
        const cmMult = pathMult(mm.pathways, m);
        const Vm = mm.vd * weight * (mm.lipophilic !== false ? vMult : 1);
        const CLm = (LN2 / mm.t12) * mm.vd * weight * cmMult;
        metabolites.push({
          key: mm.key,
          name: mm.name,
          fm: mm.fm || 0,
          fmFromNord: mm.fmFromNord || 0,
          fmFromTem: mm.fmFromTem || 0,
          parent: mm.parent || 'parent',
          color: mm.color || '#e8590c',
          V: Vm,
          CL: CLm,
          k: CLm / Vm,
          t12: LN2 / (CLm / Vm)
        });
      });
    } else if (p.metabolite) {
      const mm = p.metabolite;
      const cmMult = pathMult(mm.pathways, m);
      const Vm = mm.vd * weight * vMult;
      const CLm = (LN2 / mm.t12) * mm.vd * weight * cmMult;
      metabolites.push({
        key: 'met1',
        name: mm.name,
        fm: mm.fm || 0,
        parent: 'parent',
        color: '#e8590c',
        V: Vm,
        CL: CLm,
        k: CLm / Vm,
        t12: LN2 / (CLm / Vm)
      });
    }

    return { V, CL, ke, ka: p.ka, F, t12: LN2 / ke, clMult, vMult, met: metabolites[0] || null, metabolites };
  }

  /**
   * Simulate plasma concentrations (ng/mL) supporting single or multiple active metabolites and routes (oral, sl, buccal, nasal, rectal, im, iv).
   * opts: { drug, dose(mg), route('oral'|'sl'|'buccal'|'nasal'|'rectal'|'im'|'iv'), n, tau(h), weight(kg), mods[], tEnd(h) }
   */
  /**
   * Absorption parameters for a drug by a given route. IV: F = 1. Oral: the drug's F after
   * patient/interaction modifiers (e = effectivePK result; high-first-pass drugs change with
   * hepatic function). Other routes: drug-specific values, else generic route defaults.
   */
  function routeAbsorption(drug, route, e) {
    if (route === 'iv') return { F: 1.0, ka: 0 };
    if (route && route !== 'oral') {
      const rp = (drug.pk.rt && drug.pk.rt[route]) || (route === 'im' && drug.pk.im) || M().routeDefaults[route];
      if (rp) return { F: rp.F, ka: rp.ka };
    }
    return { F: e.F, ka: e.ka };
  }

  /** Systemic bioavailability (0-1) used by the PK model for a drug, route and modifiers */
  function bioavailability(drug, route, mods) {
    if (!drug || !drug.pk) return null;
    return routeAbsorption(drug, route, effectivePK(drug, mods || [], 70)).F;
  }

  function simulate(opts) {
    const { drug, route, mods } = opts;
    // Guard against invalid regimens (callers limit inputs to the field ranges; this keeps the model finite)
    const pos = (x, d) => (Number.isFinite(x) && x > 0 ? x : d);
    const dose = Number.isFinite(opts.dose) && opts.dose >= 0 ? opts.dose : 0;
    const n = Math.max(1, Math.round(pos(opts.n, 1)));
    const tau = pos(opts.tau, 24);
    const weight = pos(opts.weight, 70);
    const e = effectivePK(drug, mods, weight);
    const lastDose = (n - 1) * tau;
    const maxT12 = Math.max(e.t12, ...(e.metabolites.map(m => m.t12)));
    // Window always covers every dose, then a washout tail (up to 5 t½ of the slowest species, max 14 days)
    const tEnd = opts.tEnd ?? Math.max(24, lastDose + Math.min(5 * maxT12, 24 * 14), lastDose + 24);

    const { F: routeF, ka: routeKa } = routeAbsorption(drug, route, e);

    const isDiazepamCascade = e.metabolites && e.metabolites.length >= 3;
    const isSingleMetabolite = e.metabolites && e.metabolites.length === 1;

    let kmax = Math.max(routeKa || 1, e.ke);
    e.metabolites.forEach(m => { kmax = Math.max(kmax, m.k); });
    const dt = Math.min(0.05, 0.15 / kmax, tEnd / 4000);

    const doseTimes = Array.from({ length: n }, (_, i) => i * tau);
    let di = 0;
    const T = [], Cp = [];
    const metaboliteCurves = e.metabolites.map(m => ({
      key: m.key,
      name: m.name,
      color: m.color,
      t12: m.t12,
      V: m.V,
      CL: m.CL,
      cp: []
    }));

    const steps = Math.ceil(tEnd / dt);
    const every = Math.max(1, Math.floor(steps / 1500));

    if (isDiazepamCascade) {
      // Diazepam cascade: Depot/Gut -> Diazepam -> [Nordiazepam, Temazepam] -> Oxazepam
      const mNord = e.metabolites[0];
      const mTem = e.metabolites[1];
      const mOx = e.metabolites[2];

      let Ag = 0, Ac = 0, Anord = 0, Atemp = 0, Aox = 0;
      const deriv = (g, d, nd, tm, ox) => [
        -routeKa * g,
        routeKa * g - e.ke * d,
        mNord.fm * e.ke * d - mNord.k * nd,
        mTem.fm * e.ke * d - mTem.k * tm,
        mOx.fmFromNord * mNord.k * nd + mOx.fmFromTem * mTem.k * tm - mOx.k * ox
      ];

      for (let s = 0; s <= steps; s++) {
        const t = s * dt;
        let dosed = false;
        while (di < doseTimes.length && doseTimes[di] <= t + 1e-9) {
          if (route === 'iv') Ac += dose; else Ag += dose * routeF;
          di++; dosed = true;
        }
        if (s % every === 0 || dosed) {   // always sample at a dose (IV peaks between thinned samples)
          T.push(+t.toFixed(4));
          Cp.push((Ac / e.V) * 1000);
          metaboliteCurves[0].cp.push((Anord / mNord.V) * 1000);
          metaboliteCurves[1].cp.push((Atemp / mTem.V) * 1000);
          metaboliteCurves[2].cp.push((Aox / mOx.V) * 1000);
        }
        // RK4
        const k1 = deriv(Ag, Ac, Anord, Atemp, Aox);
        const k2 = deriv(Ag + dt/2*k1[0], Ac + dt/2*k1[1], Anord + dt/2*k1[2], Atemp + dt/2*k1[3], Aox + dt/2*k1[4]);
        const k3 = deriv(Ag + dt/2*k2[0], Ac + dt/2*k2[1], Anord + dt/2*k2[2], Atemp + dt/2*k2[3], Aox + dt/2*k2[4]);
        const k4 = deriv(Ag + dt*k3[0], Ac + dt*k3[1], Anord + dt*k3[2], Atemp + dt*k3[3], Aox + dt*k3[4]);

        Ag += dt/6 * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]);
        Ac += dt/6 * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
        Anord += dt/6 * (k1[2] + 2*k2[2] + 2*k3[2] + k4[2]);
        Atemp += dt/6 * (k1[3] + 2*k2[3] + 2*k3[3] + k4[3]);
        Aox += dt/6 * (k1[4] + 2*k2[4] + 2*k3[4] + k4[4]);
      }
    } else if (isSingleMetabolite) {
      // Single active metabolite (e.g. Midazolam -> 1'-Hydroxymidazolam)
      const m1 = e.metabolites[0];
      let Ag = 0, Ac = 0, Am = 0;
      const deriv = (g, c, mm) => [
        -routeKa * g,
        routeKa * g - e.ke * c,
        m1.fm * e.ke * c - m1.k * mm
      ];

      for (let s = 0; s <= steps; s++) {
        const t = s * dt;
        let dosed = false;
        while (di < doseTimes.length && doseTimes[di] <= t + 1e-9) {
          if (route === 'iv') Ac += dose; else Ag += dose * routeF;
          di++; dosed = true;
        }
        if (s % every === 0 || dosed) {   // always sample at a dose (IV peaks between thinned samples)
          T.push(+t.toFixed(4));
          Cp.push((Ac / e.V) * 1000);
          metaboliteCurves[0].cp.push((Am / m1.V) * 1000);
        }
        const k1 = deriv(Ag, Ac, Am);
        const k2 = deriv(Ag + dt/2*k1[0], Ac + dt/2*k1[1], Am + dt/2*k1[2]);
        const k3 = deriv(Ag + dt/2*k2[0], Ac + dt/2*k2[1], Am + dt/2*k2[2]);
        const k4 = deriv(Ag + dt*k3[0], Ac + dt*k3[1], Am + dt*k3[2]);

        Ag += dt/6 * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]);
        Ac += dt/6 * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
        Am += dt/6 * (k1[2] + 2*k2[2] + 2*k3[2] + k4[2]);
      }
    } else {
      // Parent drug only (Lorazepam, Alprazolam, etc.)
      let Ag = 0, Ac = 0;
      const deriv = (g, c) => [
        -routeKa * g,
        routeKa * g - e.ke * c
      ];

      for (let s = 0; s <= steps; s++) {
        const t = s * dt;
        let dosed = false;
        while (di < doseTimes.length && doseTimes[di] <= t + 1e-9) {
          if (route === 'iv') Ac += dose; else Ag += dose * routeF;
          di++; dosed = true;
        }
        if (s % every === 0 || dosed) {   // always sample at a dose (IV peaks between thinned samples)
          T.push(+t.toFixed(4));
          Cp.push((Ac / e.V) * 1000);
        }
        const k1 = deriv(Ag, Ac);
        const k2 = deriv(Ag + dt/2*k1[0], Ac + dt/2*k1[1]);
        const k3 = deriv(Ag + dt/2*k2[0], Ac + dt/2*k2[1]);
        const k4 = deriv(Ag + dt*k3[0], Ac + dt*k3[1]);

        Ag += dt/6 * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]);
        Ac += dt/6 * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
      }
    }

    // first-interval Cmax/Tmax: samples before the second dose (the sample at t = τ already includes it)
    const inFirst = n > 1 ? (t) => t < tau - 1e-9 : (t) => t <= tEnd;
    let cmax = 0, tmax = 0;
    for (let i = 0; i < T.length && inFirst(T[i]); i++) if (Cp[i] > cmax) { cmax = Cp[i]; tmax = T[i]; }
    let cmaxAll = 0;
    Cp.forEach(c => { if (c > cmaxAll) cmaxAll = c; });

    metaboliteCurves.forEach(mc => {
      let mPeak = 0;
      mc.cp.forEach(val => { if (val > mPeak) mPeak = val; });
      mc.cmax = mPeak;
    });

    const Fused = route === 'iv' ? 1.0 : routeF;
    const params = {
      cmax, tmax, cmaxAll,
      auc: Fused * dose / e.CL * 1000,
      t12: e.t12, V: e.V, CL: e.CL, F: Fused, ke: e.ke,
      ka: route === 'iv' ? null : routeKa,
      R: n > 1 ? 1 / (1 - Math.exp(-e.ke * tau)) : 1,
      cssAvg: n > 1 ? Fused * dose / (e.CL * tau) * 1000 : null,
      tss: 3.3 * e.t12,
      met: e.met,
      metabolites: metaboliteCurves
    };

    return { t: T, cp: Cp, params, doseTimes, tEnd, eff: e, metabolites: metaboliteCurves };
  }

  return {
    bzdSite, ec50App, gabaResponse, ipsc, ipscDecay, effectivePK, simulate, bioavailability,
    get CL_IONS_PER_OPEN_S() { return ghk().ionsPerS; },
    get CL_CHANNEL() { return ghk(); },
    clChannel: ghk,
    KIN_STATES, KIN_OPEN, KIN_DES, KIN_BURST, kineticRates, kineticStep, kineticSteady, kineticResponse, kineticSummary,
  };
})();
