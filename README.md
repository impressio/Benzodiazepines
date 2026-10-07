# Benzodiazepines & GABA<sub>A</sub> Receptor Interactive Pharmacology Web Application

An interactive web application exploring benzodiazepine (BZD) pharmacology, pharmacodynamics (allosteric modulation of GABA<sub>A</sub> receptor subunits), pharmacokinetics (ADME, multi-dose accumulation, active metabolites), administration routes, and Cryo-EM 3D structural biology.

All tables are implemented directly as **interactive web code** (HTML/CSS/JavaScript with real-time search, category filtering, and responsive design), rather than static images.

---

## 1. Quick Start & Local Server

To run the web application locally:

```bash
# From the project repository root:
python3 -m http.server 8000
```

Then open your browser to:
[http://localhost:8000](http://localhost:8000)

The application needs no build step to run: it is served as static files (standard ES6 JavaScript) with CDN libraries (Plotly.js, 3Dmol.js, three.js, KaTeX). The model files in `assets/models/` are pre-built by the scripts in `tools/` and committed, so the scripts are only needed when the underlying data change.

---

## 2. Web Application Architecture

**Correcting data:** all domain data are kept in `assets/data/properties.json` (units and meaning of each field in its `meta` section): drug names, classes, uses, molecular weights, SMILES, Kᵢ and cooperativity factors, pharmacokinetic and metabolite parameters, route absorption, onset and T<sub>max</sub>, route and drug-by-route clinical texts, α-subunit and other-subunit descriptions, metabolic pathways, patient-factor multipliers, regional abundance of the α isoforms, model parameters (gating, Cl⁻ flux, dose-effect figure, duration comparison) and the clinical substances table. `js/data.js` only loads this file. Edit a value and reload; the app and the data tables (`properties.html`) both use it. After changing a SMILES string, rebuild the structure drawings with `tools/.venv/bin/python tools/build_structures.py`.

**Sources and verification:** the same file lists the literature behind the data (`references`, each checked against PubMed or DailyMed) and, for each value, its references, the value reported in the source and a status (`sources`: consistent, differs, full text or model). Clinical pharmacokinetic values are taken from FDA labels where available and from the literature otherwise; receptor affinities from the IUPHAR/BPS Guide to Pharmacology, ChEMBL and the primary papers. Both appear as tables on the data page. `python3 tools/check_sources.py` re-checks the references, reports newer FDA label revisions and compares the Kᵢ values with Guide to Pharmacology and ChEMBL; it only reports and never edits the data.

**Model validation:** `validation` in the same file holds observed single-dose peak concentrations and times to peak in adults, split into a calibration set (FDA labels and primary studies, used to fit the absorption rate constants, status `calibrated`) and an independent validation set (other published studies, not used for fitting). The data page simulates each study with the app's PK model and plots predicted against observed values with 2-fold bands.

**Language, values and units:** the top bar has a settings button (e.g. "EN · US") with two choices, remembered in the browser and also settable in the address (`?lang=sv&region=eu`). Both are detected from the browser on the first visit: the language from its preferred languages, the region from the language and country (Swedish browser or interface → SE; en-US and non-European locales → US; other European locales such as en-GB → EU). Changing the language also selects that language's regional values and units; the region can then be changed on its own.
- *Language:* English or Swedish. Interface texts are in `assets/i18n/en.json` and `assets/i18n/sv.json` (`ui`, by key, used through `BZD.t()`); the `data` section of `sv.json` translates the descriptive texts of `properties.json` by path. Swedish uses FASS terminology, Swedish INN spellings and decimal commas. Static page text carries `data-i18n` keys.
- *Values and units:* US (base data: FDA prescribing information, US brand names, ng/mL), EU (values that differ in the EU summaries of product characteristics as published in FASS, Swedish product names and availability, µg/L; numerically equal to ng/mL) or SE (the EU values with plasma concentrations in nmol/L, as Swedish laboratories report serum benzodiazepine concentrations). The EU values are an overlay in `jurisdictions.eu.data` of `properties.json`, each with a FASS reference in `sources`; SE inherits them. Molar concentrations are converted per species with its molecular weight (nmol/L = ng/mL × 1000 / MW; metabolite weights from PubChem). The model validation and calibration always use the US base parameters.

**Running locally:** the app loads its model files with `fetch()`, which browsers block for pages opened directly from disk. Serve the folder instead: `python3 -m http.server` in the project folder, then open http://localhost:8000. (The live site at bzd.matty.se is served by GitHub Pages.)


The application is structured into 7 sections:

```
Benzodiazepines/
├── assets/
│   ├── data/
│   │   └── properties.json       # all domain data
│   ├── i18n/
│   │   ├── en.json               # English texts
│   │   └── sv.json               # Swedish texts
│   ├── icons/
│   │   ├── apple-touch-icon.png  # home-screen icon
│   │   └── favicon.ico           # browser icon
│   ├── images/
│   │   └── structures/           # 2D structure SVGs
│   └── models/                   # runtime model files
│       ├── 6HUP.pdb.gz           # receptor structure
│       ├── brain-2d.json         # 2D map layout
│       ├── brain-2d-*.png        # 2D map views
│       ├── brain-mesh.bin.gz     # 3D brain meshes
│       ├── brain-mesh.json       # 3D mesh index
│       └── NOTICE                # sources, licences
├── css/
│   ├── properties.css            # data tables page
│   ├── styles.css                # base layout
│   └── theme-figma.css           # Figma UI3 theme
├── js/
│   ├── brain3d.js                # 3D brain (three.js)
│   ├── data.js                   # data loader
│   ├── distribution.js           # regional distribution
│   ├── main.js                   # start-up, navigation
│   ├── model-files.js            # model file loader
│   ├── models.js                 # PD and PK models
│   ├── pd.js                     # PD plots
│   ├── pk.js                     # PK plots
│   ├── properties.js             # data tables page
│   ├── receptor.js               # mechanism controls
│   ├── routes.js                 # administration routes
│   ├── structure.js              # 3D receptor (3Dmol.js)
│   ├── substrates.js             # substances, metabolism
│   └── tex.js                    # KaTeX equations
├── tools/
│   ├── build_brain.py            # builds brain models
│   ├── check_sources.py          # checks data sources
│   ├── build_structures.py       # builds structure SVGs
│   └── requirements.txt          # pinned build packages
├── CLAUDE.md                     # Claude Code rules
├── CNAME                         # GitHub Pages domain
├── index.html                    # main app
├── LICENSE                       # all rights reserved
├── properties.html               # data tables
├── pyrightconfig.json            # Python type checking
├── README.md                     # this file
└── TYPOGRAPHY.md                 # typography rules
```

| Path | Description |
| --- | --- |
| `assets/data/properties.json` | Single source of all domain data: drugs, molecules, receptors, routes, regions and model parameters (units in its `meta` section) |
| `assets/i18n/` | Interface texts in English (`en.json`) and Swedish (`sv.json`, which also translates the descriptive texts of `properties.json` by path) |
| `assets/icons/` | Browser icon (`favicon.ico`, 16-64 px, receptor pentamer logo) and home-screen icon (`apple-touch-icon.png`, 180 px) |
| `assets/images/structures/` | 2D chemical structure drawings (`<drug>.svg`) and NOTICE, built by `tools/build_structures.py` |
| `assets/models/` | Model data fetched at runtime: receptor structure (PDB 6HUP), 2D map image sizes, label anchors and lateral views (left/right, with and without the translucent half), 3D brain meshes (compact binary) with their index and encoding; sources and licences in NOTICE |
| `css/properties.css` | Styles of the data tables page |
| `css/styles.css` | Base layout and components: responsive grid, cards, tables, plots, menu |
| `css/theme-figma.css` | Interface design (Figma UI3 style), layered on `styles.css` |
| `js/brain3d.js` | three.js 3D brain for the regional distribution map (translucent hemisphere) |
| `js/data.js` | Loader: `BZD.load()` reads `properties.json` and exposes it as `window.BZD` |
| `js/distribution.js` | Regional distribution viewer: stage, 3D/2D switch, 2D canvas map, region list |
| `js/main.js` | Start-up after data loading, selection sync, navigation and compact menu (labelled with the current section) |
| `js/model-files.js` | Loads files from `assets/models/` (fetch and built-in gzip decompression) |
| `js/models.js` | Pharmacodynamic (allosteric shift, kinetic Markov gating scheme, GHK Cl⁻ and HCO₃⁻ currents, reversal potentials) and pharmacokinetic (ODE simulation) models |
| `js/pd.js` | Plotly.js concentration-response, occupancy, selectivity and dose-effect plots |
| `js/pk.js` | Plotly.js plasma concentration-time profiles and derived parameter table |
| `js/properties.js` | Tables, search and filters of `properties.html` |
| `js/receptor.js` | Mechanism controls, receptor model state, header and badge, info panel and readouts |
| `js/routes.js` | Administration routes comparison, route detail card and table |
| `js/structure.js` | Rotatable 6HUP cryo-EM map (3Dmol.js): density, nanodisc, ligands, gating and Cl⁻ flow |
| `js/substrates.js` | Structure gallery, metabolic pathways and interactive substances table |
| `js/tex.js` | LaTeX equations rendered with KaTeX (plain-text fallback if unavailable) |
| `tools/build_brain.py` | Builds the brain model files from TemplateFlow (fsaverage pial/sulc, MNI152 2009c aseg) |
| `tools/check_sources.py` | Checks the references (PubMed), FDA label revisions (openFDA) and Kᵢ values (Guide to Pharmacology, ChEMBL) against `properties.json`; report only |
| `tools/build_structures.py` | Builds the structure SVGs from the SMILES in `properties.json` (RDKit) |
| `tools/requirements.txt` | Pinned Python packages for the two build scripts (numpy, scipy, RDKit) |
| `CLAUDE.md` | Instructions read by Claude Code (imports `TYPOGRAPHY.md`) |
| `CNAME` | Custom domain for GitHub Pages (bzd.matty.se) |
| `index.html` | Main single-page application |
| `LICENSE` | Copyright notice: all rights reserved; third-party components keep their own licences |
| `properties.html` | Searchable, filterable tables of all data in `properties.json` |
| `pyrightconfig.json` | Editor type checking: Python environment for `tools/` |
| `TYPOGRAPHY.md` | Typography rules: one font, size scale, tables equal body text, plots and canvas |

---

### Interface design

The interface follows Figma's UI3 conventions - canvas-grey background, flat white frames with 1 px borders, compact 32 px controls, segmented filters, and Figma blue reserved for selection. `css/styles.css` provides the base layout and components; `css/theme-figma.css` layers the design on top, scoped under `html[data-theme="figma"]`, which `index.html` sets permanently.

---

## 3. Interactive Features & Web Tables

### Section 01 · Allosteric Modulation at the Receptor
- **Rotatable cryo-EM structure (merged former section 07):** Flumazenil is shown in its own experimental pose (PDB 6D6U, superposed on the 6HUP pocket, 76 Cα, RMSD 0.69 Å); other BZD-site ligands use the diazepam pose as a template. Cl⁻ ions scale with zoom and fade to translucent inside the pore. PDB 6HUP (α1β3γ2 + diazepam + GABA) in 3Dmol.js - drag to rotate, scroll to zoom. Default look is a simulated cryo-EM map: Gaussian density (σ ≈ 1.5 Å) computed per chain from the atomic model and contoured as a segmented map coloured by subunit, with windows over the GABA and BZD pockets showing ball-and-stick ligands inside translucent ligand density, and a translucent lipid nanodisc around the TMD. Condition header (e.g. "+GABA & Diazepam") and gate badge follow the controls; in density-map mode the pore-lining M2 density is re-contoured as the gate opens (so the map itself changes shape), while ribbon mode shows the moving M2 helices and an amber 9′ gate ring; Cl⁻ ions (cyan dots, see-through while buried in the protein) stream through the pore, and translucent magenta arrows trace the allosteric signal from the BZD pocket to the gate across the map. Toolbar: reset, top view (from the synaptic cleft), surface view ⇄ sectional view (section through the pore axis, two front subunits removed), ribbons ⇄ density map, focus BZD pocket / GABA sites / 9′ gate, pause. Click a subunit, ligand or the pore for details.
- **Real-time readouts:** Displays BZD-site fractional occupancy ($\theta$), apparent GABA $EC_{50}$, fold leftward shift, and channel open probability.
- **Receptor kinetics:** the animated channel follows a 16-state kinetic (Markov) scheme of α1β3γ2L receptors (Haas & Macdonald 1999, rates as corrected in the 2004 erratum) with bursts and fast, intermediate and slow desensitisation, simulated stochastically with time slowed 20-fold while GABA cycles between application (0.2 s) and washout (0.3 s), with the gate drawn open per burst; a BZD-site ligand speeds GABA association by its EC<sub>50</sub> shift. The open probability readout gives the peak and steady-state P<sub>o</sub> of the scheme, and the panel next to the viewer the live gate state (open, closed, desensitised) and GABA phase. Below the viewer, a separate card holds the Cl⁻ flux frame (neuron type, membrane potential, flux and reversal potentials) and a plot of the open and desensitised fractions during sustained GABA (log time, GABA alone vs with the ligand).
- **Cl⁻ flux and reversal potentials:** neuron type (mature or immature, i.e. low or high intracellular Cl⁻) and membrane potential are adjustable; the single-channel Cl⁻ and HCO₃⁻ currents follow the GHK equations, the status panel gives the net Cl⁻ flux with its direction, E<sub>Cl</sub>, E<sub>GABA</sub> and whether the GABA current hyperpolarises, depolarises or mainly shunts, and the animated ions follow the net flux (direction and rate; none at E<sub>Cl</sub>) with the display scaling stated.

### Section 02 · Receptor Subunits & Clinical Effects
- **α subunits: clinical profile & occupancy** (moved here from Pharmacodynamics): α1-α6 cards with conserved residue (His vs Arg), phenotype, localization, Kᵢ and live BZD-site occupancy for the ligand/concentration set in section 05; click a card to simulate that isoform.
- **Other subunits:** β2/3, γ2 (required for BZD sensitivity) and δ (extrasynaptic, BZD-insensitive).
- **Regional distribution of α isoforms:** viewer stage laid out like the receptor viewer (title, stage with hint, isoform badge, zoom slider, floating toolbar: Reset · Top view · Front view · Left/Right translucent · 2D map/3D model, centred legend). **3D model** (three.js): real cortical anatomy (FreeSurfer fsaverage pial surfaces, shaded by sulcal depth) with one hemisphere translucent and the deep structures on that side semi-translucent, and deep structures segmented from the MNI152 2009c template (thalamus, striatum, hippocampus, amygdala, brainstem, cerebellum with rendered folia), plus approximated hypothalamus, olfactory bulbs and spinal cord. **2D map**: lateral views from either side rendered offline from the same meshes (z-buffered software render storing structure, shading and the translucent hemisphere per pixel; assets/models/brain-2d-*.png), coloured in the page on a canvas with atlas-style labels, so it needs no WebGL and is used automatically if 3D is unavailable. Structures are tinted by the relative abundance (absent, low, moderate, high) of the selected α isoform in the subunit-card colours over natural tissue colours, with hover details; α1-α6 buttons are synchronised with the global isoform selection and a ranked list gives regions and cell populations (after Pirker et al. 2000; Fritschy & Mohler 1995). Rebuild the assets with `tools/.venv/bin/python tools/build_brain.py`; the TemplateFlow source files (~2.5 MB) are downloaded automatically into `tools/.templateflow-cache/` on first run.

### Section 03 · Substances & 2D Chemistry
- Includes zopiclone (cyclopyrrolone Z-drug, non-selective across α1/2/3/5).
- **Interactive substances web table:**
  - Search by substance name, brand, indication, or pathway.
  - Class abbreviations with legend: **USA** ultra-short-, **SA** short-, **IA** intermediate-, **LA** long-acting, **Z** Z-drug, **PAR** partial agonist, **ANT** antagonist; filter pills for USA/SA, IA, LA, Z, ANT and the **LOT class**.
  - Shows elimination half-life ($t_{1/2}$), active metabolite status, oral bioavailability, and diazepam-equivalent dosages.
- **2D Chemical structures:** SVG drawings (`assets/images/structures/<drug>.svg`) pre-rendered with RDKit from the SMILES strings in `assets/data/properties.json` (standard 2D depiction, app atom colours, labels as paths). Rebuild with `tools/.venv/bin/python tools/build_structures.py` after editing a SMILES (one-time setup, shared by both scripts in `tools/`: `python3 -m venv tools/.venv && tools/.venv/bin/python -m pip install -r tools/requirements.txt`, pinned versions; `pyrightconfig.json` points the editor's type checker at this environment).
- **"LOT" rule highlight:** Lorazepam, Oxazepam, Temazepam undergo direct Phase II glucuronidation without active metabolites, making them preferred in hepatic cirrhosis and elderly patients.
### Section 04 · Administration Routes & Onset of Action (Web Table)
- **Interactive web table:** Code-driven comparison of 7 administration routes (IV, intranasal, buccal, rectal, sublingual, IM, oral) with onset times, $T_{max}$, systemic bioavailability ($F$), common drugs, and clinical indications.
- **Onset bar comparator:** Onset of action of the selected drug by each route, sorted from fastest to slowest with bar length relative to the slowest route; routes the drug is not formulated for are greyed out and show the typical route range.
- **Clinical detail card:** Click any route to inspect formulation specifics (e.g. why diazepam precipitates in muscle making IM absorption erratic, while midazolam and lorazepam are well absorbed).

### Section 05 · Pharmacodynamics (Plotly.js Curves)
- **Concentration-Response:** GABA concentration-response curves comparing baseline with allosteric leftward shift.
- **Subunit Occupancy:** Real-time fractional occupancy ($\theta$) curves across α1, α2, α3, α5, and α4, with an explanation of Kᵢ, selectivity and the current occupancies.
- **Simulated Synaptic IPSC:** rise and biexponential decay as in cultured hippocampal neurons (Jones & Westbrook 1995), with PAM-induced prolongation of the decay calibrated to Mellor & Randall 1997 (parameters in `model.ipsc`).
- **Subunit selectivity:** radar chart of binding affinity $pK_i$ ($-\log_{10} K_i$) across the α isoforms, with a reading guide and the computed fold-selectivity, showing why zolpidem is α1-preferring while classical BZDs are non-selective.

### Section 06 · Pharmacokinetics (Simulation & Table)
- **Concentration-Time Profile:** 1-compartment Runge-Kutta 4th order ODE simulation of parent drug and active metabolites (e.g. diazepam + nordiazepam, midazolam + 1'-hydroxymidazolam). Supports linear and log scales, single-dose and multi-dose steady state accumulation. **Accumulation view** ("Show accumulation" repeats the dose until steady state): pre-dose troughs, predicted C<sub>ss,avg</sub> and accumulation ratio R for the parent and each active metabolite, a "total active" line, and a summary of time to steady state (e.g. diazepam ≈ 6 days, nordiazepam ≈ 10 days).
- **Derived PK Parameters Web Table:** Computes $C_{max}$, $T_{max}$, effective $t_{1/2}$, $V_d$, clearance ($CL$), $AUC$, accumulation ratio ($R$), and average steady state concentration ($C_{ss,avg}$).
- **Modifier pills:** Test the clinical impact of CYP3A4 inhibitors (ketoconazole), inducers (rifampicin), CYP2C19 poor metabolizers, elderly age, and hepatic cirrhosis.
- **Duration Comparison:** Normalized comparative single oral dose curves for midazolam, alprazolam, lorazepam, and diazepam.

- **Biotransformation & active metabolites** (moved from Substances): diazepam N-demethylation/3-hydroxylation cascade, direct glucuronidation of the LOT agents, midazolam 1′-hydroxylation, each step labelled with enzyme and reaction.

### Section 07 · Dose-dependent effects & ceiling effect
- Moved here from section 02: illustrative dose-effect curve with effect bands, comparison with a barbiturate (direct gating, no ceiling) and with BZD + opioid/ethanol (loss of the ceiling), computed for the ligand selected in Pharmacodynamics. Followed by a red-framed card on benzodiazepine overdose (GABA-dependent ceiling, toxicity alone vs with co-ingestants, mechanisms of death: central hypoventilation, upper-airway obstruction, hypercapnic-hypoxaemic respiratory failure, complications of coma; management).

---

## 4. Mathematical Models & Equations

### Allosteric Modulation
Competitive binding at the BZD site between drug ($C$) and antagonist flumazenil ($C_{flu}$):

$$\theta_D = \frac{C / K_{i,D}}{1 + C / K_{i,D} + C_{flu} / K_{i,flu}}$$

Apparent GABA affinity shift:

$$\text{Shift} = 1 + (\beta - 1) \cdot \theta_D + (\beta_{flu} - 1) \cdot \theta_{flu}$$

Apparent GABA $EC_{50}$:

$$EC_{50,\text{app}} = \frac{EC_{50,\text{base}}}{\text{Shift}}$$

Fractional GABA response with Hill coefficient $n = 1.5$:

$$\text{Response} = \frac{[\text{GABA}]^{1.5}}{[\text{GABA}]^{1.5} + (EC_{50,\text{app}})^{1.5}}$$

### Pharmacokinetic ODE System
For oral dosing with active metabolite:

$$\frac{dA_{\text{gut}}}{dt} = -k_a \cdot A_{\text{gut}}$$

$$\frac{dA_{\text{central}}}{dt} = k_a \cdot A_{\text{gut}} - k_e \cdot A_{\text{central}}$$

$$\frac{dA_{\text{met}}}{dt} = f_m \cdot k_e \cdot A_{\text{central}} - k_m \cdot A_{\text{met}}$$

---

## 5. Verification & Clinical Disclaimer

Educational tool. Population pharmacokinetic and pharmacodynamic parameters are rounded literature values intended for teaching receptor theory and clinical pharmacology principles. Not intended for clinical dosage calculations or medical advice.

---

## 6. Use of AI

The application code, the data-checking scripts, the Swedish translation and parts of the explanatory texts were developed with the assistance of generative AI (Claude, Anthropic). The author selected the content, verified the pharmacological values against the cited sources (see `references` and `sources` in `assets/data/properties.json`) and is responsible for the work.

---

## 7. Licence

Copyright © 2026 [impressio](https://github.com/impressio). All rights reserved. The website and the source code may be viewed, and the repository cloned or downloaded for private study, teaching and evaluation; copying, modification, redistribution or hosting requires prior written permission. The notice covers the original code, texts and translations, design and the selection and arrangement of the data, not individual facts. Third-party material keeps its own terms: Guide to Pharmacology (ODbL / CC BY-SA 4.0) and ChEMBL (CC BY-SA 3.0) data, PubChem, FDA labels and FASS texts, the model data listed in the NOTICE files and the CDN libraries. See [LICENSE](LICENSE).
