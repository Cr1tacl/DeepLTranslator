const DEEPL_KEY = "8c195d24-045b-40d8-82a1-6a7f9873063f:fx"; // fallback if Worker unreachable
const WORKER_URL = "https://translator-api.allredtheproxd.workers.dev";
const LICENSE_KEY = ""; // ← User enters their key here, or leave empty for beta

// ── Conjugation cache ──────────────────────────────────────────────────────
const conjCache = {};
async function loadConjCache() {
  const data = await chrome.storage.local.get(["conjCache"]);
  if (data.conjCache) Object.assign(conjCache, data.conjCache);
}
loadConjCache();
function saveConjCache() { chrome.storage.local.set({ conjCache }); }

// ── Learned lookup cache (in-memory mirror of learnedDB) ───────────────────
let learnedDB = {};
let learnedDBopts = []; // tracks pending keys to flush
async function loadLearnedCache() {
  const data = await chrome.storage.local.get(["learnedDB"]);
  if (data.learnedDB) learnedDB = data.learnedDB;
}
loadLearnedCache();

function lookupLearnedCached(text) {
  return learnedDB[text.trim().toLowerCase()] || null;
}

let learnedFlushTimer = null;
function flushLearnedDB() {
  if (!learnedDBopts.length) return;
  chrome.storage.local.set({ learnedDB });
  learnedDBopts = [];
}

function scheduleFlushLearned() {
  clearTimeout(learnedFlushTimer);
  learnedFlushTimer = setTimeout(flushLearnedDB, 500);
}

// ── Subject resolution ─────────────────────────────────────────────────────
const PRONOUN_TO_EN = {
  "yo":"I","tú":"you","tu":"you","él":"he","el":"he","ella":"she",
  "usted":"you","nosotros":"we","nosotras":"we","vosotros":"you all",
  "vosotras":"you all","ellos":"they","ellas":"they","ustedes":"they",
  "i":"I","you":"you","he":"he","she":"she","we":"we","they":"they",
};
function strip(w) { return w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
function resolveSubject(raw) {
  const lower  = raw.toLowerCase().trim();
  const direct = PRONOUN_TO_EN[lower] || PRONOUN_TO_EN[strip(raw.trim())];
  if (direct) return direct;
  const parts = lower.split(/\s+(?:y|and)\s+/);
  if (parts.length > 1) {
    const hasYo = parts.some(p => p === "yo" || strip(p) === "yo" || p === "i");
    return hasYo ? "we" : "they";
  }
  return raw.trim();
}

// ── Conjugation detection ──────────────────────────────────────────────────
function detectConjugation(text) {
  const trimmed = text.trim();
  if (!trimmed.includes(" ")) return null;
  const m1 = trimmed.match(/^(.+?)\s+to\s+([a-záéíóúüñ]+)$/i);
  if (m1) {
    const subjectRaw = m1[1].trim();
    return { originalSubject: subjectRaw, verb: m1[2].toLowerCase(), enSubject: resolveSubject(subjectRaw) };
  }
  const m2 = trimmed.match(/^(.+?)\s+([a-záéíóúüñ]{3,})$/i);
  if (m2 && /[aei]r$/i.test(m2[2])) {
    const subjectRaw = m2[1].trim();
    return { originalSubject: subjectRaw, verb: m2[2].toLowerCase(), enSubject: resolveSubject(subjectRaw) };
  }
  return null;
}

// ── Learned database operations (in-memory + debounced flush) ──────────────
async function lookupLearned(text) {
  return lookupLearnedCached(text);
}

function saveLearned(input, translation) {
  const key = input.trim().toLowerCase();
  learnedDB[key] = translation.trim();
  learnedDBopts.push(key);
  scheduleFlushLearned();
}

function deleteLearned(input) {
  const key = input.trim().toLowerCase();
  delete learnedDB[key];
  learnedDBopts.push(key);
  scheduleFlushLearned();
}

// ── Pollinations AI ────────────────────────────────────────────────────────
const LANG_NAMES = {
  ES:"Spanish",FR:"French",DE:"German",IT:"Italian",PT:"Portuguese",
  RU:"Russian",JA:"Japanese",ZH:"Chinese",KO:"Korean",AR:"Arabic",EN:"English",
};
async function conjugateWithAI(subject, verb, targetLang) {
  const cacheKey = subject + "|" + verb + "|" + targetLang;
  if (conjCache[cacheKey]) return conjCache[cacheKey];
  const lang   = LANG_NAMES[targetLang] || targetLang;
  const prompt = "Reply with only the conjugated " + lang + " verb, nothing else. Subject: \"" + subject + "\", verb: to " + verb + ". One word only.";
  const url    = "https://text.pollinations.ai/" + encodeURIComponent(prompt) + "?model=openai-fast&seed=42";
  const res    = await fetch(url);
  if (!res.ok) throw new Error("AI error " + res.status);
  let result   = (await res.text()).trim().replace(/[.!?,;:"""'']/g,"").trim();
  if (result.length > 30 || result.split(" ").length > 3) throw new Error("Unexpected AI response: " + result.slice(0,60));
  conjCache[cacheKey] = result;
  saveConjCache();
  return result;
}

// ── Worker translation (server-side, no limits for licensed users) ──────────
async function translateViaWorker(text, sourceLang, targetLang) {
  const res = await fetch(WORKER_URL + "/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      source: sourceLang || "auto",
      target: targetLang || "ES",
      provider: "deepl", // use best engine server-side
      licenseKey: LICENSE_KEY || "",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Worker error " + res.status);
  return { text: data.text, provider: data.provider || "worker", lowConfidence: false };
}

// ── Debug: log my device ID on startup ──────────────────────────────────────
(async function logMyDeviceId() {
  try {
    const res = await fetch(WORKER_URL + "/whoami");
    const data = await res.json();
    console.log("[Translator] My device ID:", data.device_id, "| IP:", data.ip);
  } catch(e) {
    console.error("[Translator] Could not reach Worker:", e.message);
  }
})();

// ── Normal translation engines ─────────────────────────────────────────────
async function translateDeepL(text, sourceLang, targetLang) {
  const params = { text, target_lang: targetLang };
  if (sourceLang && sourceLang !== "auto") params.source_lang = sourceLang;
  const res  = await fetch("https://api-free.deepl.com/v2/translate", {
    method:"POST",
    headers:{"Authorization":"DeepL-Auth-Key " + DEEPL_KEY,"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams(params)
  });
  const data = await res.json();
  if (!data.translations?.[0]) throw new Error(JSON.stringify(data));
  return { text: data.translations[0].text, lowConfidence: false };
}

async function translateMyMemory(text, sourceLang, targetLang) {
  const src      = (!sourceLang || sourceLang === "auto") ? "autodetect" : sourceLang.toLowerCase();
  const langpair = src + "|" + targetLang.toLowerCase();
  const res      = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=" + langpair);
  const data     = await res.json();
  if (!data.responseData) throw new Error("No response from MyMemory");
  const translated = data.responseData.translatedText;
  if (!translated || translated.toUpperCase().includes("PLEASE SELECT") || translated.toUpperCase().includes("MYMEMORY")) {
    throw new Error("MyMemory failed — try switching to DeepL.");
  }
  const confidence    = data.responseData.match !== undefined ? Math.round(data.responseData.match * 100) : null;
  const lowConfidence = confidence !== null && confidence < 50;
  return { text: translated, confidence, lowConfidence };
}

// ── History (batched writes) ───────────────────────────────────────────────
let historyBatch = [];
let historyFlushTimer = null;

function flushHistory() {
  if (!historyBatch.length) return;
  chrome.storage.local.get(["history"], data => {
    const history = data.history || [];
    history.push(...historyBatch);
    if (history.length > 50) history.splice(0, history.length - 50);
    chrome.storage.local.set({ history });
  });
  historyBatch = [];
}

function scheduleHistoryFlush() {
  clearTimeout(historyFlushTimer);
  historyFlushTimer = setTimeout(flushHistory, 1000);
}

async function saveHistory(original, translated, provider, sourceLang, targetLang, isConjugation, enSentence) {
  historyBatch.push({ original, translated, provider, sourceLang, targetLang, isConjugation, enSentence, timestamp: Date.now() });
  if (historyBatch.length >= 5) flushHistory(); // flush early if batch is big
  else scheduleHistoryFlush();
}

// ── Core dispatcher ────────────────────────────────────────────────
async function doTranslate(text, sendResponse) {
  const storage = await chrome.storage.local.get(["provider", "mode", "sourceLang", "targetLang", "conjugationEnabled"]);
  let provider = storage.provider || "mymemory";
  const mode = storage.mode || "panel";
  const sourceLang = storage.sourceLang || "auto";
  const targetLang = storage.targetLang || "ES";
  const conjEnabled = storage.conjugationEnabled !== false;

  try {
    // 1️⃣ Check learned database FIRST
    const foundLearned = await lookupLearned(text);
    if (foundLearned) {
      await saveHistory(text, foundLearned, "learned", sourceLang, targetLang, false, null);
      sendResponse({
        text: foundLearned,
        originalText: text,
        provider: provider,
        mode,
        sourceLang,
        targetLang,
        lowConfidence: false,
        isConjugation: false,
        conjugationInfo: null,
        fromLearned: true
      });
      return; // Stop here. No API call needed.
    }

    // 2️⃣ If explicitly in "learned" mode but not found
    if (provider === "learned") {
      sendResponse({
        text: "Not in your learned list yet.",
        originalText: text,
        provider: "learned",
        mode,
        sourceLang,
        targetLang,
        lowConfidence: false,
        isConjugation: false,
        conjugationInfo: null,
        fromLearned: false,
        notFound: true
      });
      return;
    }

    // 3️⃣ Try Worker first (server-side, protected, unlimited for licensed)
    console.log("[Translator] Attempting Worker translate for:", text.slice(0, 30));
    try {
      const workerResult = await translateViaWorker(text, sourceLang, targetLang);
      console.log("[Translator] Worker result:", JSON.stringify(workerResult).slice(0, 100));
      await saveHistory(text, workerResult.text, workerResult.provider, sourceLang, targetLang, !!conj, conj ? conj.enSubject + " " + conj.verb : null);
      sendResponse({
        text: workerResult.text, originalText: text, provider: workerResult.provider, mode, sourceLang, targetLang,
        lowConfidence: workerResult.lowConfidence,
        isConjugation: false, // Worker handles conjugation server-side if needed
        conjugationInfo: null,
        fromLearned: false,
      });
      return;
    } catch(workerErr) {
      console.error("[Translator] Worker FAILED, falling back:", workerErr.message);
    }

    // 4️⃣ Fallback: direct API calls (old behavior, for offline / Worker down)
    const conj = conjEnabled ? detectConjugation(text) : null;
    let resultText, lowConfidence = false, usedProvider = provider;

    if (conj) {
      usedProvider = "ai";
      resultText = await conjugateWithAI(conj.enSubject, conj.verb, targetLang);
    } else {
      const result = provider === "deepl"
        ? await translateDeepL(text, sourceLang, targetLang)
        : await translateMyMemory(text, sourceLang, targetLang);
      resultText = result.text;
      lowConfidence = result.lowConfidence || false;
    }

    await saveHistory(text, resultText, usedProvider, sourceLang, targetLang, !!conj, conj ? conj.enSubject + " " + conj.verb : null);
    sendResponse({
      text: resultText, originalText: text, provider: usedProvider, mode, sourceLang, targetLang, lowConfidence,
      isConjugation: !!conj,
      conjugationInfo: conj ? { subject: conj.originalSubject, verb: conj.verb, enSubject: conj.enSubject } : null,
    });
  } catch(e) {
    sendResponse({ text: "Error: " + e.message, provider, mode: "panel", sourceLang, targetLang });
  }
}

// ── Installed & Action ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id:"translate", title:"Translate", contexts:["selection"] });
  chrome.storage.local.set({
    provider:"mymemory", mode:"panel", sourceLang:"auto", targetLang:"ES",
    darkMode:false, fontIdx:1, history:[], conjugationEnabled:true, conjCache:{}, learnedDB:{},
    extensionEnabled: true, workerUrl: WORKER_URL, licenseKey: LICENSE_KEY
  });
  learnedDB = {};
  learnedDBopts = [];
  historyBatch = [];
});

chrome.action.onClicked.addListener(async () => {
  const data = await chrome.storage.local.get(["extensionEnabled"]);
  const newState = !data.extensionEnabled;
  chrome.storage.local.set({ extensionEnabled: newState });
  chrome.action.setBadgeText({ text: newState ? "" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#e74c3c" });
});

// ── Context menu ───────────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "translate" || !info.selectionText) return;
  const storage = await chrome.storage.local.get(["provider", "mode", "sourceLang", "targetLang", "conjugationEnabled", "extensionEnabled"]);
  if (storage.extensionEnabled === false) return; // Exit if disabled

  const provider = storage.provider || "mymemory";
  const mode = storage.mode || "panel";
  const sourceLang = storage.sourceLang || "auto";
  const targetLang = storage.targetLang || "ES";
  const conjEnabled = storage.conjugationEnabled !== false;

  try {
    let resultText, lowConfidence = false, usedProvider = provider, fromLearned = false;

    // 1️⃣ Check learned database FIRST
    const foundLearned = await lookupLearned(info.selectionText);
    if (foundLearned) {
      resultText = foundLearned;
      usedProvider = provider;
      fromLearned = true;
    } else if (provider === "learned") {
      resultText = "Not in your learned list yet.";
      usedProvider = "learned";
      fromLearned = false;
    } else {
      // 2️⃣ Proceed with API/AI
      const conj = conjEnabled ? detectConjugation(info.selectionText) : null;
      if (conj) {
        usedProvider = "ai";
        resultText = await conjugateWithAI(conj.enSubject, conj.verb, targetLang);
      } else {
        const result = provider === "deepl"
          ? await translateDeepL(info.selectionText, sourceLang, targetLang)
          : await translateMyMemory(info.selectionText, sourceLang, targetLang);
        resultText = result.text;
        lowConfidence = result.lowConfidence || false;
      }
    }

    await saveHistory(info.selectionText, resultText, usedProvider, sourceLang, targetLang, false, null);
    chrome.tabs.sendMessage(tab.id, {
      action: "show",
      text: resultText,
      originalText: info.selectionText,
      provider: usedProvider,
      mode,
      sourceLang,
      targetLang,
      lowConfidence,
      isConjugation: false,
      conjugationInfo: null,
      fromLearned
    });
  } catch(e) {
    chrome.tabs.sendMessage(tab.id, { action: "show", text: "Error: " + e.message, provider, mode: "panel", sourceLang, targetLang });
  }
});

// ── Keyboard shortcut ──────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async command => {
  if (command !== "translate-selection") return;
  const data = await chrome.storage.local.get(["extensionEnabled"]);
  if (data.extensionEnabled === false) return; // Exit if disabled

  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action:"triggerTranslate" });
});

// ── Message bus ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "setProvider")           chrome.storage.local.set({ provider:           msg.provider });
  if (msg.action === "setMode")               chrome.storage.local.set({ mode:               msg.mode    });
  if (msg.action === "setLanguages")          chrome.storage.local.set({ sourceLang:msg.sourceLang, targetLang:msg.targetLang });
  if (msg.action === "setDarkMode")           chrome.storage.local.set({ darkMode:           msg.darkMode });
  if (msg.action === "setFontSize")           chrome.storage.local.set({ fontIdx:            msg.fontIdx  });
  if (msg.action === "setConjugationEnabled") chrome.storage.local.set({ conjugationEnabled: msg.enabled  });

  if (msg.action === "saveLearned") {
    saveLearned(msg.input, msg.translation);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === "deleteLearned") {
    deleteLearned(msg.input);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === "getAllLearned") {
    chrome.storage.local.get(["learnedDB"], d => sendResponse({ db: d.learnedDB || {} }));
    return true;
  }
  if (msg.action === "importLearned") {
    Object.assign(learnedDB, msg.data);
    learnedDBopts.push(...Object.keys(msg.data));
    scheduleFlushLearned();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === "clearHistory") {
    historyBatch = [];
    clearTimeout(historyFlushTimer);
    chrome.storage.local.set({ history:[] }, () => sendResponse({}));
    return true;
  }
  if (msg.action === "getHistory") {
    chrome.storage.local.get(["history"], d => sendResponse({ history: d.history || [] }));
    return true;
  }
  if (msg.action === "translateDirect") {
    doTranslate(msg.text, sendResponse);
    return true;
  }
  if (msg.action === "getSettings") {
    chrome.storage.local.get(["provider","mode","sourceLang","targetLang","darkMode","fontIdx","conjugationEnabled"], d => {
      sendResponse({
        provider:           d.provider           || "mymemory",
        mode:               d.mode               || "panel",
        sourceLang:         d.sourceLang         || "auto",
        targetLang:         d.targetLang         || "ES",
        darkMode:           d.darkMode           || false,
        fontIdx:            d.fontIdx            !== undefined ? d.fontIdx : 1,
        conjugationEnabled: d.conjugationEnabled !== false,
      });
    });
    return true;
  }
});
