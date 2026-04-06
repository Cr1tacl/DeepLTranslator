(function () {
  if (document.getElementById("deeplPanel")) return;

  const LANGS = [
    { code:"auto", label:"Auto-detect" }, { code:"EN", label:"English" },
    { code:"ES",   label:"Spanish"     }, { code:"FR", label:"French"  },
    { code:"DE",   label:"German"      }, { code:"JA", label:"Japanese"},
    { code:"ZH",   label:"Chinese"     }, { code:"IT", label:"Italian" },
    { code:"PT",   label:"Portuguese"  }, { code:"RU", label:"Russian" },
    { code:"KO",   label:"Korean"      }, { code:"AR", label:"Arabic"  },
  ];

  const FONT_SIZES = [12, 14, 18];
  let fontIdx     = 1;
  let darkMode    = false;
  let curProvider = "mymemory";
  let curMode     = "panel";
  let conjEnabled = true;
  let extEnabled  = true;

  // Track state
  chrome.storage.local.get(["extensionEnabled"], d => { if (d.extensionEnabled !== undefined) extEnabled = d.extensionEnabled; });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.extensionEnabled) extEnabled = changes.extensionEnabled.newValue;
  });

  function escapeHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  const blue   = () => "flex:1;padding:4px;border:2px solid #4a90d9;border-radius:4px;background:#4a90d9;color:white;cursor:pointer;font-size:12px;";
  const grey   = () => darkMode
    ? "flex:1;padding:4px;border:2px solid #555;border-radius:4px;background:#2a2a2a;color:#ccc;cursor:pointer;font-size:12px;"
    : "flex:1;padding:4px;border:2px solid #ccc;border-radius:4px;background:white;color:#333;cursor:pointer;font-size:12px;";
  const orange = () => "flex:1;padding:4px;border:2px solid #e67e22;border-radius:4px;background:#e67e22;color:white;cursor:pointer;font-size:12px;";
  const green  = () => "flex:1;padding:4px;border:2px solid #27ae60;border-radius:4px;background:#27ae60;color:white;cursor:pointer;font-size:12px;";
  const purple = () => "flex:1;padding:4px;border:2px solid #8e44ad;border-radius:4px;background:#8e44ad;color:white;cursor:pointer;font-size:12px;";
  const teal   = () => "flex:1;padding:4px;border:2px solid #16a085;border-radius:4px;background:#16a085;color:white;cursor:pointer;font-size:12px;";

  // ── Mini button ────────────────────────────────────────────────────
  const miniBtn = document.createElement("div");
  miniBtn.id = "deeplMiniBtn";
  miniBtn.innerText = "Translate";
  miniBtn.style.cssText = "display:none;position:fixed;z-index:2147483647;background:#4a90d9;color:white;padding:5px 10px;border-radius:20px;font-size:12px;font-family:sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);user-select:none;transition:background 0.2s;";
  miniBtn.onmouseover = () => miniBtn.style.background = "#357abd";
  miniBtn.onmouseout  = () => miniBtn.style.background = "#4a90d9";
  document.body.appendChild(miniBtn);

  let hideTimer;
  let showDebounce = null;
  document.addEventListener("mouseup", e => {
    if (!extEnabled || e.target === miniBtn) return;
    clearTimeout(hideTimer);
    clearTimeout(showDebounce);
    showDebounce = setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text.length >= 2) {
        miniBtn.style.left = (e.clientX - 40) + "px";
        miniBtn.style.top  = (e.clientY - 45) + "px";
        miniBtn.style.display = "block";
        miniBtn._selectedText = text;
      } else {
        miniBtn.style.display = "none";
      }
    }, 150);
  });
  document.addEventListener("mousedown", e => {
    if (e.target !== miniBtn) hideTimer = setTimeout(() => miniBtn.style.display = "none", 100);
  });
  miniBtn.addEventListener("mousedown", e => e.stopPropagation());
  miniBtn.addEventListener("click", () => {
    const text = miniBtn._selectedText;
    if (!text) return;
    miniBtn.innerText = "...";
    miniBtn.style.background = "#888";
    chrome.runtime.sendMessage({ action:"translateDirect", text }, res => {
      miniBtn.style.display = "none";
      miniBtn.innerText = "Translate";
      miniBtn.style.background = "#4a90d9";
      if (res) handleShow({ action:"show", ...res });
    });
  });

  // ── Alt+T ──────────────────────────────────────────────────────────
  document.addEventListener("keydown", e => {
    if (!extEnabled) return;
    if (e.altKey && (e.key === "t" || e.key === "T")) {
      const sel  = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text) chrome.runtime.sendMessage({ action:"translateDirect", text }, res => { if (res) handleShow({ action:"show", ...res }); });
    }
  });

  // ── Build panel ────────────────────────────────────────────────────
  const srcOpts = LANGS.map(l => "<option value=\"" + l.code + "\">" + l.label + "</option>").join("");
  const tgtOpts = LANGS.filter(l => l.code !== "auto").map(l => "<option value=\"" + l.code + "\">" + l.label + "</option>").join("");

  const panel = document.createElement("div");
  panel.id = "deeplPanel";
  panel.style.cssText = "display:none;position:fixed;top:100px;left:100px;width:370px;background:white;border:2px solid #333;border-radius:6px;padding:10px;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.4);font-family:sans-serif;";

  panel.innerHTML = `
    <div id="dHeader" style="cursor:move;background:#4a90d9;color:white;padding:8px 10px;margin:-10px -10px 10px -10px;border-radius:4px 4px 0 0;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:bold;font-size:14px;">Translator</span>
      <div style="display:flex;gap:4px;align-items:center;">
        <button id="btnHistoryTab" style="background:none;border:1px solid rgba(255,255,255,0.5);color:white;font-size:11px;padding:2px 7px;border-radius:4px;cursor:pointer;">History</button>
        <button id="btnLearnedTab" style="background:none;border:1px solid rgba(255,255,255,0.5);color:white;font-size:11px;padding:2px 7px;border-radius:4px;cursor:pointer;">📚 Learned</button>
        <button id="btnCreditsTab" style="background:none;border:1px solid rgba(255,255,255,0.5);color:white;font-size:11px;padding:2px 7px;border-radius:4px;cursor:pointer;">Credits</button>
        <button id="btnDarkMode" title="Toggle dark mode" style="background:none;border:1px solid rgba(255,255,255,0.5);color:white;font-size:13px;padding:2px 6px;border-radius:4px;cursor:pointer;">🌙</button>
        <button id="dClose" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;line-height:1;">&times;</button>
      </div>
    </div>

    <div id="mainView">
      <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;">
        <span style="font-size:12px;color:#555;min-width:52px;">Provider:</span>
        <button id="btnMymemory" style="${blue()}">MyMemory</button>
        <button id="btnDeepl"    style="${grey()}">DeepL</button>
      </div>
      <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;">
        <span style="font-size:12px;color:#555;min-width:52px;"></span>
        <button id="btnLearnMode"   style="${grey()}">✏️ Learn</button>
        <button id="btnLearnedMode" style="${grey()}">📚 Learned</button>
      </div>
      <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;">
        <span style="font-size:12px;color:#555;min-width:52px;">Mode:</span>
        <button id="btnPanel"  style="${blue()}">Panel</button>
        <button id="btnInline" style="${grey()}">Replace Text</button>
      </div>
      <div style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
        <span style="font-size:12px;color:#555;min-width:52px;">From:</span>
        <select id="selSource" style="flex:1;padding:3px;border:1px solid #ccc;border-radius:4px;font-size:12px;">${srcOpts}</select>
        <span style="color:#888;font-size:14px;">→</span>
        <select id="selTarget" style="flex:1;padding:3px;border:1px solid #ccc;border-radius:4px;font-size:12px;">${tgtOpts}</select>
        <button id="btnSwapLangs" title="Swap" style="padding:2px 7px;border:1px solid #ccc;border-radius:4px;background:#f0f0f0;cursor:pointer;font-size:14px;">⇄</button>
      </div>
      <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;">
        <span style="font-size:12px;color:#555;min-width:52px;">Conjugation:</span>
        <button id="btnConjOn"  style="${green()}">🔤 On</button>
        <button id="btnConjOff" style="${grey()}">Off</button>
      </div>
      <div style="margin-bottom:6px;display:flex;justify-content:flex-end;align-items:center;gap:5px;">
        <span style="font-size:11px;color:#888;">Font:</span>
        <button id="btnFontSm" style="padding:1px 6px;border:1px solid #ccc;border-radius:4px;font-size:11px;cursor:pointer;background:#f0f0f0;">A−</button>
        <button id="btnFontLg" style="padding:1px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px;cursor:pointer;background:#f0f0f0;">A+</button>
      </div>
      <div id="dProvider" style="font-size:11px;color:#888;margin-bottom:5px;"></div>

      <div id="dLearnForm" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:bold;color:#166534;margin-bottom:8px;">✏️ Add to Learned List</div>
        <input id="learnInput" placeholder="Phrase (e.g. jorge venir)" style="width:100%;padding:5px 7px;border:1px solid #86efac;border-radius:4px;font-size:12px;margin-bottom:6px;box-sizing:border-box;" />
        <input id="learnTranslation" placeholder="Translation (e.g. viene)" style="width:100%;padding:5px 7px;border:1px solid #86efac;border-radius:4px;font-size:12px;margin-bottom:8px;box-sizing:border-box;" />
        <div style="display:flex;gap:6px;">
          <button id="btnLearnSave" style="flex:1;padding:5px;background:#22c55e;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">Save</button>
          <button id="btnLearnClear" style="padding:5px 10px;background:#f0f0f0;color:#555;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:12px;">Clear</button>
        </div>
        <div id="learnSaveMsg" style="display:none;font-size:11px;color:#166534;margin-top:6px;text-align:center;"></div>
      </div>

      <div id="dLearnedNotFound" style="display:none;background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#854d0e;">
        📭 Not in your learned list. <span style="opacity:0.7;">Add it using ✏️ Learn mode.</span>
      </div>

      <div id="dLearnedFound" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#166534;">
        📚 From your learned list
      </div>

      <div id="dConjBanner" style="display:none;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:12px;background:#fef3c7;border:1px solid #f59e0b;color:#78350f;">
        <div style="font-weight:bold;margin-bottom:5px;">🔤 Verb Conjugation <span style="font-size:10px;opacity:0.6;font-weight:normal;">via AI</span></div>
        <div id="dConjLine" style="font-size:14px;font-family:monospace;margin-bottom:3px;"></div>
        <div style="font-size:10px;opacity:0.6;margin-top:3px;">Tip: <em>yo to have</em> or <em>jorge venir</em></div>
      </div>

      <div id="dLowConfidence" style="display:none;background:#fee2e2;border:1px solid #f87171;border-radius:6px;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#991b1b;">
        ⚠️ <strong>Low confidence</strong> — MyMemory wasn't sure. Try switching to <strong>DeepL</strong>.
      </div>

      <div id="dText" style="min-height:44px;font-size:14px;color:#222;word-wrap:break-word;padding:8px;background:#f9f9f9;border-radius:4px;border:1px solid #eee;line-height:1.5;"></div>
      <div style="margin-top:6px;display:flex;justify-content:flex-end;gap:6px;">
        <button id="btnQuickSave" style="display:none;padding:4px 12px;border:1px solid #27ae60;border-radius:4px;background:white;color:#27ae60;font-size:12px;cursor:pointer;">💾 Save to Learned</button>
        <button id="btnCopy" style="display:none;padding:4px 12px;border:1px solid #4a90d9;border-radius:4px;background:white;color:#4a90d9;font-size:12px;cursor:pointer;">📋 Copy</button>
      </div>
    </div>

    <div id="historyView" style="display:none;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:bold;color:#4a90d9;">Translation History</span>
        <button id="btnClearHistory" style="padding:2px 8px;border:1px solid #e74c3c;border-radius:4px;background:white;color:#e74c3c;font-size:11px;cursor:pointer;">Clear All</button>
      </div>
      <div id="historyList" style="max-height:230px;overflow-y:auto;font-size:12px;"></div>
    </div>

    <div id="learnedView" style="display:none;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:bold;color:#8e44ad;">📚 Learned List</span>
        <span id="learnedCount" style="font-size:11px;color:#aaa;"></span>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="btnExportLearned" style="flex:1;padding:4px 10px;border:1px solid #8e44ad;border-radius:4px;background:#8e44ad;color:white;font-size:11px;cursor:pointer;font-weight:bold;">📤 Export JSON</button>
        <button id="btnImportLearned" style="flex:1;padding:4px 10px;border:1px solid #16a085;border-radius:4px;background:#16a085;color:white;font-size:11px;cursor:pointer;font-weight:bold;">📥 Import JSON</button>
      </div>
      <div id="learnedList" style="max-height:250px;overflow-y:auto;font-size:12px;"></div>
      <div id="learnedEmpty" style="display:none;text-align:center;color:#aaa;padding:20px 0;font-size:12px;">No entries yet. Use ✏️ Learn mode to add some.</div>
    </div>

    <div id="creditsView" style="display:none;text-align:center;padding:10px 0;">
      <div style="font-size:32px;margin-bottom:8px;">✨</div>
      <div style="font-size:18px;font-weight:bold;color:#4a90d9;margin-bottom:4px;">Tallyn A.</div>
      <div style="font-size:12px;color:#888;margin-bottom:12px;">Created this extension</div>
      <div style="font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:10px;">Powered by DeepL, MyMemory & AI</div>
    </div>
  `;
  document.body.appendChild(panel);

  let userClosed = false;
  document.getElementById("dClose").onclick = () => { panel.style.display = "none"; userClosed = true; };

  // ── Tabs ───────────────────────────────────────────────────────────
  let currentTab = "main";
  function showTab(tab) {
    currentTab = tab;
    document.getElementById("mainView").style.display    = tab === "main"    ? "block" : "none";
    document.getElementById("historyView").style.display = tab === "history" ? "block" : "none";
    document.getElementById("learnedView").style.display = tab === "learned" ? "block" : "none";
    document.getElementById("creditsView").style.display = tab === "credits" ? "block" : "none";
    document.getElementById("btnHistoryTab").style.background = tab === "history" ? "rgba(255,255,255,0.3)" : "none";
    document.getElementById("btnLearnedTab").style.background = tab === "learned" ? "rgba(255,255,255,0.3)" : "none";
    document.getElementById("btnCreditsTab").style.background = tab === "credits" ? "rgba(255,255,255,0.3)" : "none";
    if (tab === "history") loadHistory();
    if (tab === "learned") loadLearnedList();
  }
  document.getElementById("btnHistoryTab").onclick = () => showTab(currentTab === "history" ? "main" : "history");
  document.getElementById("btnLearnedTab").onclick = () => showTab(currentTab === "learned" ? "main" : "learned");
  document.getElementById("btnCreditsTab").onclick = () => showTab(currentTab === "credits" ? "main" : "credits");

  // ── Dark mode ──────────────────────────────────────────────────────
  function applyTheme() {
    const d = darkMode;
    panel.style.background  = d ? "#1e1e1e" : "white";
    panel.style.borderColor = d ? "#555"    : "#333";
    document.getElementById("dHeader").style.background = d ? "#2a5a8a" : "#4a90d9";
    document.getElementById("btnDarkMode").innerText    = d ? "☀"      : "🌙";
    const dText = document.getElementById("dText");
    dText.style.background  = d ? "#2a2a2a" : "#f9f9f9";
    dText.style.borderColor = d ? "#444"    : "#eee";
    dText.style.color       = d ? "#e0e0e0" : "#222";
    document.getElementById("dProvider").style.color = d ? "#aaa" : "#888";
    ["selSource","selTarget"].forEach(id => {
      const el = document.getElementById(id);
      el.style.background  = d ? "#2a2a2a" : "white";
      el.style.color       = d ? "#e0e0e0" : "#333";
      el.style.borderColor = d ? "#555"    : "#ccc";
    });
    ["btnFontSm","btnFontLg","btnSwapLangs"].forEach(id => {
      const el = document.getElementById(id);
      el.style.background  = d ? "#333"    : "#f0f0f0";
      el.style.color       = d ? "#e0e0e0" : "#333";
      el.style.borderColor = d ? "#555"    : "#ccc";
    });
    const clr = document.getElementById("btnClearHistory");
    if (clr) clr.style.background = d ? "#1e1e1e" : "white";
    document.getElementById("btnCopy").style.background = d ? "#1e1e1e" : "white";
    
    const qs = document.getElementById("btnQuickSave");
    if (qs) qs.style.background = d ? "#1e1e1e" : "white";

    setActive(curProvider, true);
    setMode(curMode, true);
    setConjToggle(conjEnabled, true);
  }
  document.getElementById("btnDarkMode").onclick = () => { darkMode = !darkMode; applyTheme(); chrome.runtime.sendMessage({ action:"setDarkMode", darkMode }); };

  // ── Font ───────────────────────────────────────────────────────────
  function applyFontSize() { document.getElementById("dText").style.fontSize = FONT_SIZES[fontIdx] + "px"; }
  document.getElementById("btnFontSm").onclick = () => { if (fontIdx > 0) { fontIdx--; applyFontSize(); chrome.runtime.sendMessage({ action:"setFontSize", fontIdx }); } };
  document.getElementById("btnFontLg").onclick = () => { if (fontIdx < FONT_SIZES.length-1) { fontIdx++; applyFontSize(); chrome.runtime.sendMessage({ action:"setFontSize", fontIdx }); } };

  // ── Provider / Mode / Conjugation toggles ─────────────────────────
  function setActive(provider, silent) {
    curProvider = provider;
    document.getElementById("btnDeepl").style.cssText      = provider === "deepl"   ? blue()   : grey();
    document.getElementById("btnMymemory").style.cssText   = provider === "mymemory"? blue()   : grey();
    document.getElementById("btnLearnMode").style.cssText  = provider === "learn"   ? purple() : grey();
    document.getElementById("btnLearnedMode").style.cssText= provider === "learned" ? teal()   : grey();
    // Show/hide learn form
    document.getElementById("dLearnForm").style.display    = provider === "learn"   ? "block"  : "none";
    if (!silent) chrome.runtime.sendMessage({ action:"setProvider", provider });
  }
  function setMode(mode, silent) {
    curMode = mode;
    document.getElementById("btnPanel").style.cssText  = mode === "panel"  ? blue()   : grey();
    document.getElementById("btnInline").style.cssText = mode === "inline" ? orange() : grey();
    if (!silent) chrome.runtime.sendMessage({ action:"setMode", mode });
  }
  function setConjToggle(enabled, silent) {
    conjEnabled = enabled;
    document.getElementById("btnConjOn").style.cssText  = enabled  ? green()  : grey();
    document.getElementById("btnConjOff").style.cssText = !enabled ? orange() : grey();
    if (!silent) chrome.runtime.sendMessage({ action:"setConjugationEnabled", enabled });
  }

  document.getElementById("btnMymemory").onclick   = () => setActive("mymemory");
  document.getElementById("btnDeepl").onclick      = () => setActive("deepl");
  document.getElementById("btnLearnMode").onclick  = () => setActive("learn");
  document.getElementById("btnLearnedMode").onclick= () => setActive("learned");
  document.getElementById("btnPanel").onclick      = () => setMode("panel");
  document.getElementById("btnInline").onclick     = () => setMode("inline");
  document.getElementById("btnConjOn").onclick     = () => setConjToggle(true);
  document.getElementById("btnConjOff").onclick    = () => setConjToggle(false);

  // ── Language selects ───────────────────────────────────────────────
  document.getElementById("selSource").onchange = () => chrome.runtime.sendMessage({ action:"setLanguages", sourceLang:document.getElementById("selSource").value, targetLang:document.getElementById("selTarget").value });
  document.getElementById("selTarget").onchange = () => chrome.runtime.sendMessage({ action:"setLanguages", sourceLang:document.getElementById("selSource").value, targetLang:document.getElementById("selTarget").value });
  document.getElementById("btnSwapLangs").onclick = () => {
    const src = document.getElementById("selSource");
    const tgt = document.getElementById("selTarget");
    if (src.value === "auto") return;
    const tmp = src.value; src.value = tgt.value; tgt.value = tmp;
    chrome.runtime.sendMessage({ action:"setLanguages", sourceLang:src.value, targetLang:tgt.value });
  };

  // ── Learn form save ────────────────────────────────────────────────
  document.getElementById("btnLearnSave").onclick = () => {
    const input       = document.getElementById("learnInput").value.trim();
    const translation = document.getElementById("learnTranslation").value.trim();
    if (!input || !translation) return;
    chrome.runtime.sendMessage({ action:"saveLearned", input, translation }, () => {
      const msg = document.getElementById("learnSaveMsg");
      msg.innerText = "✓ Saved: \"" + input + "\" → \"" + translation + "\"";
      msg.style.display = "block";
      document.getElementById("learnInput").value = "";
      document.getElementById("learnTranslation").value = "";
      setTimeout(() => msg.style.display = "none", 2500);
    });
  };
  document.getElementById("btnLearnClear").onclick = () => {
    document.getElementById("learnInput").value = "";
    document.getElementById("learnTranslation").value = "";
    document.getElementById("learnSaveMsg").style.display = "none";
  };
  
  // Pre-fill learn form with selected text when switching to learn mode
  document.getElementById("btnLearnMode").addEventListener("click", () => {
    const sel  = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text) document.getElementById("learnInput").value = text;
  });

  // ── Copy & Quick Save ──────────────────────────────────────────────
  let lastOriginalText = "";
  let lastTranslatedText = "";

  document.getElementById("btnQuickSave").onclick = () => {
    if (!lastOriginalText || !lastTranslatedText) return;
    chrome.runtime.sendMessage({ action:"saveLearned", input: lastOriginalText, translation: lastTranslatedText }, () => {
      const btn = document.getElementById("btnQuickSave");
      btn.innerText = "✓ Saved!";
      setTimeout(() => {
        btn.style.display = "none";
        btn.innerText = "💾 Save to Learned";
      }, 1600);
    });
  };

  document.getElementById("btnCopy").onclick = () => {
    const text = document.getElementById("dText").innerText;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("btnCopy");
      btn.innerText = "✓ Copied!";
      setTimeout(() => btn.innerText = "📋 Copy", 1600);
    });
  };

  // ── History ────────────────────────────────────────────────────────
  function loadHistory() {
    chrome.runtime.sendMessage({ action:"getHistory" }, res => {
      const list    = document.getElementById("historyList");
      const history = res && res.history ? res.history : [];
      if (!history.length) { list.innerHTML = "<div style='text-align:center;color:#aaa;padding:20px 0;'>No history yet</div>"; return; }
      list.innerHTML = history.slice().reverse().map(item => {
        const time  = new Date(item.timestamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
        const src   = item.sourceLang === "auto" ? "?" : item.sourceLang;
        const bg    = darkMode ? "#2a2a2a" : "#f9f9f9";
        const bd    = darkMode ? "#333"    : "#eee";
        const fc    = darkMode ? "#bbb"    : "#555";
        const tc    = darkMode ? "#e0e0e0" : "#222";
        const badge = item.isConjugation ? "<span style='font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:10px;margin-left:4px;'>🔤 AI</span>" : "";
        const lbadge = item.provider === "learned" ? "<span style='font-size:10px;background:#f0fdf4;color:#166534;padding:1px 6px;border-radius:10px;margin-left:4px;'>📚</span>" : "";
        return "<div style='padding:7px 8px;border-radius:4px;margin-bottom:5px;background:" + bg + ";border:1px solid " + bd + ";'>" +
          "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;'>" +
          "<div><span style='font-size:10px;color:#4a90d9;background:#e8f0fe;padding:1px 6px;border-radius:10px;'>" + src + " → " + item.targetLang + "</span>" + badge + lbadge + "</div>" +
          "<span style='font-size:10px;color:#aaa;'>" + time + "</span></div>" +
          "<div style='color:" + fc + ";font-size:11px;margin-bottom:2px;'>" + escapeHtml(item.original) + "</div>" +
          "<div style='color:" + tc + ";font-weight:600;font-size:12px;'>" + escapeHtml(item.translated) + "</div></div>";
      }).join("");
    });
  }
  document.getElementById("btnClearHistory").onclick = () => chrome.runtime.sendMessage({ action:"clearHistory" }, () => loadHistory());

  // ── Export / Import learned ──────────────────────────────────────
  document.getElementById("btnExportLearned").onclick = () => {
    chrome.runtime.sendMessage({ action:"getAllLearned" }, res => {
      const db = res && res.db ? res.db : {};
      if (!Object.keys(db).length) { alert("Nothing to export — your learned list is empty."); return; }
      const json = JSON.stringify(db, null, 2);
      const blob = new Blob([json], { type:"application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "learned_phrases_" + new Date().toISOString().slice(0,10) + ".json";
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  document.getElementById("btnImportLearned").onclick = () => {
    const input = document.createElement("input");
    input.type  = "file";
    input.accept = ".json";
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid format");
          // Validate: all values must be strings
          for (const [k, v] of Object.entries(data)) {
            if (typeof k !== "string" || typeof v !== "string") throw new Error("Keys and values must be strings");
          }
          const count = Object.keys(data).length;
          const label = count === 1 ? "entry" : "entries";
          if (!confirm("Import " + count + " " + label + "? This will merge with your existing learned list.")) return;
          chrome.runtime.sendMessage({ action:"importLearned", data }, () => {
            loadLearnedList();
            // Also refresh the in-memory cache on the background side
          });
        } catch(err) {
          alert("Import failed: " + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // ── Learned list view ──────────────────────────────────────────────
  function loadLearnedList() {
    chrome.runtime.sendMessage({ action:"getAllLearned" }, res => {
      const db      = res && res.db ? res.db : {};
      const entries = Object.entries(db);
      const list    = document.getElementById("learnedList");
      const empty   = document.getElementById("learnedEmpty");
      const count   = document.getElementById("learnedCount");
      count.innerText = entries.length + " " + (entries.length === 1 ? "entry" : "entries");
      if (!entries.length) { list.innerHTML = ""; empty.style.display = "block"; return; }
      empty.style.display = "none";
      const bg = darkMode ? "#2a2a2a" : "#f9f9f9";
      const bd = darkMode ? "#333"    : "#eee";
      const fc = darkMode ? "#bbb"    : "#555";
      const tc = darkMode ? "#e0e0e0" : "#166534";
      list.innerHTML = entries.map(([key, val]) =>
        "<div style='display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:4px;margin-bottom:4px;background:" + bg + ";border:1px solid " + bd + ";'>" +
        "<div><span style='color:" + fc + ";font-size:12px;'>" + escapeHtml(key) + "</span>" +
        "<span style='color:#888;margin:0 6px;'>→</span>" +
        "<span style='color:" + tc + ";font-weight:bold;font-size:12px;'>" + escapeHtml(val) + "</span></div>" +
        "<button onclick=\"chrome.runtime.sendMessage({action:'deleteLearned',input:'" + escapeHtml(key) + "'},()=>this.closest('.learnedEntry')||loadLearnedList())\" " +
        "style='background:none;border:none;color:#e74c3c;cursor:pointer;font-size:14px;padding:0 4px;'>✕</button>" +
        "</div>"
      ).join("");
      // Fix delete buttons
      list.querySelectorAll("button").forEach((btn, i) => {
        const key = entries[i][0];
        btn.onclick = () => {
          chrome.runtime.sendMessage({ action:"deleteLearned", input:key }, () => loadLearnedList());
        };
      });
    });
  }

  // ── Drag ───────────────────────────────────────────────────────────
  const header = document.getElementById("dHeader");
  let ox, oy, drag = false;
  header.onmousedown = e => { drag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; };
  document.onmouseup   = () => { drag=false; };
  document.onmousemove = e => { if(drag){ panel.style.left=(e.clientX-ox)+"px"; panel.style.top=(e.clientY-oy)+"px"; } };

  // ── Load settings ──────────────────────────────────────────────────
  chrome.runtime.sendMessage({ action:"getSettings" }, res => {
    if (!res) return;
    setActive(res.provider);
    setMode(res.mode);
    setConjToggle(res.conjugationEnabled !== false);
    document.getElementById("selSource").value = res.sourceLang || "auto";
    document.getElementById("selTarget").value = res.targetLang || "ES";
    fontIdx  = res.fontIdx  !== undefined ? res.fontIdx  : 1;
    darkMode = res.darkMode !== undefined ? res.darkMode : false;
    applyTheme();
    applyFontSize();
  });

  // ── Banners ────────────────────────────────────────────────────────
  function setConjBanner(isConjugation, conjugationInfo, translatedText) {
    const banner = document.getElementById("dConjBanner");
    const line   = document.getElementById("dConjLine");
    if (isConjugation && conjugationInfo) {
      banner.style.display = "block";
      const d = darkMode;
      banner.style.background  = d ? "#3a2a00" : "#fef3c7";
      banner.style.borderColor = d ? "#a07000" : "#f59e0b";
      banner.style.color       = d ? "#fcd34d" : "#78350f";
      const subjectDiffers = conjugationInfo.subject.toLowerCase() !== conjugationInfo.enSubject.toLowerCase();
      const subjectDisplay = subjectDiffers
        ? escapeHtml(conjugationInfo.subject) + " <span style='opacity:0.6;font-size:11px;'>(" + escapeHtml(conjugationInfo.enSubject) + ")</span>"
        : escapeHtml(conjugationInfo.subject);
      line.innerHTML = subjectDisplay + " to <strong>" + escapeHtml(conjugationInfo.verb) + "</strong> <span style='opacity:0.45;'>→</span> <strong style='font-size:16px;'>" + escapeHtml(translatedText) + "</strong>";
    } else {
      banner.style.display = "none";
    }
  }

  // ── Handle show ────────────────────────────────────────────────────
  function handleShow(msg) {
    setActive(msg.provider);
    setMode(msg.mode);
    if (msg.sourceLang) document.getElementById("selSource").value = msg.sourceLang;
    if (msg.targetLang) document.getElementById("selTarget").value = msg.targetLang;

    const providerLabel = msg.isConjugation ? "AI (Pollinations)" : msg.provider === "deepl" ? "DeepL" : msg.provider === "learned" ? "📚 Learned" : "MyMemory";
    const srcLabel = msg.sourceLang === "auto" ? "Auto" : (msg.sourceLang || "?");
    document.getElementById("dProvider").innerText = "Using: " + providerLabel + " | " + srcLabel + " → " + (msg.targetLang || "?");

    setConjBanner(msg.isConjugation, msg.conjugationInfo, msg.text);
    document.getElementById("dLowConfidence").style.display    = (!msg.isConjugation && msg.lowConfidence) ? "block" : "none";
    document.getElementById("dLearnedFound").style.display     = msg.fromLearned  ? "block" : "none";
    document.getElementById("dLearnedNotFound").style.display  = msg.notFound     ? "block" : "none";

    document.getElementById("dText").innerText = msg.text;
    document.getElementById("btnCopy").style.display = "inline-block";
    
    // Quick Save button logic
    lastOriginalText = msg.originalText || "";
    lastTranslatedText = msg.text || "";
    if (!msg.fromLearned && !msg.notFound && lastOriginalText && lastTranslatedText) {
      document.getElementById("btnQuickSave").style.display = "inline-block";
    } else {
      document.getElementById("btnQuickSave").style.display = "none";
    }

    applyFontSize();
    applyTheme();

    if (msg.mode === "inline" && !msg.notFound) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const span = document.createElement("span");
        span.style.cssText = "background:#fff3cd;border-bottom:2px solid #e67e22;";
        span.title = "Translated"; span.innerText = msg.text;
        range.insertNode(span); sel.removeAllRanges();
      }
      if (!userClosed) panel.style.display = "block";
    } else {
      userClosed = false; panel.style.display = "block"; showTab("main");
    }
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === "show") handleShow(msg);
    if (msg.action === "triggerTranslate") {
      const sel  = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text) chrome.runtime.sendMessage({ action:"translateDirect", text }, res => { if (res) handleShow({ action:"show", ...res }); });
    }
  });
})();
