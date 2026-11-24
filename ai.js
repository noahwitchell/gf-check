// On-phone AI reader. Runs a small open model inside the browser with WebLLM (WebGPU).
// The model is downloaded once from Hugging Face and kept in the browser's cache.

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/+esm";

// Picked by testing on sample reviews: Qwen 3.5 2B labeled every test sentence correctly;
// Qwen 2.5 0.5B/1.5B and Qwen3 1.7B mislabeled many.
export const MODELS = [
  { key: "qwen35_2b", f16: "Qwen3.5-2B-q4f16_1-MLC", f32: "Qwen3.5-2B-q4f32_1-MLC", name: "Qwen 3.5 2B (about 1.3 GB download, needs ~2.3 GB memory)" },
  { key: "qwen3_17b", f16: "Qwen3-1.7B-q4f16_1-MLC", f32: "Qwen3-1.7B-q4f32_1-MLC", name: "Qwen 3 1.7B: lighter, less accurate" },
];

const TYPES = ["dedicated_fryer", "shared_fryer", "separate_prep", "dedicated_gf", "staff_aware",
  "celiac_ok", "got_sick", "cross_contact", "staff_unaware", "gf_menu"];

let engine = null, loadedKey = null, webllm = null;

export function ready() { return !!engine; }
export function loadedModel() { return loadedKey; }

export async function gpuSupport() {
  if (!("gpu" in navigator)) return { ok: false, why: "This browser has no WebGPU, so the AI reader can't run here. (Needs iOS 26 Safari or a recent Chrome.)" };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, why: "WebGPU is present but no graphics adapter was available." };
    return { ok: true, f16: adapter.features.has("shader-f16") };
  } catch (e) { return { ok: false, why: "WebGPU error: " + e.message }; }
}

export async function load(key, onProgress) {
  const gpu = await gpuSupport();
  if (!gpu.ok) throw new Error(gpu.why);
  const m = MODELS.find(x => x.key === key) || MODELS[0];
  const id = gpu.f16 ? m.f16 : m.f32;
  webllm = webllm || await import(WEBLLM_URL);
  if (engine) { await engine.unload(); engine = null; }
  engine = await webllm.CreateMLCEngine(id, {
    initProgressCallback: p => onProgress && onProgress(p.progress || 0, p.text || ""),
  });
  loadedKey = key;
  return id;
}

const SYSTEM = `You label sentences from restaurant reviews for someone with celiac disease (they must avoid all gluten, including cross-contact).
Labels:
- dedicated_fryer: gluten-free food is fried in a separate fryer
- shared_fryer: the fryer is shared with breaded or wheat food
- separate_prep: separate prep area, pans, gloves, toaster, or an allergy protocol
- dedicated_gf: the whole kitchen or restaurant is gluten-free
- staff_aware: staff understood celiac or took the request seriously
- celiac_ok: someone with celiac ate here and had no reaction
- got_sick: someone got sick or "glutened" after eating here
- cross_contact: a warning about cross-contact, "gluten-friendly", or not safe for celiacs
- staff_unaware: staff did not understand gluten-free or celiac
- gf_menu: there is a gluten-free menu or gluten-free items
- none: the sentence says nothing about gluten safety
Use the whole review to understand who and what a sentence is about, but label only the one sentence asked about. Only give a label if that sentence itself says it.
Examples:
"Our server had no idea what gluten even was." -> ["staff_unaware"]
"Fries come out of the same oil as the chicken tenders." -> ["shared_fryer"]
"My daughter has celiac and felt great afterward." -> ["celiac_ok"]
"I wouldn't risk it if you're celiac." -> ["cross_contact"]
"Everything here is gluten-free, even the desserts." -> ["dedicated_gf"]
"I've eaten here many times and never had a problem." -> ["celiac_ok"]
"Came with my son who has celiac." -> ["none"]
"The tacos were delicious." -> ["none"]`;



// Only sentences that could be about gluten safety go to the model (saves time on the phone).
const MAYBE = /glut|fries|oil|trust|risk|problem|fine\b|\bgf\b|celiac|coeliac|fryer|fried|allerg|cross|wheat|flour|sick|ill\b|reaction|careful|separate|dedicated|safe|protocol|glove|prep|staff|server|waiter|waitress|chef|manager|menu|bread|bun|crust|pasta/i;

export function sentences(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length > 3);
}

// Returns { findings: [{type, quote}], checked } — each quote is the original sentence, so nothing can be made up.
export async function readReview(text, onStep) {
  if (!engine) throw new Error("Load the AI model first (AI tab).");
  const all = sentences(text);
  const todo = all.filter(s => MAYBE.test(s));
  // Short reviews go in whole as context; long pastes use the nearby sentences so the model's memory isn't overrun.
  const context = s => {
    if (text.length < 2500) return text;
    const i = all.indexOf(s);
    return all.slice(Math.max(0, i - 4), i + 3).join(" ");
  };
  const findings = [];
  for (let i = 0; i < todo.length; i++) {
    onStep && onStep(i + 1, todo.length);
    const reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Review: """${context(todo[i])}"""\n\nSentence to label: "${todo[i]}"\nReturn JSON {"labels": [...]}.` },
      ],
      temperature: 0,
      max_tokens: 60,
      extra_body: { enable_thinking: false },
    });
    let data;
    try {
      const txt = reply.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, "");
      data = JSON.parse(txt.match(/\{[\s\S]*\}/)[0]);
    } catch { continue; }
    for (const t of new Set(Array.isArray(data.labels) ? data.labels : [])) if (TYPES.includes(t)) findings.push({ type: t, quote: todo[i] });
  }
  return { findings, checked: todo.length };
}

