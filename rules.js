// GF Check — gluten rules for packaged foods, restaurant reviews and menus.
// Plain rules, no AI. Everything here runs on the phone.

// ---------- Packaged foods ----------

// Ingredients that mean gluten. US law makes wheat show up as an allergen,
// but barley, rye and malt do not have to be declared, so we look for them by name.
const CONTAINS = [
  [/\bwheat\b/, "wheat"],
  [/\bbarley\b/, "barley"],
  [/\brye\b/, "rye"],
  [/\bmalt(ed)?\b/, "malt (from barley)"],
  [/\bspelt\b/, "spelt (a wheat)"],
  [/\b(kamut|khorasan)\b/, "kamut / khorasan (a wheat)"],
  [/\btriticale\b/, "triticale (wheat × rye)"],
  [/\bfarro\b/, "farro (a wheat)"],
  [/\bdurum\b/, "durum (a wheat)"],
  [/\bsemolina\b/, "semolina (wheat)"],
  [/\beinkorn\b/, "einkorn (a wheat)"],
  [/\bemmer\b/, "emmer (a wheat)"],
  [/\bbulgu?r\b/, "bulgur (wheat)"],
  [/\bcouscous\b/, "couscous (wheat)"],
  [/\bseitan\b/, "seitan (wheat gluten)"],
  [/\bgraham\b/, "graham (wheat)"],
  [/\bfarina\b/, "farina (wheat)"],
  [/\bfreekeh\b/, "freekeh (wheat)"],
  [/\bbrewer'?s yeast\b/, "brewer's yeast (often barley)"],
  [/\bvital gluten\b|\bgluten\b(?![- ]free)/, "gluten"],
  [/\b(soy sauce|shoyu)\b/, "soy sauce (usually brewed with wheat)"],
  [/\bpanko\b/, "panko (wheat breadcrumbs)"],
  [/\bbread ?crumbs?\b/, "breadcrumbs"],
  [/\b(orzo|udon)\b/, "wheat pasta / noodles"],
];

// Ingredients worth a second look.
const CAUTION = [
  [/\boat(s|meal| flour| bran| fiber)?\b/, "oats (often cross-contacted with wheat unless certified)"],
  [/\byeast extract\b/, "yeast extract (sometimes made from barley)"],
  [/\bbran\b/, "bran (grain not named)"],
  [/\bstarch\b(?<!corn starch)(?<!potato starch)(?<!tapioca starch)(?<!rice starch)(?<!food starch)/, "starch (source not named)"],
  [/\btamari\b/, "tamari (usually wheat-free, check the label)"],
];

// Low-risk ingredients people often worry about. Shown as notes, not warnings.
const NOTES = [
  [/\bnatural flavou?rs?\b|\bflavou?ring\b/, "natural flavors — in the US, wheat must be named; barley-based flavors are rare"],
  [/\bmodified food starch\b/, "modified food starch — in the US this is wheat only if the label says so"],
  [/\bdextrin\b/, "dextrin — almost always corn or potato in the US"],
  [/\bcaramel colou?r\b/, "caramel color — considered gluten-free"],
  [/\bmaltodextrin\b/, "maltodextrin — gluten-free despite the name"],
];

// Words in front of "flour" that make it a gluten-free flour.
const SAFE_FLOUR = new Set(("rice almond coconut corn tapioca potato sorghum chickpea garbanzo cassava buckwheat " +
  "quinoa millet teff amaranth bean soy arrowroot banana plantain pea lentil flax hemp nut hazelnut cashew " +
  "pecan fava tigernut chestnut peanut sunflower pumpkin sesame masa gluten-free gf free oat").split(" "));

const GF_LABELS = ["en:no-gluten", "en:gluten-free"];
const CERT_LABELS = ["en:certified-gluten-free", "en:crossed-grain-trademark",
  "en:gluten-free-certification-organization", "en:gfco-certified-gluten-free"];

function findAll(text, list) {
  const hits = [];
  for (const [re, label] of list) {
    const g = new RegExp(re.source, "gi");
    let m;
    while ((m = g.exec(text))) { hits.push({ label, word: m[0], index: m.index }); if (!g.global) break; }
  }
  return hits;
}

function unnamedFlour(text) {
  const hits = [];
  const g = /([a-z-]+)?\s*\bflour\b/gi;
  let m;
  while ((m = g.exec(text))) {
    const before = (m[1] || "").toLowerCase();
    if (SAFE_FLOUR.has(before)) continue;
    if (/^(wheat|rye|barley|spelt|durum|graham|semolina)$/.test(before)) continue; // already caught
    hits.push({ label: "flour with no grain named (in the US, plain \"flour\" means wheat flour)", word: m[0].trim(), index: m.index });
  }
  return hits;
}

export function checkProduct(p) {
  const raw = (p.ingredients_text_en || p.ingredients_text || "").trim();
  // Take out "gluten-free" phrases so they don't count as gluten.
  const text = raw.toLowerCase().replace(/gluten[- ]free/g, "gf");
  const labels = p.labels_tags || [];
  const allergens = p.allergens_tags || [];
  const traces = p.traces_tags || [];

  const certified = labels.some(l => CERT_LABELS.includes(l));
  const labeledGF = certified || labels.some(l => GF_LABELS.includes(l));

  let contains = [...findAll(text, CONTAINS), ...unnamedFlour(text)];
  const caution = findAll(text, CAUTION);
  const notes = findAll(text, NOTES);

  // "Gluten-free wheat starch" is allowed under the US rule when the product is labeled GF.
  if (labeledGF) {
    const ws = contains.filter(h => /wheat/.test(h.label) && /wheat starch/.test(text.slice(h.index, h.index + 14)));
    ws.forEach(h => caution.push({ ...h, label: "wheat starch (processed to remove gluten; allowed in labeled-GF foods)" }));
    contains = contains.filter(h => !ws.includes(h));
  }
  if (labeledGF) {
    for (let i = caution.length - 1; i >= 0; i--) if (/^oats/.test(caution[i].label)) caution.splice(i, 1);
  }

  const reasons = [];
  const tagGluten = allergens.includes("en:gluten");
  const tracesGluten = traces.includes("en:gluten");
  const onlyOats = !contains.length && caution.some(h => /^oats/.test(h.label));

  let grade;
  if (contains.length && labeledGF) {
    grade = "conflict";
    reasons.push("Labeled gluten-free, but the ingredient list in the database names a gluten ingredient. Check the package.");
  } else if (contains.length) {
    grade = "contains";
  } else if (certified) {
    grade = "certified";
    reasons.push("Carries a gluten-free certification mark (stricter than the legal 20 ppm limit).");
  } else if (labeledGF) {
    grade = "labeled";
    reasons.push("Labeled gluten-free. In the US that legally means under 20 ppm gluten.");
  } else if (tagGluten && !raw) {
    grade = "contains";
    reasons.push("The database lists gluten as an allergen (no ingredient list to check).");
  } else if (tagGluten && onlyOats) {
    grade = "caution";
    reasons.push("Contains oats that aren't labeled gluten-free. Regular oats are often cross-contacted with wheat.");
  } else if (tagGluten) {
    grade = "contains";
    reasons.push("The database lists gluten as an allergen.");
  } else if (!raw) {
    grade = "unknown";
    reasons.push("No ingredient list in the database for this product.");
  } else if (tracesGluten || caution.length) {
    grade = "caution";
  } else {
    grade = "nogluten";
    reasons.push("No gluten ingredients found, but it isn't labeled gluten-free, so cross-contact in the factory is possible.");
  }
  if (tracesGluten) reasons.push("Label warns it may contain gluten (shared equipment or facility).");

  return { grade, certified, labeledGF, contains, caution, notes, reasons, ingredients: raw };
}

export const GRADES = {
  certified: { title: "Certified gluten-free", tone: "safe" },
  labeled: { title: "Labeled gluten-free", tone: "safe" },
  nogluten: { title: "No gluten ingredients found", tone: "ok" },
  caution: { title: "Use caution", tone: "warn" },
  conflict: { title: "Data conflict — check package", tone: "warn" },
  contains: { title: "Contains gluten", tone: "bad" },
  unknown: { title: "Not enough data", tone: "none" },
};

// Wrap matched words in <mark> for display.
export function highlight(raw, result, esc) {
  const marks = [];
  const add = (hits, cls) => hits.forEach(h => marks.push({ start: h.index, end: h.index + h.word.length, cls }));
  // indexes were found on lowercased text with "gluten-free" → "gf", so re-find on the raw text instead
  const lower = raw.toLowerCase();
  const refind = (hits, cls) => {
    for (const h of hits) {
      let from = 0, i;
      while ((i = lower.indexOf(h.word.toLowerCase(), from)) !== -1) { marks.push({ start: i, end: i + h.word.length, cls }); from = i + 1; }
    }
  };
  refind(result.contains, "bad"); refind(result.caution, "warn"); refind(result.notes, "note");
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "", pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue;
    out += esc(raw.slice(pos, m.start)) + `<mark class="${m.cls}">` + esc(raw.slice(m.start, m.end)) + "</mark>";
    pos = m.end;
  }
  return out + esc(raw.slice(pos));
}

// ---------- Restaurant reviews ----------

// Each signal: a pattern found inside one sentence.
const REVIEW_SIGNALS = [
  { key: "dedicated_fryer", good: true, label: "Dedicated GF fryer", re: /\b(dedicated|separate|own)\b[^.!?]{0,30}\bfryers?\b|\bfryers?\b[^.!?]{0,20}\b(is|are) dedicated\b/i },
  { key: "shared_fryer", good: false, label: "Shared fryer", re: /\bfries\b[^.!?]{0,20}\bshare\b|\b(shared|same|no dedicated|not a dedicated|don'?t have a (dedicated|separate))\b[^.!?]{0,30}\bfryers?\b|\bfried (in|with) the same\b/i },
  { key: "separate_prep", good: true, label: "Separate prep / protocol", re: /\b(separate|dedicated|clean)\b[^.!?]{0,25}\b(prep|surface|area|kitchen|pan|pans|grill|toaster|utensils|board|gloves)\b|\ballergy (protocol|procedure|ticket|flag)\b|\bchanged (their |her |his )?gloves\b/i },
  { key: "dedicated_gf", good: true, label: "Fully gluten-free kitchen", re: /\b(100%|entirely|completely|fully|dedicated)\s+(gluten[- ]free|gf)\b|\bgluten[- ]free (kitchen|bakery|facility|restaurant)\b/i },
  { key: "staff_aware", good: true, label: "Staff knew about celiac", re: /\b(staff|server|waiter|waitress|chef|manager|they)\b[^.!?]{0,40}\b(knowledgeable|understood|knew (about|what)|took it seriously|super careful|very careful|so careful|celiac[- ]aware)\b/i },
  { key: "celiac_ok", good: true, label: "Celiac reviewer was fine", re: /\b(celiac|coeliac)\b[^.!?]{0,60}\b(no (issues|problems|reaction)|didn'?t get sick|felt (fine|great)|safe|never (been|got) sick)\b|\b(no (issues|reaction)|felt fine|didn'?t get sick)\b[^.!?]{0,40}\b(celiac|coeliac)\b/i },
  { key: "got_sick", good: false, label: "Reviewer got sick", re: /\b(got glutened|glutened|got sick|was sick|reaction|made me sick|felt sick|i was ill|symptoms)\b/i },
  { key: "cross_contact", good: false, label: "Cross-contact warning", re: /\b(cross[- ]?(contact|contamination)|not (safe )?for celiacs?|can'?t guarantee|cannot guarantee|not celiac[- ]safe|gluten[- ]friendly)\b/i },
  { key: "staff_unaware", good: false, label: "Staff didn't understand", re: /\b(staff|server|waiter|waitress)\b[^.!?]{0,40}\b(didn'?t know|had no idea|confused|clueless|didn'?t understand|rolled (his|her|their) eyes)\b/i },
  { key: "gf_menu", good: true, label: "Has a GF menu / markings", re: /\b(gluten[- ]free|gf) (menu|options|items|section|buns?|bread|pizza|crust|pasta)\b|\bmarked (gf|gluten[- ]free)\b/i },
];

export function splitSentences(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

export function scanReview(text) {
  const found = [];
  for (const s of splitSentences(text)) {
    for (const sig of REVIEW_SIGNALS) {
      if (sig.re.test(s)) {
        // "no shared fryer" style flip
        if (sig.key === "shared_fryer" && /\bno shared\b|\bnot shared\b/i.test(s)) continue;
        if (sig.key === "got_sick" && /\b(didn'?t|never|no|not)\b[^.!?]{0,15}\b(get sick|got sick|reaction|glutened|sick)\b/i.test(s)) continue;
        found.push({ key: sig.key, label: sig.label, good: sig.good, quote: s });
      }
    }
  }
  return found;
}

export const SIGNAL_INFO = Object.fromEntries(REVIEW_SIGNALS.map(s => [s.key, { label: s.label, good: s.good }]));

// ---------- Menus ----------

const MENU_RISKS = [
  [/\b(soy sauce|teriyaki|hoisin|ponzu|shoyu)\b/i, "soy-based sauce (usually wheat)"],
  [/\b(tempura|battered|beer[- ]battered|breaded|crusted|panko|katsu|schnitzel|fritters?)\b/i, "breading / batter"],
  [/\b(fried|fries|chips|crispy)\b/i, "fried — ask if the fryer is shared"],
  [/\b(roux|gravy|bechamel|béchamel|cream sauce|veloute|velouté|gumbo|chowder|bisque)\b/i, "often thickened with flour"],
  [/\b(malt vinegar|malt)\b/i, "malt (barley)"],
  [/\b(beer|ale|lager|stout)\b/i, "beer (barley)"],
  [/\b(croutons?|breads?|buns?|rolls?|toast|crostini|pitas?|naan|flatbreads?|flour tortillas?|wraps?|sandwich(es)?|burgers?|sub|hoagie|bagels?|croissants?)\b/i, "bread — ask for GF"],
  [/\b(pasta|noodles?|ramen|udon|soba|orzo|couscous|dumplings?|gyoza|wonton|ravioli|gnocchi|lo mein|chow mein)\b/i, "pasta / noodles / dumplings (usually wheat)"],
  [/\b(seitan|bulgur|farro|barley|spelt|tabbouleh)\b/i, "gluten grain"],
  [/\b(meatballs?|meatloaf|crab ?cakes?|veggie burger|imitation crab|surimi)\b/i, "often uses breadcrumbs or wheat binder"],
  [/\b(marinated|marinade|glazed|bbq|barbecue)\b/i, "marinade / glaze — ask about soy sauce or malt"],
  [/\b(pancakes?|waffles?|crepes?|french toast|biscuits?|cakes?|brownies?|cookies?|pies?|tarts?|cobbler|churros?|donuts?|doughnuts?|empanadas?|pastry|pastries|muffins?|scones?)\b/i, "baked item (usually wheat)"],
];
const MENU_GF_MARK = /\(?\b(gf|gluten[- ]free|celiac[- ]safe|can be made gf|gfo|gf available)\b\)?/i;

export function scanMenu(text) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 2);
  return lines.map(line => {
    const risks = [];
    for (const [re, label] of MENU_RISKS) { const m = line.match(re); if (m) risks.push({ word: m[0], label }); }
    const markedGF = MENU_GF_MARK.test(line.replace(/gluten[- ]friendly/i, ""));
    const friendly = /gluten[- ]friendly/i.test(line);
    let status;
    if (markedGF && risks.length) status = "ask";
    else if (markedGF) status = "gf";
    else if (friendly) status = "ask";
    else if (risks.length) status = "risk";
    else status = "plain";
    return { line, risks, markedGF, friendly, status };
  });
}
