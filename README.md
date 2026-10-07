# BZD·GABA<sub>A</sub>: benzodiazepine pharmacology

An interactive teaching resource on benzodiazepines (BZDs) and the GABA<sub>A</sub> receptor: receptor structure, allosteric modulation, receptor kinetics and Cl⁻ flux, α-subunit selectivity, substances, administration routes, pharmacokinetics and dose-response. Live at [bzd.matty.se](https://bzd.matty.se); all data are listed with their sources on the [data page](https://bzd.matty.se/properties.html).

## 1. Running locally

The app is static HTML, CSS and JavaScript with CDN libraries (Plotly.js, 3Dmol.js, three.js, KaTeX); there is no build step. It loads its model files with `fetch()`, which browsers block for pages opened from disk, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). The model files in `assets/models/` and the structure drawings are prebuilt and committed; the scripts in `tools/` are needed only when their source data change.

## 2. Data, sources and validation

- **Data:** all domain data are in `assets/data/properties.json`, with the units and meaning of each field in its `meta` section. `js/data.js` loads the file; the app and the data page both read it. Edit a value and reload.
- **Sources:** `references` lists the literature (each checked against PubMed or DailyMed), and `sources` records for each value its references, the value reported in the source and a status (consistent, differs, full text, model, calibrated). Clinical pharmacokinetic values come from FDA labels where available, receptor affinities from the IUPHAR/BPS Guide to Pharmacology, ChEMBL and primary papers. `python3 tools/check_sources.py` re-checks the references, reports newer FDA label revisions and compares the Kᵢ values with Guide to Pharmacology and ChEMBL; it only reports.
- **Validation:** `validation` holds observed single-dose peak concentrations and times to peak, split into a calibration set (used to fit the absorption rate constants) and an independent validation set. The data page simulates each study and plots predicted against observed values with 2-fold bands.

## 3. Language, values and units

The settings button in the top bar (e.g. "EN · US") selects the language and the regional values and units; both are remembered and can be set in the address (`?lang=sv&region=eu`). On the first visit, a Swedish browser or a Swedish region (e.g. `sv`, `en-SE`) gets Swedish with SE values, other European countries get English with EU values, and everything else gets US English with US values. Changing the language selects its default values and units, which can then be changed separately.

- **Language:** English or Swedish. Interface texts are in `assets/i18n/en.json` and `sv.json`; the `data` section of `sv.json` translates the descriptive texts of `properties.json` by path. Swedish follows FASS terminology and uses decimal commas.
- **Values and units:** US (FDA prescribing information, US brand names, ng/mL), EU (values that differ in the EU product information as published in FASS or by EMA; EU-wide product names where centrally authorized, otherwise marked as nationally authorized; µg/L) or SE (EU values with Swedish product names and availability from FASS, and plasma concentrations in nmol/L converted per species by molecular weight). The EU values are an overlay in `jurisdictions.eu.data`, each with a FASS source. Validation always uses the US values.

## 4. Project structure

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
│       └── NOTICE                # sources, licenses
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
| `assets/data/properties.json` | Single source of all domain data, references and per-value sources |
| `assets/i18n/` | Interface texts in English and Swedish; `sv.json` also translates the data texts |
| `assets/images/structures/` | 2D structure drawings, built from the SMILES by `tools/build_structures.py` |
| `assets/models/` | Receptor structure (PDB 6HUP), 2D brain map views and 3D brain meshes; sources and licenses in NOTICE |
| `css/theme-figma.css` | Interface design in the Figma UI3 style, layered on `styles.css` |
| `js/models.js` | Allosteric model, kinetic gating scheme, GHK Cl⁻/HCO₃⁻ currents, IPSC and pharmacokinetic simulation |
| `js/structure.js` | Rotatable cryo-EM map with ligands, gating animation and Cl⁻ ions |
| `js/receptor.js` | Section 1 controls, readouts and the kinetics plot |
| `tools/build_brain.py` | Builds the brain model files from TemplateFlow (fsaverage, MNI152 2009c) |
| `tools/check_sources.py` | Checks references (PubMed), FDA label revisions (openFDA) and Kᵢ values; report only |
| `tools/build_structures.py` | Builds the structure SVGs (RDKit) |
| `CLAUDE.md` | Repository rules for Claude Code (imports `TYPOGRAPHY.md`) |
| `TYPOGRAPHY.md` | Typography rules: one font, size scale, tables, plots and canvas |

The build scripts share one environment: `python3 -m venv tools/.venv && tools/.venv/bin/python -m pip install -r tools/requirements.txt`. Rebuild the structure drawings after editing a SMILES (`tools/.venv/bin/python tools/build_structures.py`) and the brain models with `tools/build_brain.py` (TemplateFlow files are downloaded into `tools/.templateflow-cache/` on first run).

## 5. Sections

1. **Allosteric modulation at the receptor.** Cryo-EM structure of the α1β3γ2 receptor with GABA and diazepam (PDB 6HUP) as a rotatable simulated density map in a lipid nanodisc; flumazenil is shown in its own pose (PDB 6D6U). Controls for GABA, ligand and dose (converted to a free concentration), α isoform and flumazenil; readouts of BZD-site occupancy, apparent GABA EC<sub>50</sub> and open probability. The channel gates according to a 16-state kinetic scheme of α1β3γ2L receptors (Haas & Macdonald 1999, rate constants as corrected in 2004): GABA is applied and washed out in cycles, with recovery from desensitization shown accelerated. Below the viewer, the neuron type and membrane potential set the GHK Cl⁻ flux and the GABA reversal potential, and a plot shows how receptors open, desensitize and recover during a GABA application and washout.
2. **Receptor subunits and clinical effects.** Cards for α1-α6 (determinant histidine or arginine, effects, distribution, live occupancy) and for β, γ2 and δ; regional distribution of the α isoforms on a 3D brain model (FreeSurfer fsaverage and MNI152 2009c structures) or a 2D map, after Pirker et al. 2000 and Fritschy & Mohler 1995.
3. **Substances.** 2D structures and a searchable comparison table with duration classes, half-life, active metabolites, bioavailability, clearance, equivalent dose and indications, filterable by class and by direct glucuronidation (LOT: lorazepam, oxazepam, temazepam).
4. **Administration routes.** Seven routes compared by onset, time to peak and bioavailability, with onset bars for the selected drug and a clinical detail card per route.
5. **Pharmacodynamics.** GABA concentration-response with the allosteric shift, occupancy by α isoform, a simulated IPSC (rise and biexponential decay after Jones & Westbrook 1995, prolonged by PAMs as calibrated to Mellor & Randall 1997) and a selectivity radar of Kᵢ on a log<sub>10</sub> scale.
6. **Pharmacokinetics.** One-compartment simulation with active metabolites, single and repeated doses, patient factors and interactions (CYP3A4, CYP2C19, hepatic cirrhosis, older adults), derived parameters, duration comparison and the main metabolic pathways.
7. **Dose-response.** Illustrative dose-effect curves showing the BZD ceiling and its loss with opioids, ethanol and barbiturates, a card on overdose (mechanisms of death and management), and the FDA boxed warning of the selected substance from its US label (with a note in the EU and SE regions that EU product information has no boxed warnings).

## 6. Models

Competitive binding at the BZD site between the drug ($C$) and flumazenil ($C_{flu}$):

$$\theta_D = \frac{C / K_{i,D}}{1 + C / K_{i,D} + C_{flu} / K_{i,flu}}$$

Apparent GABA affinity shift and EC<sub>50</sub> ($\beta$ = cooperativity factor):

$$\text{Shift} = 1 + (\beta - 1)\,\theta_D, \qquad EC_{50,\text{app}} = \frac{EC_{50}}{\text{Shift}}$$

Fractional GABA response (Hill coefficient $n$ from `model.hill`):

$$\text{Response} = \frac{[\text{GABA}]^{n}}{[\text{GABA}]^{n} + EC_{50,\text{app}}^{\,n}}$$

Pharmacokinetics (oral dose with an active metabolite):

$$\frac{dA_{\text{gut}}}{dt} = -k_a A_{\text{gut}}, \qquad \frac{dA_{\text{c}}}{dt} = k_a A_{\text{gut}} - k_e A_{\text{c}}, \qquad \frac{dA_{\text{met}}}{dt} = f_m k_e A_{\text{c}} - k_m A_{\text{met}}$$

The kinetic gating scheme, the GHK currents and the IPSC are described in Notes & limitations in the app and in `meta` of `properties.json`.

## 7. Disclaimer

For education only. Parameters are rounded literature values for teaching receptor theory and clinical pharmacology; the app is not intended for dose calculations or clinical decisions.

## 8. Use of AI

The application code, the data-checking scripts, the Swedish translation and parts of the explanatory texts were developed with the assistance of generative AI (Claude, Anthropic). The author selected the content, verified the pharmacological values against the cited sources (`references` and `sources` in `assets/data/properties.json`) and is responsible for the work.

## 9. License

Copyright © 2026 [impressio](https://github.com/impressio). All rights reserved. The website and source code may be viewed, and the repository cloned or downloaded for private study, teaching and evaluation; copying, modification, redistribution or hosting requires prior written permission. Third-party material keeps its own terms (Guide to Pharmacology and ChEMBL data, PubChem, FDA labels and FASS texts, the model data listed in the NOTICE files, and the CDN libraries). See [LICENSE](LICENSE).
