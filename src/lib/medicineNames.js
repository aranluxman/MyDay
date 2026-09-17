// A local list of common medicines and vitamins, for name autocomplete.
//
// Bundled deliberately: no external drug API. An older person typing a name
// they half-remember should not have their medication list depend on a third
// party being up, and a health app should not tell anyone what its users take.
// Free text always wins — the list is a shortcut, never a restriction, and
// nothing here is medical advice or a suggestion to take anything.
//
// Names are the generic name first, with the common brand in brackets where
// that is what people actually call it. Weighted toward what is commonly
// dispensed to older adults in Canada.

export const MEDICINE_NAMES = [
  // --- vitamins and supplements ---
  'Vitamin D', 'Vitamin B12', 'Vitamin C', 'Vitamin B complex', 'Vitamin E', 'Vitamin K',
  'Multivitamin', 'Calcium', 'Calcium with Vitamin D', 'Magnesium', 'Iron', 'Ferrous gluconate',
  'Folic acid', 'Zinc', 'Omega-3', 'Fish oil', 'Cod liver oil', 'Glucosamine',
  'Probiotic', 'Melatonin', 'Coenzyme Q10', 'Potassium', 'Biotin', 'Collagen',
  'Turmeric', 'Psyllium (Metamucil)', 'Senna', 'Docusate (Colace)',

  // --- heart, blood pressure, cholesterol ---
  'Amlodipine', 'Ramipril', 'Perindopril', 'Lisinopril', 'Enalapril', 'Losartan',
  'Valsartan', 'Candesartan', 'Telmisartan', 'Irbesartan',
  'Metoprolol', 'Bisoprolol', 'Atenolol', 'Carvedilol', 'Propranolol', 'Labetalol',
  'Hydrochlorothiazide', 'Furosemide (Lasix)', 'Indapamide', 'Spironolactone',
  'Chlorthalidone', 'Diltiazem', 'Nifedipine', 'Verapamil',
  'Atorvastatin (Lipitor)', 'Rosuvastatin (Crestor)', 'Simvastatin', 'Pravastatin',
  'Ezetimibe', 'Fenofibrate', 'Digoxin', 'Isosorbide mononitrate', 'Nitroglycerin',
  'Amiodarone', 'Sotalol', 'Hydralazine',

  // --- blood thinners ---
  'Aspirin (ASA)', 'Low-dose aspirin 81 mg', 'Clopidogrel (Plavix)', 'Ticagrelor',
  'Apixaban (Eliquis)', 'Rivaroxaban (Xarelto)', 'Dabigatran (Pradaxa)',
  'Warfarin (Coumadin)', 'Edoxaban',

  // --- diabetes ---
  'Metformin', 'Gliclazide', 'Glyburide', 'Glimepiride', 'Sitagliptin (Januvia)',
  'Linagliptin', 'Empagliflozin (Jardiance)', 'Dapagliflozin (Forxiga)',
  'Canagliflozin', 'Semaglutide (Ozempic)', 'Liraglutide', 'Dulaglutide (Trulicity)',
  'Pioglitazone', 'Insulin glargine (Lantus)', 'Insulin aspart (NovoRapid)',
  'Insulin lispro (Humalog)', 'Insulin detemir (Levemir)', 'Insulin NPH (Humulin N)',
  'Insulin degludec (Tresiba)',

  // --- stomach and digestion ---
  'Pantoprazole', 'Omeprazole', 'Esomeprazole (Nexium)', 'Lansoprazole', 'Rabeprazole',
  'Ranitidine', 'Famotidine', 'Domperidone', 'Metoclopramide', 'Dimenhydrinate (Gravol)',
  'Ondansetron', 'Loperamide (Imodium)', 'Lactulose', 'Polyethylene glycol (Restoralax)',
  'Bisacodyl (Dulcolax)', 'Calcium carbonate (Tums)', 'Sucralfate', 'Dicyclomine',

  // --- pain, inflammation, arthritis ---
  'Acetaminophen (Tylenol)', 'Extra Strength Acetaminophen', 'Ibuprofen (Advil)',
  'Naproxen (Aleve)', 'Celecoxib (Celebrex)', 'Diclofenac', 'Diclofenac gel (Voltaren)',
  'Meloxicam', 'Indomethacin', 'Ketorolac',
  'Tramadol', 'Codeine', 'Acetaminophen with codeine (Tylenol 3)', 'Morphine',
  'Hydromorphone', 'Oxycodone', 'Fentanyl patch', 'Gabapentin', 'Pregabalin (Lyrica)',
  'Amitriptyline', 'Nortriptyline', 'Duloxetine (Cymbalta)', 'Cyclobenzaprine',
  'Baclofen', 'Colchicine', 'Allopurinol', 'Methotrexate', 'Hydroxychloroquine',
  'Prednisone', 'Capsaicin cream', 'Lidocaine patch',

  // --- bones ---
  'Alendronate (Fosamax)', 'Risedronate (Actonel)', 'Denosumab (Prolia)',
  'Zoledronic acid', 'Calcitriol', 'Teriparatide',

  // --- lungs and allergies ---
  'Salbutamol (Ventolin)', 'Fluticasone (Flovent)', 'Fluticasone nasal (Flonase)',
  'Budesonide/formoterol (Symbicort)', 'Fluticasone/salmeterol (Advair)',
  'Tiotropium (Spiriva)', 'Ipratropium (Atrovent)', 'Montelukast (Singulair)',
  'Prednisolone', 'Cetirizine (Reactine)', 'Loratadine (Claritin)',
  'Desloratadine (Aerius)', 'Diphenhydramine (Benadryl)', 'Hydroxyzine',
  'Mometasone nasal (Nasonex)',

  // --- brain, mood, sleep, memory ---
  'Donepezil (Aricept)', 'Memantine', 'Rivastigmine (Exelon)', 'Galantamine',
  'Levodopa/carbidopa (Sinemet)', 'Pramipexole', 'Ropinirole', 'Entacapone',
  'Sertraline (Zoloft)', 'Escitalopram (Cipralex)', 'Citalopram', 'Fluoxetine (Prozac)',
  'Paroxetine', 'Venlafaxine (Effexor)', 'Bupropion (Wellbutrin)', 'Mirtazapine',
  'Trazodone', 'Quetiapine (Seroquel)', 'Risperidone', 'Olanzapine', 'Aripiprazole',
  'Lorazepam (Ativan)', 'Clonazepam', 'Diazepam', 'Zopiclone', 'Temazepam',
  'Lithium', 'Divalproex', 'Lamotrigine', 'Levetiracetam (Keppra)', 'Phenytoin',
  'Carbamazepine', 'Betahistine (Serc)',

  // --- thyroid and hormones ---
  'Levothyroxine (Synthroid)', 'Liothyronine', 'Methimazole', 'Propylthiouracil',
  'Estradiol', 'Conjugated estrogens (Premarin)', 'Progesterone', 'Testosterone',
  'Tamoxifen', 'Anastrozole', 'Letrozole', 'Finasteride', 'Dutasteride',
  'Tamsulosin (Flomax)', 'Alfuzosin', 'Silodosin', 'Oxybutynin', 'Tolterodine',
  'Solifenacin (Vesicare)', 'Mirabegron (Myrbetriq)', 'Desmopressin',

  // --- infections ---
  'Amoxicillin', 'Amoxicillin/clavulanate (Clavulin)', 'Azithromycin', 'Clarithromycin',
  'Cephalexin (Keflex)', 'Cefuroxime', 'Ciprofloxacin', 'Levofloxacin',
  'Doxycycline', 'Nitrofurantoin (Macrobid)', 'Trimethoprim/sulfamethoxazole (Septra)',
  'Metronidazole (Flagyl)', 'Clindamycin', 'Penicillin V', 'Fluconazole (Diflucan)',
  'Valacyclovir', 'Acyclovir', 'Terbinafine', 'Nystatin', 'Clotrimazole cream',

  // --- eyes, ears, skin ---
  'Latanoprost (Xalatan)', 'Timolol eye drops', 'Dorzolamide', 'Brimonidine',
  'Artificial tears', 'Polyethylene glycol eye drops', 'Prednisolone eye drops',
  'Tobramycin eye drops', 'Ciprofloxacin ear drops', 'Betamethasone cream',
  'Hydrocortisone cream', 'Mupirocin (Bactroban)', 'Tacrolimus ointment',
  'Calcipotriol', 'Urea cream', 'Ketoconazole shampoo',
];

/**
 * Search the list for an autocomplete menu.
 *
 * Ranks a prefix match above a word-start match above a contains match, so
 * typing "met" offers Metformin and Metoprolol before Acetaminophen.
 *
 * @param query    what they have typed
 * @param recent   names already on this person's list, offered first
 * @param limit    how many suggestions to return
 */
export function searchMedicineNames(query, recent = [], limit = 8) {
  const q = String(query || '').trim().toLowerCase();

  // Before they type, the most useful suggestions are their own medicines.
  if (!q) return dedupe(recent).slice(0, limit).map((name) => ({ name, source: 'recent' }));

  const scored = [];
  const seen = new Set();

  const consider = (name, source) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    const idx = key.indexOf(q);
    if (idx === -1) return;
    // 0 = starts with, 1 = a word inside starts with it, 2 = appears anywhere.
    let rank;
    if (idx === 0) rank = 0;
    else if (/[\s(/]/.test(key[idx - 1])) rank = 1;
    else rank = 2;
    // A name the person already takes always outranks a generic suggestion.
    if (source === 'recent') rank -= 0.5;
    seen.add(key);
    scored.push({ name, source, rank, len: name.length });
  };

  for (const r of dedupe(recent)) consider(r, 'recent');
  for (const n of MEDICINE_NAMES) consider(n, 'list');

  scored.sort((a, b) => (a.rank - b.rank) || (a.len - b.len) || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ name, source }) => ({ name, source }));
}

function dedupe(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
