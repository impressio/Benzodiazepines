/* =====================================================================
 * structure.js - Rotatable cryo-EM GABA-A receptor (PDB 6HUP, 3Dmol.js)
 *
 *  - Default look mimics cryo-EM figures: solvent-excluded surface coloured
 *    by subunit with silhouette outlines, small windows cut over the GABA and
 *    BZD pockets so the ball-and-stick ligands stay visible, and a translucent
 *    lipid nanodisc around the TMD. "Cut open" clips the front half to show
 *    the pore, M2 helices, 9′ gate and Cl⁻ ions; "Show ribbons" switches to cartoon.
 *  - Clicking a subunit, ligand or the pore shows details in the info panel.
 *
 * Structural Allosteric Modulation & Dynamic Gating:
 *  - Uses Cryo-EM 6HUP (α1β3γ2 + diazepam + GABA) from RCSB.
 *  - High-affinity α1+/γ2− BZD pocket (chains D/C) and orthosteric GABA sites
 *    (ABU, chains B/A and E/D) styled to match simulator color palette.
 *  - Pore-lining M2 helices (residues ~250-277 across five chains) are
 *    animated between closed and open conformations by a stochastic kinetic (Markov)
 *    scheme with bursts and desensitisation (Models.kineticStep). Cl⁻ ions move at a
 *    constant speed and reach the gate at a rate proportional to the net Cl⁻ flux of
 *    the GHK model, from the side the flux comes from; they cross the 9′ gate only
 *    while it is open and otherwise return, so mean flux scales with P_o - PAMs act
 *    only through P_o.
 *  - An allosteric signal wave traces the conformational transduction
 *    pathway: α1+/γ2− pocket → Cys-loop / M2-M3 linker → M2 9′ gate.
 *  - Live status panel reflects the selected ligand, free concentration,
 *    channel burst frequency, and gate dilation.
 * ===================================================================== */
window.Structure = (function () {
  'use strict';

  let viewer = null;
  let loaded = false;
  let hasSurface = false;      // density-map mode (vs ribbons)
  let densityShapes = {};      // chain -> isosurface shape
  let ligandShapes = [];       // translucent ligand densities
  let ligandKeyShown = '';
  let membraneShapes = [];
  let dynShapes = [];          // per-frame shapes (gate ring, conduit)
  let m2DensityShapes = {};    // chain -> re-contoured pore-lining M2 density
  let m2Open = -1, m2Time = 0; // last contoured gate opening / time
  let isCut = false;
  let cutChains = [];          // front subunits removed in the cut-open view
  let cutNormal = null;        // model-space direction toward the camera when the cut was made
  let zoomRef = null;          // camera distance of the default view (zoom level 1×)
  let selectedChain = 'D';
  let pickAtoms = [];
  let nearLigand = new Set();
  let isAnimating = true;
  let surfObj = null;

  // Models inside 3Dmol viewer
  let baseModel = null;     // full receptor (static cartoon with M2 residues hidden)
  let m2Model = null;       // dynamic M2 pore model whose coordinates are displaced per frame
  let fluModel = null;      // flumazenil (experimental 6D6U pose, superposed)

  // Animation & geometry state
  let animId = null;
  let currentState = null;
  let isVisible = true;
  let lastTime = 0;

  // Cached PDB geometry (computed on load)
  let geom = null;
  let m2AtomsOrig = [];     // deep-copy of original M2 coordinates and metadata

  // Color palette matching the webapp
  const PALETTE = {
    alpha: '#5B8DEF',
    beta: '#3CCB8F',
    gamma: '#F4A340',
    cl: '#22B8CF',
    flu: '#FA5252',
    gaba: '#E5484D',
    bzd: '#8E4EC6',
    gate: '#20C997',
    gateRing: '#F59F00',   // 9′ gate indicator (amber, ribbons view)
    signal: '#CC5DE8',     // allosteric signal pulses (magenta)
    his102: '#1C7ED6',
  };

  /**
   * Flumazenil heavy atoms (element, x, y, z) from PDB 6D6U (α1β2γ2 + flumazenil,
   * Zhu et al., Nature 2018), superposed onto the 6HUP α1+/γ2− pocket
   * (76 pocket Cα atoms, RMSD 0.69 Å). Shown whenever flumazenil occupies the site.
   */
  const FLUMAZENIL_POSE = [
    ['C', 122.692, 162.98, 108.242],
    ['C', 122.879, 162.042, 107.102],
    ['C', 122.221, 159.84, 106.598],
    ['C', 121.141, 158.85, 106.617],
    ['C', 119.912, 158.816, 107.184],
    ['C', 119.062, 159.684, 108.017],
    ['C', 118.131, 157.984, 109.545],
    ['C', 117.551, 157.253, 108.393],
    ['C', 118.12, 157.089, 107.148],
    ['C', 120.311, 156.985, 106.063],
    ['C', 117.48, 156.379, 106.149],
    ['C', 116.259, 155.822, 106.399],
    ['C', 115.713, 155.993, 107.63],
    ['C', 116.307, 156.676, 108.628],
    ['C', 119.394, 159.801, 110.486],
    ['F', 114.499, 155.443, 107.875],
    ['N', 118.83, 159.106, 109.326],
    ['N', 119.381, 157.614, 106.818],
    ['N', 121.384, 157.69, 105.913],
    ['O', 122.003, 160.903, 107.356],
    ['O', 123.21, 159.701, 105.94],
    ['O', 117.941, 157.518, 110.646]
  ];

  // Known 9′ Leucine gate residue per chain in 6HUP (CA z ≈ 157, r ≈ 7-9 Å)
  const GATE_LEU = { A: 264, B: 259, C: 274, D: 264, E: 259 };

  function waitFor3Dmol(cb, maxRetries = 60) {
    if (typeof $3Dmol !== 'undefined') {
      cb();
      return;
    }
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (typeof $3Dmol !== 'undefined') {
        clearInterval(interval);
        cb();
      } else if (count >= maxRetries) {
        clearInterval(interval);
        console.warn('3Dmol library took too long to load.');
      }
    }, 100);
  }

  function init() {
    const container = document.getElementById('mol-viewer');
    if (!container) return;

    // Pull initial state from Receptor module if ready
    if (window.Receptor && typeof window.Receptor.getState === 'function') {
      currentState = window.Receptor.getState();
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        isVisible = entry.isIntersecting;
        if (entry.isIntersecting && !loaded) {
          waitFor3Dmol(() => loadPdb(container));
        }
      });
    }, { rootMargin: '200px' });

    observer.observe(container);

    attachPicking(container);

    document.addEventListener('visibilitychange', () => {
      isVisible = !document.hidden;
    });

    attachButtons();
    attachZoomSlider();
    updateStatus();
  }

  function loadPdb(container) {
    if (loaded) return;
    if (typeof $3Dmol === 'undefined') {
      waitFor3Dmol(() => loadPdb(container));
      return;
    }
    loaded = true;

    container.innerHTML = `<div class="mol-loading">${BZD.t('mechanism.loading')}</div>`;

    try {
      viewer = $3Dmol.createViewer(container, {
        defaultcolors: $3Dmol.rasmolElementColors,
        backgroundColor: '#ffffff',
      });
      // The viewer grows with the stage column (equal height to the side panels): keep the canvas in step
      if (window.ResizeObserver) new ResizeObserver(() => { if (viewer) { viewer.resize(); viewer.render(); } }).observe(container);

      // Local copy of PDB 6HUP (assets/models/6HUP.pdb.gz), so the view does not depend on RCSB
      ModelFiles.text('6HUP.pdb.gz').then(pdb => {
        viewer.addModel(pdb, 'pdb');
        try {
          onPdbLoaded();
          const loadingEl = container.querySelector('.mol-loading');
          if (loadingEl) loadingEl.remove();
        } catch (err) {
          console.error('Error processing 6HUP structure:', err);
        }
      }).catch(err => {
        console.warn('6HUP loading failed:', err);
        container.innerHTML = `<div class="mol-loading">${BZD.t('st.loadError', { msg: err.message })}</div>`;
      });
    } catch (err) {
      console.warn('3Dmol loading failed:', err);
      container.innerHTML = `<div class="mol-loading">${BZD.t('st.startError', { msg: err.message })}</div>`;
    }
  }

  /**
   * Process loaded 6HUP: compute geometry, extract dynamic M2 pore model,
   * style static chains, compute the allosteric conduit path, and kick off the loop.
   */
  function onPdbLoaded() {
    baseModel = viewer.getModel(0);
    const atoms = baseModel.selectedAtoms({});

    computeGeometry(atoms);
    buildM2Model(atoms);
    buildFlumazenilModel();
    indexAtoms(atoms);
    viewer.setViewStyle({ style: 'outline', color: '#1f2937', width: 0.035 });
    addDensityMap();          // sets density mode first so the ribbons are never styled underneath
    applyStyling();
    drawMembrane();

    // Default orientation: membrane-plane view, tilted to look slightly onto the extracellular face
    viewer.zoomTo();
    setSideView();
    viewer.setViewChangeCallback(() => syncZoomSlider());
    viewer.render();

    updateStatus();
    startAnimationLoop();
  }

  /** Compute pore axis, landmarks, and allosteric conduit nodes */
  function computeGeometry(atoms) {
    const recCA = atoms.filter(a => a.atom === 'CA' && 'ABCDE'.includes(a.chain));
    const meanX = recCA.reduce((s, a) => s + a.x, 0) / (recCA.length || 1);
    const meanY = recCA.reduce((s, a) => s + a.y, 0) / (recCA.length || 1);

    // BZD pocket centroid (DZP in chain D, residue 2001, at α1+/γ2− interface)
    const dzpAtoms = atoms.filter(a => a.resn === 'DZP' && a.chain === 'D' && a.resi === 2001);
    const bzdCentroid = dzpAtoms.length > 0
      ? {
          x: dzpAtoms.reduce((s, a) => s + a.x, 0) / dzpAtoms.length,
          y: dzpAtoms.reduce((s, a) => s + a.y, 0) / dzpAtoms.length,
          z: dzpAtoms.reduce((s, a) => s + a.z, 0) / dzpAtoms.length,
        }
      : { x: 117.4, y: 157.5, z: 110.5 };

    // 9′ Leucine gate CA centroid
    const gateCA = atoms.filter(a => a.atom === 'CA' && GATE_LEU[a.chain] === a.resi);
    const gateCentroid = gateCA.length > 0
      ? {
          x: gateCA.reduce((s, a) => s + a.x, 0) / gateCA.length,
          y: gateCA.reduce((s, a) => s + a.y, 0) / gateCA.length,
          z: gateCA.reduce((s, a) => s + a.z, 0) / gateCA.length,
        }
      : { x: meanX, y: meanY, z: 157.0 };

    // Intermediate nodes: Cys-loop / β1-β2 turn on chain D (z ≈ 128) and M2-M3 loop (resi ~278-282, z ≈ 142)
    const cysLoopCA = atoms.filter(a => a.chain === 'D' && a.atom === 'CA' && a.z > 120 && a.z < 135 && Math.hypot(a.x - meanX, a.y - meanY) < 32);
    const m2m3CA = atoms.filter(a => a.chain === 'D' && a.atom === 'CA' && a.resi >= 275 && a.resi <= 282);

    const n1 = cysLoopCA.length > 0
      ? { x: cysLoopCA[0].x, y: cysLoopCA[0].y, z: cysLoopCA[0].z }
      : { x: (bzdCentroid.x + gateCentroid.x) / 2, y: (bzdCentroid.y + gateCentroid.y) / 2, z: 130 };

    const n2 = m2m3CA.length > 0
      ? { x: m2m3CA[0].x, y: m2m3CA[0].y, z: m2m3CA[0].z }
      : { x: (n1.x + gateCentroid.x) / 2, y: (n1.y + gateCentroid.y) / 2, z: 145 };

    // End point: chain D (the α1 of the BZD site) 9′ Leu CA, pushed 3 Å outward from the pore axis,
    // so the signal stops at the pore wall instead of dropping into the ion pathway
    const gateD = gateCA.find(a => a.chain === 'D');
    let gateEnd = gateCentroid;
    if (gateD) {
      const dx = gateD.x - meanX, dy = gateD.y - meanY, r = Math.hypot(dx, dy) || 1;
      gateEnd = { x: gateD.x + dx / r * 3, y: gateD.y + dy / r * 3, z: gateD.z };
    }

    // Catmull-Rom spline interpolation through 4 nodes
    const waypoints = [bzdCentroid, n1, n2, gateEnd];
    const path = sampleSpline(waypoints, 24);

    geom = {
      axis: { x: meanX, y: meanY },
      zRange: { zMin: 78, zMax: 196, zGate: gateCentroid.z },
      bzdCentroid,
      gateCentroid,
      path,
    };
  }

  function sampleSpline(pts, nSamples) {
    const res = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const steps = Math.round(nSamples / (pts.length - 1));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        const z = 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
        res.push({ x, y, z });
      }
    }
    res.push(pts[pts.length - 1]);
    return res;
  }

  /**
   * Build a separate dynamic M2 model for the pore-lining helices.
   * This keeps per-frame coordinate displacement fast (only ~1100 atoms),
   * while the rest of the 15k-atom receptor stays rendered statically.
   */
  function buildM2Model(atoms) {
    const isM2 = (a) => {
      if (!'ABCDE'.includes(a.chain)) return false;
      const g = GATE_LEU[a.chain];
      return a.resi >= g - 14 && a.resi <= g + 13;
    };

    const m2Atoms = atoms.filter(isM2);
    m2AtomsOrig = m2Atoms.map(a => ({
      serial: a.serial,
      name: a.atom,
      resn: a.resn,
      chain: a.chain,
      resi: a.resi,
      x: a.x,
      y: a.y,
      z: a.z,
      b: a.b || 30.0,
      elem: a.elem || a.atom[0],
    }));

    // Format minimal PDB text for the M2 helices
    let pdb = '';
    m2AtomsOrig.forEach((a, idx) => {
      const atomName = a.name.length === 4 ? a.name : (' ' + a.name).padEnd(4, ' ');
      const line =
        'ATOM  ' +
        String(idx + 1).padStart(5, ' ') + ' ' +
        atomName + ' ' +
        a.resn.padEnd(3, ' ') + ' ' +
        a.chain +
        String(a.resi).padStart(4, ' ') + '    ' +
        a.x.toFixed(3).padStart(8, ' ') +
        a.y.toFixed(3).padStart(8, ' ') +
        a.z.toFixed(3).padStart(8, ' ') +
        '  1.00' +
        (a.b || 30.0).toFixed(2).padStart(6, ' ') +
        '          ' +
        (a.elem || 'C').padStart(2, ' ') +
        '\n';
      pdb += line;
    });

    m2Model = viewer.addModel(pdb, 'pdb');
  }

  const RECEPTOR = ['A', 'B', 'C', 'D', 'E'];
  const CHAIN_TYPE = { A: 'alpha', D: 'alpha', B: 'beta', E: 'beta', C: 'gamma' };
  const CHAIN_LABEL = { A: 'α1', D: 'α1', B: 'β3', E: 'β3', C: 'γ2' };
  const isBzdAtom = (a) => a.resn === 'DZP' && a.chain === 'D' && a.resi === 2001;

  /** Atoms used for click picking, and receptor atoms near the ECD ligands (surface windows) */
  function indexAtoms(atoms) {
    const lig = atoms.filter(a => a.resn === 'ABU' || isBzdAtom(a))
      .concat(FLUMAZENIL_POSE.map(([, x, y, z]) => ({ x, y, z })));
    pickAtoms = atoms.filter(a => (a.atom === 'CA' && RECEPTOR.includes(a.chain)) || a.resn === 'ABU' || isBzdAtom(a))
      .concat(FLUMAZENIL_POSE.map(([, x, y, z]) => ({ x, y, z, resn: 'DZP', chain: 'D' })));
    const W2 = 9 * 9;
    atoms.forEach(a => {
      if (a.hetflag || !RECEPTOR.includes(a.chain)) return;
      for (const l of lig) {
        const dx = a.x - l.x, dy = a.y - l.y, dz = a.z - l.z;
        if (dx * dx + dy * dy + dz * dz < W2) { nearLigand.add(a.index); break; }
      }
    });
  }

  /** The structure is the α1 template (6HUP); the selected α isoform is shown by colour and labels */
  const curSub = () => (currentState && currentState.subKey) || 'a1';
  const isoInfo = () => window.BZD.subtypes[curSub()];
  function chainColor(ch) {
    return CHAIN_TYPE[ch] === 'alpha' ? (window.BZD.isoformColor[curSub()] || PALETTE.alpha) : PALETTE[CHAIN_TYPE[ch]];
  }
  const chainLabel = (ch) => (CHAIN_TYPE[ch] === 'alpha' ? isoInfo().label : CHAIN_LABEL[ch]);
  let shownSub = 'a1';

  function chainColors() {
    const map = {};
    RECEPTOR.forEach(ch => {
      const c = chainColor(ch);
      map[ch] = ch === selectedChain ? lighten(c, 0.22) : c;
    });
    return map;
  }

  function lighten(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(v + (255 - v) * f);
    return '#' + ((1 << 24) + (ch(n >> 16) << 16) + (ch((n >> 8) & 255) << 8) + ch(n & 255)).toString(16).slice(1);
  }

  /**
   * Simulated cryo-EM map: Gaussian density (σ ≈ 1.5 Å, ~4-5 Å resolution look)
   * computed per chain from the atomic model and contoured with marching cubes,
   * i.e. a segmented map coloured by subunit. Atoms lining the GABA/BZD pockets
   * are left out so the ligands stay visible through small windows.
   */
  const MAP = { spacing: 1.4, sigma: 1.5, iso: 1.0, smooth: 3 };

  function gaussianVolume(atoms, pad) {
    const { spacing: h, sigma } = MAP;
    const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y), zs = atoms.map(a => a.z);
    const o = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, z: Math.min(...zs) - pad };
    const size = {
      x: Math.ceil((Math.max(...xs) + pad - o.x) / h) + 1,
      y: Math.ceil((Math.max(...ys) + pad - o.y) / h) + 1,
      z: Math.ceil((Math.max(...zs) + pad - o.z) / h) + 1,
    };
    const data = new Float32Array(size.x * size.y * size.z);
    const inv = 1 / (2 * sigma * sigma), cut = 3 * sigma, c2 = cut * cut, r = Math.ceil(cut / h);
    const syz = size.y * size.z;
    for (const a of atoms) {
      const ci = Math.round((a.x - o.x) / h), cj = Math.round((a.y - o.y) / h), ck = Math.round((a.z - o.z) / h);
      for (let i = Math.max(0, ci - r); i <= Math.min(size.x - 1, ci + r); i++) {
        const dx = o.x + i * h - a.x;
        for (let j = Math.max(0, cj - r); j <= Math.min(size.y - 1, cj + r); j++) {
          const dy = o.y + j * h - a.y, dxy = dx * dx + dy * dy;
          if (dxy > c2) continue;
          const row = i * syz + j * size.z;
          for (let k = Math.max(0, ck - r); k <= Math.min(size.z - 1, ck + r); k++) {
            const dz = o.z + k * h - a.z, d2 = dxy + dz * dz;
            if (d2 < c2) data[row + k] += Math.exp(-d2 * inv);
          }
        }
      }
    }
    const vd = new $3Dmol.VolumeData('', 'none');
    vd.size = size; vd.origin = o; vd.unit = { x: h, y: h, z: h }; vd.data = data; vd.matrix = null;
    return vd;
  }

  function addChainDensity(ch) {
    if (densityShapes[ch]) viewer.removeShape(densityShapes[ch]);
    delete densityShapes[ch];
    if (cutChains.includes(ch)) return;
    const atoms = baseModel.selectedAtoms({ chain: ch }).filter(a => !a.hetflag && a.elem !== 'H' && !nearLigand.has(a.index) && !isM2Atom(a));
    const c = chainColor(ch);
    densityShapes[ch] = viewer.addIsosurface(gaussianVolume(atoms, 6), {
      isoval: MAP.iso, smoothness: MAP.smooth, opacity: 1, color: ch === selectedChain ? lighten(c, 0.22) : c,
    });
  }

  function addDensityMap() {
    if (!viewer || !baseModel) return;
    const t0 = performance.now();
    hasSurface = true;
    RECEPTOR.forEach(addChainDensity);
    updateM2Density(0, true);
    console.info(`[structure] density map contoured in ${Math.round(performance.now() - t0)} ms`);
    ligandKeyShown = '';
    updateLigandDensity();
    const btn = document.getElementById('mol-btn-surface');
    if (btn) { btn.textContent = BZD.t('st.ribbons'); btn.title = BZD.t('st.ribbonsTip'); }
  }

  function removeDensityMap() {
    Object.values(densityShapes).forEach(sh => viewer.removeShape(sh));
    Object.values(m2DensityShapes).forEach(sh => viewer.removeShape(sh));
    ligandShapes.forEach(sh => viewer.removeShape(sh));
    densityShapes = {}; m2DensityShapes = {}; ligandShapes = []; ligandKeyShown = '';
    hasSurface = false;
  }

  /** Translucent density around the bound ligands (as ligand densities are shown in cryo-EM figures) */
  function updateLigandDensity() {
    if (!viewer || !baseModel || !hasSurface) return;
    const gabaOn = !currentState || currentState.gaba > 0;
    const ligKey = currentState?.ligandKey || 'diazepam';
    const drug = ligKey !== 'none' ? window.BZD.drugs[ligKey] : null;
    const occ = bzdOccupant(currentState);
    const key = `${gabaOn}|${occ.kind}|${occ.drug ? occ.drug.name : ''}`;
    if (key === ligandKeyShown) return;
    ligandKeyShown = key;
    ligandShapes.forEach(sh => viewer.removeShape(sh));
    ligandShapes = [];
    const add = (atoms, color) => {
      if (!atoms.length) return;
      ligandShapes.push(viewer.addIsosurface(gaussianVolume(atoms, 4), { isoval: 0.35, smoothness: 2, color, opacity: 0.35 }));
    };
    if (gabaOn) {
      const abu = baseModel.selectedAtoms({ resn: 'ABU' });
      [...new Set(abu.map(a => a.chain + a.resi))].forEach(k => add(abu.filter(a => a.chain + a.resi === k), PALETTE.gaba));
    }
    if (occ.kind === 'flumazenil') add(FLUMAZENIL_POSE.map(([, x, y, z]) => ({ x, y, z })), PALETTE.flu);
    else if (occ.kind === 'bzd') add(baseModel.selectedAtoms({ resn: 'DZP', chain: 'D', resi: 2001 }), occ.drug.color || PALETTE.bzd);
  }

  function recolorSurface(prev) {
    if (!viewer || !hasSurface) return;
    if (prev && prev !== selectedChain) addChainDensity(prev);
    addChainDensity(selectedChain);
    updateM2Density(Math.max(0, m2Open), true);
    viewer.render();
  }

  /**
   * Lipid nanodisc: a low-resolution "density" disc around the TMD, contoured
   * like the protein map and drawn translucent so the TMD shows through.
   * Pore axis = z, intracellular = +z; hydrophobic core centred near the 9′ gate.
   */
  function drawMembrane() {
    if (!geom || !viewer) return;
    membraneShapes.forEach(sh => viewer.removeShape(sh));
    const { x: cx, y: cy } = geom.axis, zc = geom.zRange.zGate - 1;
    const R = 58, H = 20, h = 2;
    const o = { x: cx - R - 6, y: cy - R - 6, z: zc - H - 6 };
    const size = { x: Math.ceil((2 * R + 12) / h) + 1, y: Math.ceil((2 * R + 12) / h) + 1, z: Math.ceil((2 * H + 12) / h) + 1 };
    const data = new Float32Array(size.x * size.y * size.z);
    for (let i = 0; i < size.x; i++) for (let j = 0; j < size.y; j++) {
      const px = o.x + i * h - cx, py = o.y + j * h - cy, r = Math.hypot(px, py), ang = Math.atan2(py, px);
      const rim = R + 1.5 * Math.sin(ang * 7) + 1.0 * Math.cos(ang * 13);
      for (let k = 0; k < size.z; k++) {
        const dz = Math.abs(o.z + k * h - zc);
        const wobble = 0.8 * Math.sin(px * 0.31 + py * 0.17) * Math.cos(py * 0.23 - px * 0.11);
        let v = Math.min(rim - r, H + wobble - dz);
        if (cutNormal) v = Math.min(v, -(px * cutNormal.x + py * cutNormal.y) - 2);   // keep the half behind the pore axis
        data[(i * size.y + j) * size.z + k] = v;
      }
    }
    const vd = new $3Dmol.VolumeData('', 'none');
    vd.size = size; vd.origin = o; vd.unit = { x: h, y: h, z: h }; vd.data = data; vd.matrix = null;
    membraneShapes = [viewer.addIsosurface(vd, { isoval: 0, smoothness: 4, color: '#9ea7b2', opacity: 0.5 })];
  }

  /** Map a click to the front-most subunit / ligand under the cursor */
  function attachPicking(container) {
    let down = null;
    container.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
    container.addEventListener('pointerup', (e) => {
      if (!down || !viewer || !pickAtoms.length) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4) return;   // a drag (rotation), not a click
      // modelToScreen returns page coordinates (canvas offset includes scroll)
      const mx = e.pageX, my = e.pageY;
      const scr = viewer.modelToScreen(pickAtoms.map(a => ({ x: a.x, y: a.y, z: a.z })));
      const v = viewer.getView();
      const q = { x: v[4], y: v[5], z: v[6], w: v[7] };
      const depth = (a) => {
        // rotate (p + modelGroup.position) by q; z toward the camera
        const px = a.x + v[0], py = a.y + v[1], pz = a.z + v[2];
        const ix = q.w * px + q.y * pz - q.z * py, iy = q.w * py + q.z * px - q.x * pz;
        const iz = q.w * pz + q.x * py - q.y * px, iw = -q.x * px - q.y * py - q.z * pz;
        return iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
      };
      let best = null, bestD = -Infinity, lig = null, ligD = -Infinity;
      pickAtoms.forEach((a, i) => {
        const p = scr[i];
        if (!p) return;
        const d2 = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d2 > 26 * 26) return;
        const z = depth(a);
        if (a.resn === 'ABU' || a.resn === 'DZP') { if (z > ligD) { lig = a; ligD = z; } }
        else if (d2 < 14 * 14 && z > bestD) { best = a; bestD = z; }
      });
      if (!window.Receptor) return;
      if (lig && ligD > bestD - 18) {
        window.Receptor.showSubunitInfo(lig.resn === 'ABU' ? 'gaba-site' : 'bzd-site');
      } else if (best) {
        const prev = selectedChain;
        selectedChain = best.chain;
        recolorSurface(prev);
        window.Receptor.showSubunitInfo(CHAIN_TYPE[best.chain]);
      } else {
        window.Receptor.showSubunitInfo('pore');
      }
    });
  }

  /** Subunit labels on the outside of each ECD */
  function addSubunitLabels() {
    if (!geom || !baseModel) return;
    RECEPTOR.forEach(ch => {
      const ca = baseModel.selectedAtoms({ chain: ch, atom: 'CA' }).filter(a => a.z < geom.zRange.zGate - 45);
      if (!ca.length) return;
      const c = ca.reduce((s, a) => ({ x: s.x + a.x, y: s.y + a.y, z: s.z + a.z }), { x: 0, y: 0, z: 0 });
      c.x /= ca.length; c.y /= ca.length; c.z /= ca.length;
      const dx = c.x - geom.axis.x, dy = c.y - geom.axis.y, r = Math.hypot(dx, dy) || 1;
      viewer.addLabel(chainLabel(ch), {
        position: { x: geom.axis.x + dx / r * (r + 24), y: geom.axis.y + dy / r * (r + 24), z: c.z - 14 },
        font: labelFont().family, fontSize: labelFont().size, fontColor: '#ffffff', fontOpacity: 1, showBackground: true,
        backgroundColor: chainColor(ch), backgroundOpacity: 0.92, borderThickness: 0,
        inFront: true, alignment: 'center',
      });
    });
  }

  function buildFlumazenilModel() {
    const pdb = FLUMAZENIL_POSE.map(([el, x, y, z], i) =>
      'HETATM' + String(i + 1).padStart(5, ' ') + ' ' + (el + (i + 1)).padEnd(4, ' ') + ' FYP D3001    ' +
      x.toFixed(3).padStart(8, ' ') + y.toFixed(3).padStart(8, ' ') + z.toFixed(3).padStart(8, ' ') +
      '  1.00 30.00          ' + el.padStart(2, ' ')).join('\n') + '\nEND\n';
    fluModel = viewer.addModel(pdb, 'pdb');
    fluModel.setStyle({}, {});
  }

  /** Who occupies the BZD site: 'flumazenil', 'bzd' (drug on the diazepam pose) or null */
  function bzdOccupant(state) {
    if (!state) return { kind: 'bzd', drug: window.BZD.drugs.diazepam };
    const drug = state.ligandKey && state.ligandKey !== 'none' ? window.BZD.drugs[state.ligandKey] : null;
    const occD = state.bzdCalc?.occD || 0, occF = state.bzdCalc?.occF || 0;
    const binds = !!(drug && drug.pd);
    if (state.ligandKey === 'flumazenil' || (state.fluOn && occF > 0.05 && occF >= occD)) return { kind: 'flumazenil', drug: window.BZD.drugs.flumazenil };
    if (binds && occD > 0.05) return { kind: 'bzd', drug };
    return { kind: null, drug: null };
  }

  /** Style the base model and M2 model */
  function applyStyling() {
    if (!viewer || !baseModel) return;

    // Reset all styling
    viewer.setStyle({}, {});

    // Hide non-receptor components: Megabody (chain G), glycans (NAG, BMA, MAN), lipids (PIO)
    baseModel.setStyle({ chain: 'G' }, {});
    baseModel.setStyle({ resn: ['NAG', 'BMA', 'MAN', 'PIO', 'HOH'] }, {});

    // Hide M2 helix residue ranges on baseModel (they are drawn dynamically on m2Model)
    Object.entries(GATE_LEU).forEach(([ch, g]) => {
      for (let r = g - 14; r <= g + 13; r++) {
        baseModel.setStyle({ chain: ch, resi: r }, {});
      }
    });

    // Static cartoon styling for the pentamer:
    // chains A, D: α1; chains B, E: β3; chain C: γ2
    if (!hasSurface) {
      RECEPTOR.filter(ch => !cutChains.includes(ch)).forEach(ch =>
        baseModel.setStyle({ chain: ch }, { cartoon: { color: chainColor(ch) } }));
    }

    // Conserved His102 on α1 (BZD sensitivity residue) - ribbon mode only, so map and model never mix
    if (!hasSurface) baseModel.setStyle({ resn: 'HIS', resi: 102, chain: ['A', 'D'] }, { stick: { color: PALETTE.his102, radius: 0.28 } }, true);

    // Ligands on base model - rendered as bold CPK space-filling molecules
    const gabaOn = !currentState || currentState.gaba > 0;
    const ligKey = currentState?.ligandKey || 'diazepam';
    const drug = ligKey !== 'none' ? window.BZD.drugs[ligKey] : null;
    const bzColor = drug?.color || PALETTE.bzd;

    const cpk = (carbon) => (atom) => {
      switch (atom.elem) {
        case 'N': return '#3050F8';
        case 'O': return '#E03131';
        case 'Cl': return '#2F9E44';
        case 'F': return '#74C69D';
        case 'H': return '#FFFFFF';
        default: return carbon;
      }
    };

    // Orthosteric GABA (ABU) at both beta+/alpha- interfaces
    const ballStick = (carbon) => ({ sphere: { colorfunc: cpk(carbon), scale: 0.32 }, stick: { colorfunc: cpk(carbon), radius: 0.2 } });
    baseModel.setStyle({ resn: 'ABU' }, gabaOn
      ? ballStick(PALETTE.gaba)
      : { stick: { color: '#ced4da', radius: 0.15 } });

    // High-affinity α1+/γ2− ECD BZD site: flumazenil on its own experimental pose (6D6U);
    // other BZD-site ligands on the diazepam pose (DZP, chain D 2001) as template; empty → grey ghost
    const occ = bzdOccupant(currentState);
    const dzpSel = { resn: 'DZP', chain: 'D', resi: 2001 };
    if (fluModel) fluModel.setStyle({}, occ.kind === 'flumazenil' ? ballStick(PALETTE.flu) : {});
    if (occ.kind === 'flumazenil') baseModel.setStyle(dzpSel, {});
    else if (occ.kind === 'bzd') baseModel.setStyle(dzpSel, ballStick(occ.drug.color || bzColor));
    else baseModel.setStyle(dzpSel, { stick: { color: '#ced4da', radius: 0.15 } });

    // Pocket residues around the BZD site (alpha1 His102, Tyr160, Thr206; gamma2 Phe77)
    if (!hasSurface) {
      baseModel.setStyle({ chain: 'D', resi: [160, 206] }, { stick: { color: '#868e96', radius: 0.2 } }, true);
      baseModel.setStyle({ chain: 'C', resi: [77] }, { stick: { color: '#868e96', radius: 0.2 } }, true);
    }

    addMoleculeLabels(drug, ligKey, gabaOn);
    addSubunitLabels();
    updateLigandDensity();

    // Low-affinity TMD diazepam sites (DZP in chains B & E)
    baseModel.setStyle({ resn: 'DZP', chain: ['B', 'E'] }, hasSurface ? {} : {
      stick: { color: '#b197fc', radius: 0.18 },
    });

    // Style the dynamic M2 pore model
    styleM2Model();
  }

  /** Floating 3D labels so the molecules are human-understandable */
  /** Text labels in the 3D view use the app font and --fs-small (TYPOGRAPHY.md) */
  function labelFont() { return window.BZD.plotFont(); }
  function addMoleculeLabels(drug, ligKey, gabaOn) {
    if (!viewer || !geom) return;
    viewer.removeAllLabels();
    ionLabels = [];
    arrowLabels = [];
    const base = {
      font: labelFont().family, fontSize: labelFont().size, fontColor: '#111827', fontOpacity: 1,
      backgroundColor: '#ffffff', backgroundOpacity: 0.8,
      borderColor: '#adb5bd', borderThickness: 1, showBackground: true,
      inFront: true,
    };
    const off = (p, dx, dz) => ({ x: p.x + dx, y: p.y, z: p.z + dz });
    const occ = bzdOccupant(currentState);
    const bzdName = occ.kind ? occ.drug.name : BZD.t('st.empty');
    const iso = isoInfo();
    viewer.addLabel(BZD.t('st.bzdSite', { iso: iso.label, name: bzdName }),
      Object.assign({}, base, { position: off(geom.bzdCentroid, 0, 9), borderColor: drug?.color || PALETTE.bzd }));
    // Determinant residue at the α1 His102 position (His101, rat numbering): His in α1/2/3/5, Arg in α4/α6
    const his = baseModel.selectedAtoms({ chain: 'D', resi: 102, resn: 'HIS' });
    if (his.length) {
      const c = his.reduce((acc, a) => ({ x: acc.x + a.x / his.length, y: acc.y + a.y / his.length, z: acc.z + a.z / his.length }), { x: 0, y: 0, z: 0 });
      viewer.addLabel(BZD.t(iso.bzdSensitive ? 'st.residueRat' : 'st.residueInsens', { iso: iso.label, res: iso.residue }),
        Object.assign({}, base, { position: off(c, 0, -6), borderColor: iso.bzdSensitive ? PALETTE.his102 : '#c92a2a' }));
    }
    if (gabaOn) {
      const abu = baseModel.selectedAtoms({ resn: 'ABU' });
      const byChain = {};
      abu.forEach(a => { (byChain[a.chain] = byChain[a.chain] || []).push(a); });
      Object.values(byChain).slice(0, 2).forEach((arr, i) => {
        const c = { x: 0, y: 0, z: 0 };
        arr.forEach(a => { c.x += a.x; c.y += a.y; c.z += a.z; });
        c.x /= arr.length; c.y /= arr.length; c.z /= arr.length;
        viewer.addLabel(BZD.t('st.gabaSite', { n: i + 1 }),
          Object.assign({}, base, { position: off(c, 0, 8), borderColor: PALETTE.gaba }));
      });
    }
    viewer.addLabel(BZD.t('st.gate'),
      Object.assign({}, base, { position: off(geom.gateCentroid, 0, 14), borderColor: PALETTE.gate }));
  }

  function styleM2Model() {
    if (!m2Model) return;
    if (hasSurface) { m2Model.setStyle({}, {}); return; }   // density-map mode: no ribbons
    m2Model.setStyle({}, { cartoon: { color: PALETTE.gate, opacity: 0.95 } });
    if (cutChains.length) m2Model.setStyle({ chain: cutChains }, {});
    m2Model.setStyle({ chain: ['A', 'D'] }, { cartoon: { color: chainColor('A'), opacity: 0.92 } });
    m2Model.setStyle({ chain: ['B', 'E'] }, { cartoon: { color: PALETTE.beta, opacity: 0.92 } });
    m2Model.setStyle({ chain: 'C' }, { cartoon: { color: PALETTE.gamma, opacity: 0.92 } });
    if (cutChains.length) m2Model.setStyle({ chain: cutChains }, {});

    // 9′ Leucine gate side chains (form the hydrophobic constriction)
    Object.entries(GATE_LEU).forEach(([ch, resi]) => {
      m2Model.setStyle({ chain: ch, resi }, { stick: { color: '#f59f00', radius: 0.28 } }, true);
      // 2′ Threonine polar constriction (3 residues toward intracellular)
      m2Model.setStyle({ chain: ch, resi: resi - 7 }, { stick: { color: '#20c997', radius: 0.22 } }, true);
    });
  }

  /**
   * Set a side view of the receptor (extracellular at top, cytoplasm at bottom)
   */
  let isSideView = false;
  let faceSign = 1;   // which way to spin the pentamer so the BZD pocket faces the camera (checked visually)
  /** viewer.translate() moves the camera's look-at point, which setView/zoomTo do not reset:
   *  return it to the origin so preset views do not accumulate earlier shifts */
  function resetLookAt() {
    if (viewer && viewer.lookingAt && viewer.camera) { viewer.lookingAt.set(0, 0, 0); viewer.camera.lookAt(viewer.lookingAt); }
  }

  function setSideView() {
    if (!viewer) return;
    resetLookAt();
    viewer.setView([0, 0, 0, 0, 0, 0, 0, 1]);
    viewer.zoomTo();
    // Tip so the pore axis points up (extracellular on top), tilted ~18° toward the viewer…
    viewer.rotate(108, 'x');
    // …then spin about the pore axis (3Dmol composes in the model frame) so the α1+/γ2− BZD pocket faces the viewer
    if (geom) {
      const phi = Math.atan2(geom.bzdCentroid.y - geom.axis.y, geom.bzdCentroid.x - geom.axis.x) * 180 / Math.PI;
      viewer.rotate(faceSign * (90 - phi), 'z');
    }
    // Fill the viewer at 1×: full size on desktop, scaled down on narrow (mobile) viewers so the
    // whole receptor, nanodisc and vestibule fit the width
    const vw = document.getElementById('mol-viewer')?.clientWidth || 640;
    viewer.zoom(1.5 * Math.min(1, Math.max(0.9, vw / 620)));
    viewer.translate(0, vw < 500 ? 34 : 16);   // shift up (screen px) so the hint pill (two lines on mobile) does not cover the pore exit
    isSideView = true;
    zoomRef = viewer.CAMERA_Z - viewer.getView()[3];
    syncZoomSlider();
    viewer.render();
  }


  /**
   * Animation loop: modulates M2 pore gating, allosteric conduit pulses,
   * and chloride ion permeation based on the current pharmacological state.
   */
  function startAnimationLoop() {
    if (animId) cancelAnimationFrame(animId);

    function step(timestamp) {
      if (!lastTime) lastTime = timestamp;
      const dt = (timestamp - lastTime) / 1000;
      lastTime = timestamp;

      if (loaded && viewer && isAnimating && isVisible && !document.hidden) {
        renderFrame(timestamp / 1000, dt);
      }
      animId = requestAnimationFrame(step);
    }
    animId = requestAnimationFrame(step);
  }

  /**
   * Render a single frame of dynamic gating
   * @param {number} t - time in seconds
   */
  function renderFrame(t, dt) {
    if (!geom || !m2Model) return;
    dt = Math.min(0.1, Math.max(0, dt || 0));   // avoid jumps after the tab was hidden

    const state = currentState || (window.Receptor ? window.Receptor.getState() : null);
    if (!state) return;

    const po = state.po || 0;
    const gabaBound = state.gaba > 0;
    const ligKey = state.ligandKey || 'diazepam';
    const drug = ligKey !== 'none' ? window.BZD.drugs[ligKey] : null;
    const isPAM = drug && drug.pd && (drug.pd.kind === 'PAM' || drug.pd.kind === 'Partial PAM');
    const isNAM = drug && drug.pd && drug.pd.kind === 'Inverse agonist';
    const isAntag = drug && drug.pd && drug.pd.kind === 'Antagonist';

    // Stochastic single-channel gating by the kinetic (Markov) scheme (Models.kineticStep): GABA
    // binding, three open states with bursts of brief closures, and desensitisation, in real time
    // slowed GATE.slowdown-fold. A BZD-site ligand
    // speeds GABA association by its EC50 shift (more frequent openings, unchanged open durations);
    // flumazenil returns gating to that of GABA alone. Without agonist the channel stays closed.
    // GABA cycles between application and washout so that activation, desensitisation, deactivation
    // and recovery all recur (under sustained GABA the channel would stay desensitised ~90% of the time).
    gabaClock = (gabaClock + dt / GATE.slowdown) % (GATE.gabaOn_s + GATE.gabaOff_s);
    gabaPhaseOn = gabaClock < GATE.gabaOn_s;
    kinState = Models.kineticStep(kinState, dt / GATE.slowdown, gabaBound && gabaPhaseOn ? state.gaba : 0, (state.bzdCalc && state.bzdCalc.shift) || 1);
    // The gate is drawn per burst: open states and the brief closures within a burst (C5-C10) count
    // as open, held for at least GATE.burstHold, because single openings (ms) are too brief to draw.
    burstLeft = Models.KIN_BURST.includes(kinState) ? GATE.burstHold : Math.max(0, burstLeft - dt);
    gateIsOpen = burstLeft > 0;
    const desensitised = !gateIsOpen && Models.KIN_DES.includes(kinState);
    const inOpen = gateIsOpen;                                          // conducting state
    // Live 9′ gate state in the status panel (follows each stochastic opening and closing)
    const gateEl = document.getElementById('mol-gate-state');
    if (gateEl) {
      const label = BZD.t(inOpen ? 'st.open' : desensitised ? 'st.desensitised' : 'st.closed');
      if (gateEl.textContent !== label) gateEl.textContent = label;
      gateEl.style.color = inOpen ? '#2b8a3e' : desensitised ? '#e8590c' : '#868e96';
    }
    const phaseEl = document.getElementById('mol-gaba-phase');
    if (phaseEl && gabaBound) {
      const ph = BZD.t(gabaPhaseOn ? 'st.phaseOn' : 'st.phaseOff');
      if (phaseEl.textContent !== ph) phaseEl.textContent = ph;
    }
    // visual dilation of the M2 helices follows the gate with a short (~80 ms) time constant
    gateVis += ((inOpen ? 1 : 0) - gateVis) * Math.min(1, dt / 0.08);
    const gateOpen = gateVis;

    // 1. Displace M2 helix atoms radially outward at the 9′ gate
    displaceM2Helices(gateOpen);

    // 2. Clear old dynamic shapes (conduit, ions, halos) and re-draw for this frame
    dynShapes.forEach(sh => viewer.removeShape(sh));
    dynShapes = [];

    // 3. Draw Allosteric Conduction Pathway (wave travels from BZD site to pore gate)
    // (skipped when the cut-open view has removed chain D, the α1 that carries the signal)
    if (bzdOccupant(state).kind === 'bzd' && !isAntag && geom.path && geom.path.length > 2 && !cutChains.includes('D')) {
      drawAllostericConduit(t, isPAM, isNAM);
    } else {
      arrowLabels.forEach(l => l.hide());
    }

    // 4. Draw Chloride Ion Permeation Stream along the pore axis
    if (gabaBound) {
      drawChlorideStream(dt, gateOpen, po, inOpen);
    } else {
      ions = [];                       // no agonist, no permeation
      ionLabels.forEach(l => l.hide());
    }

    // 5. 9′ gate indicator ring - ribbons view only (the density map itself opens and closes)
    if (!hasSurface) drawGateRing(gateOpen);


    viewer.render();
  }

  /**
   * Displace M2 atoms outward from the pore axis to simulate open-pore dilation.
   * Dilation peaks at the 9′ gate (z ≈ 157 Å) and tapers to 0 at the helix ends.
   */
  const isM2Atom = (a) => {
    const g = GATE_LEU[a.chain];
    return g !== undefined && a.resi >= g - 14 && a.resi <= g + 13;
  };

  /** M2 coordinates for a given gate opening: radial widening peaking at the 9′ gate, slight twist */
  function m2Positions(openFraction, gain = 1) {
    const maxDilation = 3.2 * gain * openFraction; // Å radial widening (exaggerated in the density map)
    const twist = 0.045 * openFraction;     // radians helical rotation
    const { x: ax, y: ay } = geom.axis, zGate = geom.zRange.zGate;
    return m2AtomsOrig.map(orig => {
      const dz = orig.z - zGate;
      const weight = Math.exp(-(dz * dz) / 85.0);   // Gaussian envelope (half-width ≈ 9 Å)
      const dx = orig.x - ax, dy = orig.y - ay, r = Math.hypot(dx, dy) || 1.0;
      const rNew = r + maxDilation * weight, theta = Math.atan2(dy, dx) + twist * weight;
      return { x: ax + rNew * Math.cos(theta), y: ay + rNew * Math.sin(theta), z: orig.z, chain: orig.chain, elem: orig.elem };
    });
  }

  function displaceM2Helices(openFraction) {
    if (hasSurface) { updateM2Density(openFraction); return; }
    const atoms = m2Model.selectedAtoms({});
    if (atoms.length !== m2AtomsOrig.length) return;
    m2Positions(openFraction).forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; atoms[i].z = p.z; });
    // Rebuild M2 cartoon & stick geometry with new atom coordinates
    styleM2Model();
  }

  /**
   * Density-map mode: the pore-lining M2 helices are contoured as their own
   * small maps and re-contoured as they dilate, so the map itself opens and
   * closes (throttled to ~8 updates/s; each update is a few ms).
   */
  function updateM2Density(openFraction, force) {
    if (!viewer || !hasSurface || !m2AtomsOrig.length) return;
    const now = performance.now();
    if (!force && (Math.abs(openFraction - m2Open) < 0.04 || now - m2Time < 120)) return;
    m2Open = openFraction; m2Time = now;
    const pos = m2Positions(openFraction, 1.8).filter(p => p.elem !== 'H');
    RECEPTOR.forEach(ch => {
      if (m2DensityShapes[ch]) viewer.removeShape(m2DensityShapes[ch]);
      delete m2DensityShapes[ch];
      if (cutChains.includes(ch)) return;
      const atoms = pos.filter(p => p.chain === ch);
      if (!atoms.length) return;
      const c = chainColor(ch);
      m2DensityShapes[ch] = viewer.addIsosurface(gaussianVolume(atoms, 5), {
        isoval: MAP.iso, smoothness: MAP.smooth, opacity: 1, color: ch === selectedChain ? lighten(c, 0.22) : c,
      });
    });
  }

  /**
   * Allosteric signal: a train of chevron arrows travelling from the α1+/γ2− pocket
   * via the Cys-loop / M2-M3 linker to the 9′ gate. Drawn in front of the map like
   * the Cl⁻ ions, oriented along the path on screen, scaled with zoom; opaque in the
   * pocket and translucent once the path runs through the protein.
   */
  let arrowLabels = [];
  const arrowImgs = {};
  function arrowImage(color) {
    if (arrowImgs[color]) return arrowImgs[color];
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const chevron = () => { g.beginPath(); g.moveTo(9, 6); g.lineTo(22, 16); g.lineTo(9, 26); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    chevron(); g.lineWidth = 9; g.strokeStyle = '#ffffff'; g.stroke();
    chevron(); g.lineWidth = 5; g.strokeStyle = color; g.stroke();
    return (arrowImgs[color] = c);
  }
  function arrowLabel(color) {
    const label = viewer.addLabel('', {
      position: geom.bzdCentroid, inFront: true, showBackground: false,
      backgroundImage: arrowImage(color), backgroundWidth: 32, backgroundHeight: 32,
      fontSize: 19, alignment: 'center',
    });
    if (label.sprite && label.sprite.material) label.sprite.material.transparent = true;
    label.arrowColor = color;
    return label;
  }

  function drawAllostericConduit(t, isPAM, isNAM) {
    const pts = geom.path;
    const color = isNAM ? '#e03131' : PALETTE.signal;
    const N = 5;
    if (arrowLabels.length && arrowLabels[0].arrowColor !== color) { arrowLabels.forEach(l => viewer.removeLabel(l)); arrowLabels = []; }
    while (arrowLabels.length < N) arrowLabels.push(arrowLabel(color));
    const zoom = zoomRef ? zoomRef / Math.max(1e-3, viewer.CAMERA_Z - viewer.getView()[3]) : 1;
    const speed = isNAM ? 0.25 : 0.45;   // path traversals per second
    const at = (f) => {
      const x = f * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(x)), u = x - i;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u, z: pts[i].z + (pts[i + 1].z - pts[i].z) * u };
    };
    arrowLabels.forEach((label, k) => {
      const f = (t * speed + k / N) % 1.0;
      const p = at(f), q = at(Math.min(1, f + 0.03));
      const [sp, sq] = viewer.modelToScreen([p, q]);
      label.sprite.position.set(p.x, p.y, p.z);
      label.sprite.rotation = -Math.atan2(sq.y - sp.y, sq.x - sp.x);
      const sc = 0.42 * zoom;
      label.sprite.scale.set(sc, sc, 1);
      // opaque in the pocket (first ~15% of the path), translucent through the protein; fade in/out at the ends
      const inside = Math.min(1, Math.max(0, (f - 0.1) / 0.12));
      const ends = Math.min(1, f / 0.05, (1 - f) / 0.08);
      if (label.sprite.material) label.sprite.material.opacity = (1 - 0.5 * inside) * ends;
      label.show();
    });
  }



  /**
   * Chloride ions streaming down the pore axis, from above the extracellular
   * vestibule into the cytoplasm: cyan discs with a white rim, drawn in front of
   * the map. Their size follows the zoom level continuously (sprite scale), and
   * they fade smoothly to translucent and slightly smaller while buried in the
   * pore (fully opaque in the cut-open view, where the pore is exposed).
   */
  let ionLabels = [];
  let ionImg = null;
  // Gating / permeation constants (visual time scale)
  const GATE = {
    slowdown: 20,      // animation time = 20 × real time (open times of ms become visible bursts; desensitised periods stay watchable)
    gabaOn_s: 0.2,     // s real time: GABA applied at the selected concentration …
    gabaOff_s: 0.3,    // … then washed out, repeating (activation, desensitisation, deactivation and recovery)
    burstHold: 0.3,    // s animation time the gate is drawn open after the last moment in a burst (bursts stay visible)
    transit: 4.5,      // s for an ion to cross the full stream path (constant in every condition)
    arrival: 3.0,      // mean ions/s reaching the gate at the reference flux (mature neuron, default Vm; Poisson)
    maxRate: 4,        // visual arrival rate capped at 4× the reference (larger fluxes shown at the cap)
    returnTime: 0.9,   // s for an ion turned back by the closed gate to fade into the bath
    maxIons: 24,
  };
  let ions = [];
  let nextArrival = 0;      // s until the next Cl⁻ ion enters the vestibule (Poisson process)
  let ionSeq = 0;
  let gateIsOpen = false, gateVis = 0, kinState = 0, gabaClock = 0, gabaPhaseOn = true, burstLeft = 0;   // kinState: index in Models.KIN_STATES (0 = C1, unbound)
  const ionStats = { entered: 0, passed: 0, returned: 0, time: 0 };
  const ION_PX = 32;                 // texture resolution
  const ION_BASE = 15;               // on-screen diameter (px) at zoom 1×
  function ionImage() {
    if (ionImg) return ionImg;
    const c = document.createElement('canvas');
    c.width = c.height = ION_PX;
    const g = c.getContext('2d'), r = ION_PX / 2;
    const grad = g.createRadialGradient(r * 0.7, r * 0.65, r * 0.1, r, r, r);
    grad.addColorStop(0, '#a5ecf6');
    grad.addColorStop(0.55, PALETTE.cl);
    grad.addColorStop(1, '#1098ad');
    g.beginPath(); g.arc(r, r, r - 2.5, 0, Math.PI * 2);
    g.fillStyle = grad; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = '#ffffff'; g.stroke();
    return (ionImg = c);
  }
  function ionLabel() {
    const label = viewer.addLabel('', {
      position: { x: geom.axis.x, y: geom.axis.y, z: geom.zRange.zMin }, inFront: true, showBackground: false,
      backgroundImage: ionImage(), backgroundWidth: ION_PX, backgroundHeight: ION_PX,
      fontSize: Math.round((ION_PX - 8) / 1.25), alignment: 'center',
    });
    if (label.sprite && label.sprite.material) label.sprite.material.transparent = true;
    return label;
  }

  /**
   * Cl⁻ permeation as a particle stream driven by the GHK model:
   *  - every ion moves at the same speed (BZDs do not change single-channel conductance);
   *  - ions reach the gate as a Poisson process at a rate proportional to the net Cl⁻ flux
   *    through an open channel (GHK, at the selected Vm and intracellular Cl⁻): from the
   *    extracellular side when Cl⁻ flows in, from the cytoplasm when it flows out, and none at
   *    E_Cl, where the unidirectional fluxes balance (only net flux is drawn);
   *  - an ion that reaches the open 9′ gate passes; one that reaches the closed gate turns back.
   *    Ions do not queue, so no backlog passes when the gate next opens;
   *  - arrivals at random times find the gate open a fraction Po of the time, so mean flux
   *    scales with Po (it rises with a PAM only insofar as Po rises; flumazenil returns it to
   *    the GABA-alone level, it does not block the pore).
   * Time and counts are scaled (visualScale): a real open channel conducts ~10⁵-10⁶ ions/s.
   */
  /** Real Cl⁻ ions/s represented by 1 displayed ion/s (reference: mature neuron at the default Vm) */
  const visualScale = () => Math.abs(Models.CL_CHANNEL.ionsPerS) / GATE.arrival;
  function drawChlorideStream(dt, gateOpen, po, inOpen) {
    const ax = geom.axis.x;
    const ay = geom.axis.y;
    const { zMin, zMax, zGate } = geom.zRange;
    const zExt = zMin - 14;   // above the ECD vestibule
    const zInt = zMax + 10;   // below the TMD, into the cytoplasm
    const v = (zInt - zExt) / GATE.transit;           // Å per second, identical in every condition
    const open = !!inOpen;
    const zoom = zoomRef ? zoomRef / Math.max(1e-3, viewer.CAMERA_Z - viewer.getView()[3]) : 1;
    const smooth = (e0, e1, x) => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
    const ch = (currentState && currentState.channel) || Models.CL_CHANNEL;
    const dir = ch.ionsPerS >= 0 ? 1 : -1;            // +1 influx (downwards), −1 efflux (upwards)
    const rate = Math.min(GATE.arrival * GATE.maxRate, Math.abs(ch.ionsPerS) / visualScale());

    ionStats.time += dt;
    // entry: Poisson arrivals at a mean rate proportional to the net flux (exponential inter-arrival times)
    if (rate < 1e-3) nextArrival = Math.max(nextArrival, 0.5);
    else {
      nextArrival -= dt;
      while (nextArrival <= 0) {
        if (ions.length < GATE.maxIons) { ions.push({ z: dir > 0 ? zExt : zInt, dir, seed: (ionSeq++ * 2.399) % (Math.PI * 2), back: 0 }); ionStats.entered++; }
        nextArrival += -Math.log(1 - Math.random()) / rate;
      }
    }

    for (const ion of ions) {
      if (ion.back) {                                  // turned back: drift to its own side and fade
        ion.back += dt;
        ion.z -= ion.dir * 0.5 * v * dt;
        continue;
      }
      const z = ion.z + ion.dir * v * dt;
      if ((ion.z - zGate) * (z - zGate) <= 0 && z !== ion.z) {
        if (!open) { ion.z = zGate; ion.back = 1e-6; ionStats.returned++; continue; }   // closed gate: returns, does not wait
        ionStats.passed++;
      }
      ion.z = z;
    }
    ions = ions.filter(ion => ion.back < GATE.returnTime);
    ions = ions.filter(ion => ion.z >= zExt && ion.z <= zInt);

    while (ionLabels.length < GATE.maxIons) ionLabels.push(ionLabel());
    ionLabels.forEach((label, i) => {
      const ion = ions[i];
      if (!ion) { label.hide(); return; }
      const wob = 0.6 + gateOpen * 0.8;
      // depth inside the protein (Å): 0 at the pore mouths, ramps to 1 over ~8 Å
      const inside = isCut ? 0 : smooth(0, 8, Math.min(ion.z - zMin, zMax - ion.z));
      const sc = (ION_BASE / ION_PX) * zoom * (1 - 0.25 * inside);
      label.sprite.position.set(ax + wob * Math.sin(ion.z * 0.13 + ion.seed), ay + wob * Math.cos(ion.z * 0.11 + ion.seed), ion.z);
      label.sprite.scale.set(sc, sc, 1);
      const fade = ion.back ? 1 - ion.back / GATE.returnTime : 1;
      if (label.sprite.material) label.sprite.material.opacity = (1 - 0.6 * inside) * fade;
      label.show();
    });
  }


  /** Draw a circular indicator at the 9′ gate */
  function drawGateRing(gateOpen) {
    const ax = geom.axis.x;
    const ay = geom.axis.y;
    const z = geom.zRange.zGate;
    const r = 2.8 + gateOpen * 2.4;
    const color = PALETTE.gateRing;

    // Ring approximated as a set of small spheres
    const segments = 12;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      dynShapes.push(viewer.addSphere({
        center: { x: ax + r * Math.cos(a), y: ay + r * Math.sin(a), z },
        radius: 0.5,
        color: color,
        opacity: 0.6,
      }));
    }
  }

  /** Update the live status panel below the 3D viewer */
  function updateStatus() {
    const panel = document.getElementById('mol-status');
    if (!panel) return;

    const s = currentState || (window.Receptor ? window.Receptor.getState() : null);
    if (!s) {
      panel.innerHTML = `<span class="muted">${BZD.t('st.awaiting')}</span>`;
      return;
    }

    const ligKey = s.ligandKey || 'none';
    const drug = ligKey !== 'none' ? window.BZD.drugs[ligKey] : null;
    const shift = (s.bzdCalc && s.bzdCalc.shift) || 1.0;
    const po = s.po || 0;
    const gaba = s.gaba || 0;
    // Kinetic scheme during sustained GABA: peak and steady-state Po, with the ligand and for GABA alone
    const kin = Models.kineticSummary(gaba, shift), kinGaba = Models.kineticSummary(gaba, 1);
    const occD = ((s.bzdCalc && s.bzdCalc.occD) || 0) * 100;

    let modeBadge = '';
    let modeText = '';

    if (ligKey === 'none') {
      modeBadge = `<span class="mol-status-pill" style="background:#868e96">${BZD.t('st.noLigand')}</span>`;
      modeText = BZD.t('st.gabaAlone');
    } else if (drug && drug.pd && drug.pd.kind === 'Antagonist') {
      modeBadge = `<span class="mol-status-pill" style="background:#fa5252">${BZD.t('st.antagonist')}</span>`;
      modeText = BZD.t('st.antagonistText', { occ: BZD.fmt(occD) });
    } else if (drug && drug.pd && drug.pd.kind === 'Inverse agonist') {
      modeBadge = `<span class="mol-status-pill" style="background:#e03131">${BZD.t('st.nam')}</span>`;
      modeText = BZD.t('st.namText');
    } else if (drug && occD < 5 && s.fluOn && (s.bzdCalc?.occF || 0) > 0.5) {
      const occF = BZD.fmt(s.bzdCalc.occF * 100);
      modeBadge = `<span class="mol-status-pill" style="background:#fa5252">${BZD.t('st.displaced', { drug: drug.name, flu: window.BZD.drugs.flumazenil.name.toLowerCase() })}</span>`;
      modeText = BZD.t('st.displacedText', { flu: window.BZD.drugs.flumazenil.name, occ: occF, drug: drug.name.toLowerCase() });
    } else if (drug && occD < 5) {
      const iso = window.BZD.subtypes[s.subKey || 'a1'];
      modeBadge = `<span class="mol-status-pill" style="background:#868e96">${BZD.t('st.notBound', { drug: drug.name })}</span>`;
      modeText = BZD.t('st.notBoundText', { drug: drug.name, iso: iso.label, why: iso.bzdSensitive ? BZD.t('st.atThisConc') : BZD.t('st.atHis', { res: iso.residue.split(' (')[0] }) });
    } else {
      modeBadge = `<span class="mol-status-pill" style="background:${drug?.color || 'var(--accent)'}">${drug?.name} · ${BZD.t('kind.' + (drug?.pd?.kind || 'PAM'))}</span>`;
      modeText = BZD.t('st.pamText', { occ: BZD.fmt(occD) });
    }

    // Cl⁻ flux and reversal potentials at the selected Vm and intracellular Cl⁻ (GHK; see Models.clChannel)
    const ch = s.channel || Models.CL_CHANNEL, sc = window.BZD.model.singleChannel;
    const mV = (x) => BZD.fmt(x, 1).replace('-', '−');
    const sig2 = (x) => x.toLocaleString(BZD.lang === 'sv' ? 'sv-SE' : 'en-GB', { maximumSignificantDigits: 2 });
    const clTip = BZD.t('st.clTip', { g: sc.conductance_pS, sym: sc.symmetricCl_mM, out: sc.clOut_mM, inn: ch.clIn_mM, vm: BZD.fmt(ch.vm_mV).replace('-', '−'), ecl: mV(ch.eCl_mV), i: BZD.fmt(ch.iCl_pA, 3).replace('-', '−'), fin: sig2(ch.clInPerS), fout: sig2(ch.clOutPerS) });
    const balanced = Math.abs(ch.ionsPerS) < 0.02 * Math.max(ch.clInPerS, ch.clOutPerS);   // Vm ≈ E_Cl
    const dirKey = balanced ? 'st.flux.none' : (ch.ionsPerS > 0 ? 'st.flux.in' : 'st.flux.out');
    const dV = ch.vm_mV - ch.eGABA_mV;
    const effectKey = Math.abs(dV) < 3 ? 'st.effect.shunt' : (dV > 0 ? 'st.effect.hyper' : 'st.effect.depol');
    const revTip = BZD.t('st.revTip', { ehco3: mV(ch.eHCO3_mV), hin: sc.hco3In_mM, hout: sc.hco3Out_mM, p: BZD.fmt(sc.pHCO3_pCl, 2) });
    // Right of the viewer: gating state, live gate (animation) and kinetic Po
    panel.innerHTML = `
      <div class="mol-status-head">
        <div>
          <b>${BZD.t('st.gatingState')}</b> ${drug ? drug.name : BZD.t('st.gabaAloneShort')}
          ${s.fluOn ? ` <span class="flu-tag">+ ${window.BZD.drugs.flumazenil.name}</span>` : ''}
        </div>
        ${modeBadge}
      </div>
      <div class="mol-status-metrics">
        <div class="mol-status-m">
          <span>${BZD.t('st.gateShort')}</span>
          <b id="mol-gate-state">${BZD.t(gateIsOpen ? 'st.open' : Models.KIN_DES.includes(kinState) ? 'st.desensitised' : 'st.closed')}</b>
          <small id="mol-gaba-phase">${gaba > 0 ? BZD.t(gabaPhaseOn ? 'st.phaseOn' : 'st.phaseOff') : BZD.t('st.noGabaApplied')}</small>
          <small>${BZD.t('st.cycle', { slow: GATE.slowdown, on: BZD.fmt(GATE.gabaOn_s, 1), off: BZD.fmt(GATE.gabaOff_s, 1) })}</small>
        </div>
      </div>
      <div class="mol-status-note">${modeText}</div>
      ${s.subKey && s.subKey !== 'a1' ? `<div class="mol-template-note">${BZD.t('st.template', { iso: window.BZD.subtypes[s.subKey].label })}</div>` : ''}
    `;

    // Kinetics card (left frame): Cl⁻ flux and reversal potentials at the selected Vm and Cl⁻
    const kinPanel = document.getElementById('kin-status');
    if (kinPanel) kinPanel.innerHTML = `
      <div class="mol-status-metrics">
        <div class="mol-status-m full" title="${BZD.t('st.clTitle', { tip: clTip })}">
          <span>${BZD.t('st.clNetFlux')}</span>
          <b style="color:#0b7285">≈ ${balanced || !kin.peak ? 0 : `${sig2(Math.abs(kin.peak * ch.ionsPerS))} → ${sig2(Math.abs(kin.steady * ch.ionsPerS))}`} ${BZD.t('st.ionsPerS')} · ${BZD.t(dirKey)}</b>
          <small>${kin.peak ? `${BZD.t('st.peakToSteady')} · ${BZD.t('st.relGaba', { r: BZD.fmt(kin.peak / kinGaba.peak, 2), s: BZD.fmt(shift, 2) })}` : BZD.t('st.noAgonistClosed')}</small>
          <small>${BZD.t('st.animScale', { n: sig2(visualScale() / GATE.slowdown) })}${Math.abs(ch.ionsPerS) / visualScale() > GATE.arrival * GATE.maxRate ? BZD.t('st.animCap') : ''}</small>
        </div>
        <div class="mol-status-m full" title="${revTip}">
          <span>${BZD.t('st.reversal')}</span>
          <b>E<sub>Cl</sub> ${mV(ch.eCl_mV)} mV · E<sub>GABA</sub> ${mV(ch.eGABA_mV)} mV</b>
          <small>${BZD.t(effectKey, { vm: BZD.fmt(ch.vm_mV).replace('-', '−') })}</small>
        </div>
      </div>
    `;
  }

  /**
   * Called by Receptor module whenever sliders/dropdowns change
   */
  function setState(newState) {
    currentState = newState;
    const legend = document.getElementById('legend-alpha');
    if (legend) legend.innerHTML = `<i class="dot" style="background:${chainColor('A')}"></i>${isoInfo().label}`;
    if (loaded && viewer) {
      if (curSub() !== shownSub) {
        shownSub = curSub();
        if (hasSurface) { addChainDensity('A'); addChainDensity('D'); updateM2Density(Math.max(0, m2Open), true); }
      }
      // Restyle the structure only when what it shows changes (restyling all atoms is slow and would
      // stall the animation, e.g. while the membrane potential slider moves)
      const occ = bzdOccupant(newState);
      const sig = JSON.stringify([newState.gaba > 0, newState.ligandKey, occ.kind, occ.drug && occ.drug.name, curSub()]);
      if (sig !== styleSig) { styleSig = sig; applyStyling(); }
      if (!isAnimating) viewer.render();
    }
    updateStatus();
  }
  let styleSig = '';

  function attachButtons() {
    document.querySelectorAll('button[data-mol]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-mol');
        if (!viewer) {
          const container = document.getElementById('mol-viewer');
          if (container && !loaded) waitFor3Dmol(() => loadPdb(container));
          return;
        }

        switch (action) {
          case 'animate':
            isAnimating = !isAnimating;
            btn.textContent = BZD.t(isAnimating ? 'st.pause' : 'st.play');
            break;

          case 'reset':
            setSideView();
            break;

          case 'cut':
            setCut(!isCut);
            break;

          case 'side':
            setSideView();
            break;

          case 'top':
            // Look down the pore axis from the synaptic cleft (extracellular = −z in 6HUP)
            resetLookAt();
            viewer.setView([0, 0, 0, 0, 0, 0, 0, 1]);
            isSideView = false;
            viewer.zoomTo();
            viewer.rotate(180, 'x');
            syncZoomSlider();
            viewer.render();
            break;

          case 'gate':
            // Focus on the 9′ Leucine pore constriction (open the cut-away so it is visible)
            viewer.zoomTo({ resn: 'LEU', resi: [259, 264, 274], chain: ['A', 'B', 'C', 'D', 'E'] });
            viewer.zoom(0.45);
            if (!isCut) setCut(true);
            syncZoomSlider();
            viewer.render();
            break;

          case 'bzd':
            viewer.zoomTo({ resn: 'DZP', chain: 'D', resi: 2001 });
            viewer.zoom(0.3);
            syncZoomSlider();
            viewer.render();
            break;

          case 'tmd':
            viewer.zoomTo({ resn: 'DZP', chain: ['B', 'E'] });
            viewer.render();
            break;

          case 'gaba':
            viewer.zoomTo({ resn: 'ABU' });
            viewer.zoom(0.6);
            syncZoomSlider();
            viewer.render();
            break;

          case 'surface':
            toggleSurface();
            break;

        }
      });
    });
  }

  function toggleSurface() {
    if (!viewer) return;
    const btn = document.getElementById('mol-btn-surface');
    if (hasSurface) {
      removeDensityMap();
      applyStyling();
      if (btn) { btn.textContent = BZD.t('st.density'); btn.title = BZD.t('st.densityTip'); }
      viewer.render();
    } else {
      addDensityMap();
      applyStyling();
      viewer.render();
    }
  }

  /** Model-space unit vector pointing from the receptor toward the camera */
  function towardCamera() {
    const v = viewer.getView(), q = { x: -v[4], y: -v[5], z: -v[6], w: v[7] };   // inverse rotation
    const px = 0, py = 0, pz = 1;
    const ix = q.w * px + q.y * pz - q.z * py, iy = q.w * py + q.z * px - q.x * pz;
    const iz = q.w * pz + q.x * py - q.y * px, iw = -q.x * px - q.y * py - q.z * pz;
    const r = { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x };
    const l = Math.hypot(r.x, r.y, r.z) || 1;
    return { x: r.x / l, y: r.y / l, z: r.z / l };
  }

  /**
   * Cut-open view as in cryo-EM figures: remove the two subunits nearest the
   * camera (and the front half of the nanodisc) so the pore, gate and Cl⁻ ions
   * are visible inside a still-solid map. The cut stays fixed to the model.
   */
  function setCut(on) {
    const btn = document.getElementById('mol-btn-cut');
    isCut = on;
    if (on) {
      const n = towardCamera(), { x: ax, y: ay } = geom.axis;
      cutNormal = n;
      const score = RECEPTOR.map(ch => {
        const ca = baseModel.selectedAtoms({ chain: ch, atom: 'CA' });
        const c = ca.reduce((acc, a) => ({ x: acc.x + a.x, y: acc.y + a.y }), { x: 0, y: 0 });
        return { ch, d: (c.x / ca.length - ax) * n.x + (c.y / ca.length - ay) * n.y };
      }).sort((p, q) => q.d - p.d);
      cutChains = score.slice(0, 2).map(e => e.ch);
    } else {
      cutChains = [];
      cutNormal = null;
    }
    if (hasSurface) { RECEPTOR.forEach(addChainDensity); updateM2Density(Math.max(0, m2Open), true); }
    applyStyling();
    drawMembrane();
    if (btn) { btn.textContent = BZD.t(on ? 'st.surface' : 'st.sectional'); btn.title = BZD.t(on ? 'st.surfaceTip' : 'st.sectionalTip'); }
    viewer.render();
  }

  /** Zoom bar: level 1× = default view distance; kept in sync with mouse-wheel zoom */
  function attachZoomSlider() {
    const el = document.getElementById('mol-zoom');
    if (!el) return;
    el.addEventListener('input', () => {
      if (!viewer || !zoomRef) return;
      const level = Math.pow(2, parseFloat(el.value));
      const v = viewer.getView();
      v[3] = viewer.CAMERA_Z - zoomRef / level;
      viewer.setView(v);
      updateZoomLabel(level);
    });
  }

  function syncZoomSlider() {
    const el = document.getElementById('mol-zoom');
    if (!el || !viewer || !zoomRef) return;
    const level = zoomRef / Math.max(1e-3, viewer.CAMERA_Z - viewer.getView()[3]);
    el.value = Math.log2(level).toFixed(2);
    updateZoomLabel(level);
  }

  function updateZoomLabel(level) {
    const lbl = document.getElementById('mol-zoom-val');
    if (lbl) lbl.textContent = `${BZD.fmt(level, 1)}×`;
  }

  return { init, setState, toggleSurface, getViewer: () => viewer, getIonStats: () => ({ ...ionStats, active: ions.length }) };
})();
