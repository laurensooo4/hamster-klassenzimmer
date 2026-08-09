"use strict";
/* ============================================================================
   javaview.js — IDE-Oberfläche für das ☕-Java-Tool (Codeboard-angelehnt)
   ----------------------------------------------------------------------------
   window.JavaView — API wie FiliusView/SqlView:
     const v = new JavaView(hostElement, opts)
       opts.mode      "solve" (Schüler) | "edit" (Lehrkraft) | "view" (readonly)
       opts.onChange  optionaler Callback bei Änderungen
     v.getData()      -> { files:[{name,content,readonly,hidden}] }
     v.setData(data)  Dateien setzen
     v.setReadonly(b) alles sperren (Review)
     v.destroy()      Programm stoppen + aufräumen
   Layout: Datei-Tabs · Editor (Zeilennummern, Tab-Einrückung, Undo/Redo)
           · Konsole (Ausgabe + Inline-Scanner-Eingabe) · ▶ Ausführen / ⏹ Stopp
   Nutzt window.JavaEngine (javaengine.js muss vorher geladen sein).
   ============================================================================ */
(function(){

const CSS = `
.jv{display:flex;flex-direction:column;border:2px solid var(--line,#e6ebf2);border-radius:14px;overflow:hidden;background:var(--card,#fff);min-height:var(--jvMin,520px);height:100%}
.jv *{box-sizing:border-box}
.jv-toolbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1.5px solid var(--line,#e6ebf2);background:var(--bg,#f7f9fc);flex-wrap:wrap}
.jv-btn{border:none;border-radius:10px;font-family:inherit;font-weight:800;cursor:pointer;padding:8px 14px;font-size:13px;display:inline-flex;align-items:center;gap:6px}
.jv-btn:disabled{opacity:.45;cursor:default}
.jv-run{background:var(--green,#58cc02);color:#fff;box-shadow:0 3px 0 var(--green-d,#46a302)}
.jv-stop{background:var(--red,#ff4b4b);color:#fff;box-shadow:0 3px 0 #c4302b}
.jv-ghost{background:var(--card,#fff);color:var(--ink,#3c4858);box-shadow:0 0 0 2px var(--line,#e6ebf2) inset}
.jv-tabs{display:flex;align-items:flex-end;gap:2px;padding:6px 8px 0;background:var(--bg,#f7f9fc);border-bottom:1.5px solid var(--line,#e6ebf2);flex-wrap:wrap}
.jv-tab{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px 9px 0 0;font-size:12.5px;font-weight:800;cursor:pointer;color:var(--muted,#7a8aa0);background:transparent;border:1.5px solid transparent;border-bottom:none;user-select:none;font-family:ui-monospace,Consolas,monospace}
.jv-tab.on{background:var(--card,#fff);color:var(--ink,#3c4858);border-color:var(--line,#e6ebf2)}
.jv-tab .ic{font-size:11px}
.jv-fileacts{display:flex;align-items:center;gap:10px;padding:5px 10px;border-bottom:1.5px solid var(--line,#e6ebf2);background:var(--bg,#f7f9fc);font-size:12px;color:var(--muted,#7a8aa0);flex-wrap:wrap}
.jv-fileacts label{display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-weight:700}
.jv-fileacts button{border:none;background:transparent;color:var(--blue,#1cb0f6);font-family:inherit;font-weight:800;font-size:12px;cursor:pointer;padding:2px 4px}
.jv-fileacts button.del{color:var(--red-d,#e63a3a)}
.jv-main{display:flex;flex-direction:column;flex:1;min-height:0}
.jv-edwrap{display:flex;flex:1;min-height:180px;position:relative;overflow:hidden}
.jv-gutter{width:46px;background:var(--bg,#f7f9fc);border-right:1.5px solid var(--line,#e6ebf2);color:var(--muted,#7a8aa0);font:13px/1.5 ui-monospace,Consolas,monospace;text-align:right;padding:10px 6px 10px 0;overflow:hidden;user-select:none;white-space:pre}
.jv-gutter .err{background:var(--red,#ff4b4b);color:#fff;border-radius:4px;padding:0 3px;margin-right:-3px}
.jv-ed{flex:1;border:none;outline:none;resize:none;padding:10px 12px;font:13px/1.5 ui-monospace,Consolas,monospace;color:var(--ink,#3c4858);background:var(--card,#fff);white-space:pre;overflow:auto;tab-size:4}
.jv-ed[readonly]{background:var(--line2,#eef2f7);color:var(--muted,#5c6b7d)}
.jv-robanner{padding:5px 12px;background:#fff7e0;border-bottom:1.5px solid #e3c98a;color:#8a6d1d;font-size:12px;font-weight:700}
:root[data-theme="dark"] .jv-robanner{background:#3a3320;border-color:#6d5a26;color:#e8cf7a}
.jv-console{border-top:2px solid var(--line,#e6ebf2);background:#1d232c;display:flex;flex-direction:column;height:var(--jvConsole,190px);min-height:90px}
.jv-chead{display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:11.5px;font-weight:800;color:#8fa1b8;background:#161b22;letter-spacing:.4px}
.jv-chead .sp{flex:1}
.jv-chead button{border:none;background:transparent;color:#8fa1b8;font-family:inherit;font-weight:800;font-size:11.5px;cursor:pointer}
.jv-cout{flex:1;overflow:auto;padding:8px 12px;margin:0;font:12.5px/1.45 ui-monospace,Consolas,monospace;color:#dbe6f3;white-space:pre-wrap;word-break:break-word}
.jv-cout .err{color:#ff8f8f;font-weight:700}
.jv-cout .sys{color:#7ea4d8;font-style:italic}
.jv-cout .inp{color:#9ee493}
.jv-cin{display:none;align-items:center;gap:8px;padding:7px 10px;background:#161b22;border-top:1px solid #2a3340}
.jv-cin.on{display:flex}
.jv-cin .pfx{color:#9ee493;font:13px ui-monospace,Consolas,monospace;font-weight:800}
.jv-cin input{flex:1;border:1.5px solid #2a3340;border-radius:8px;background:#0f141b;color:#e6eef8;padding:6px 10px;font:13px ui-monospace,Consolas,monospace;outline:none}
.jv-cin button{border:none;border-radius:8px;background:var(--blue,#1cb0f6);color:#fff;font-weight:800;padding:6px 12px;cursor:pointer;font-family:inherit;font-size:12.5px}
.jv-status{font-size:12px;color:var(--muted,#7a8aa0);font-weight:700;margin-left:auto}
.jv-status .run{color:var(--green-d,#46a302)}
:root[data-theme="dark"] .jv-ed{background:var(--card,#151b24);color:var(--ink,#dbe4ef)}
:root[data-theme="dark"] .jv-ed[readonly]{background:#1a2028;color:#8fa1b8}
`;

function ensureStyles(){
  if(document.getElementById("jv-styles")) return;
  const st = document.createElement("style");
  st.id = "jv-styles";
  st.textContent = CSS;
  document.head.appendChild(st);
}

const escH = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const DEFAULT_FILE = { name:"Main.java", content:'public class Main {\n\n\tpublic static void main(String[] args) {\n\t\tSystem.out.println("Hallo Welt!");\n\t}\n\n}\n', readonly:false, hidden:false };

function JavaView(host, opts){
  opts = opts || {};
  ensureStyles();
  const self = this;
  this.mode = opts.mode || "solve";
  this.readonlyAll = this.mode === "view";
  this.onChange = opts.onChange || null;
  this.files = [ JSON.parse(JSON.stringify(DEFAULT_FILE)) ];
  this.active = 0;
  this.stopFlag = { stopped:false };
  this.running = false;
  this._undo = new Map();          // Dateiname -> {stack:[], idx}
  this._pendInput = null;          // {resolve} wenn Scanner wartet
  this._outBuf = ""; this._outRaf = 0;

  host.innerHTML = `
    <div class="jv">
      <div class="jv-toolbar">
        <button class="jv-btn jv-run" data-a="run">▶ Ausführen</button>
        <button class="jv-btn jv-stop" data-a="stop" disabled>⏹ Stopp</button>
        ${(this.mode === "edit" || this.mode === "free") ? '<button class="jv-btn jv-ghost" data-a="newfile">+ Datei</button>' : ""}
        <span class="jv-status" data-r="status"></span>
      </div>
      <div class="jv-tabs" data-r="tabs"></div>
      <div class="jv-fileacts" data-r="fileacts" style="display:none"></div>
      <div class="jv-robanner" data-r="robanner" style="display:none">🔒 Diese Datei ist vorgegeben und schreibgeschützt.</div>
      <div class="jv-main">
        <div class="jv-edwrap">
          <div class="jv-gutter" data-r="gutter">1</div>
          <textarea class="jv-ed" data-r="ed" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
        </div>
        <div class="jv-console">
          <div class="jv-chead">KONSOLE<span class="sp"></span><button data-a="clear">leeren</button></div>
          <pre class="jv-cout" data-r="cout"></pre>
          <div class="jv-cin" data-r="cin">
            <span class="pfx">›</span>
            <input data-r="cinp" placeholder="Eingabe … (Enter sendet)">
            <button data-a="send">Senden</button>
          </div>
        </div>
      </div>
    </div>`;
  this.root = host.firstElementChild;
  const R = sel => this.root.querySelector('[data-r="' + sel + '"]');
  this.el = { tabs:R("tabs"), fileacts:R("fileacts"), robanner:R("robanner"), gutter:R("gutter"),
              ed:R("ed"), cout:R("cout"), cin:R("cin"), cinp:R("cinp"), status:R("status") };
  this.el.btnRun  = this.root.querySelector('[data-a="run"]');
  this.el.btnStop = this.root.querySelector('[data-a="stop"]');

  /* ---- Wiring ---- */
  this.root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if(!b) return;
    const a = b.dataset.a;
    if(a === "run") self.run();
    else if(a === "stop") self.stop();
    else if(a === "clear"){ self.el.cout.innerHTML = ""; }
    else if(a === "send") self._sendInput();
    else if(a === "newfile") self._newFile();
  });
  this.el.cinp.addEventListener("keydown", (e) => { if(e.key === "Enter") self._sendInput(); });
  const ed = this.el.ed;
  ed.addEventListener("scroll", () => { self.el.gutter.scrollTop = ed.scrollTop; });
  ed.addEventListener("input", () => {
    self._saveActive();
    self._renderGutter();
    self._commitSoon();
    if(self.onChange) self.onChange();
  });
  ed.addEventListener("keydown", (e) => {
    if(e.key === "Tab"){
      e.preventDefault();
      self._insert("\t");
    } else if(e.key === "Enter"){
      e.preventDefault();
      const v = ed.value, s = ed.selectionStart;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const indent = (v.slice(lineStart, s).match(/^[\t ]*/) || [""])[0];
      const extra = v[s - 1] === "{" ? "\t" : "";
      self._insert("\n" + indent + extra);
    } else if((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z"){
      e.preventDefault(); self._undoStep(-1);
    } else if((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))){
      e.preventDefault(); self._undoStep(1);
    }
  });

  this._renderTabs();
  this._loadActive();
}

JavaView.prototype._insert = function(text){
  const ed = this.el.ed;
  const s = ed.selectionStart, e = ed.selectionEnd;
  ed.value = ed.value.slice(0, s) + text + ed.value.slice(e);
  ed.selectionStart = ed.selectionEnd = s + text.length;
  this._saveActive(); this._renderGutter(); this._commit();
  if(this.onChange) this.onChange();
};

/* ---------- Undo/Redo (je Datei) ---------- */
JavaView.prototype._u = function(){
  const nm = this.files[this.active].name;
  if(!this._undo.has(nm)) this._undo.set(nm, { stack: [this.files[this.active].content], idx: 0 });
  return this._undo.get(nm);
};
JavaView.prototype._commit = function(){
  const u = this._u();
  const cur = this.files[this.active].content;
  if(u.stack[u.idx] === cur) return;
  u.stack = u.stack.slice(0, u.idx + 1);
  u.stack.push(cur);
  if(u.stack.length > 300) u.stack.shift();
  u.idx = u.stack.length - 1;
};
JavaView.prototype._commitSoon = function(){
  const self = this;
  clearTimeout(this._ct);
  this._ct = setTimeout(() => self._commit(), 350);
};
JavaView.prototype._undoStep = function(dir){
  const u = this._u();
  this._commit();
  const ni = u.idx + dir;
  if(ni < 0 || ni >= u.stack.length) return;
  u.idx = ni;
  this.files[this.active].content = u.stack[ni];
  this._loadActive(true);
  if(this.onChange) this.onChange();
};

/* ---------- Dateien / Tabs ---------- */
JavaView.prototype._visibleFiles = function(){
  return this.mode === "solve" ? this.files.filter(f => !f.hidden) : this.files;
};
JavaView.prototype._renderTabs = function(){
  const vis = this._visibleFiles();
  const act = this.files[this.active];
  this.el.tabs.innerHTML = vis.map(f => {
    const i = this.files.indexOf(f);
    const marks = (f.readonly ? '<span class="ic" title="schreibgeschützt">🔒</span>' : "") +
                  (f.hidden ? '<span class="ic" title="für Schüler:innen unsichtbar">🙈</span>' : "");
    return '<span class="jv-tab' + (f === act ? " on" : "") + '" data-fi="' + i + '">' + escH(f.name) + marks + "</span>";
  }).join("");
  const self = this;
  this.el.tabs.querySelectorAll(".jv-tab").forEach(t => t.onclick = () => {
    self._saveActive(); self._commit();
    self.active = parseInt(t.dataset.fi, 10);
    self._renderTabs(); self._loadActive();
  });
  /* Datei-Eigenschaften (edit: Flags+Verwaltung · free: nur Verwaltung) */
  if(this.mode === "edit" || this.mode === "free"){
    const f = this.files[this.active];
    const flags = this.mode === "edit";
    this.el.fileacts.style.display = "";
    this.el.fileacts.innerHTML =
      '<b style="color:var(--ink,#3c4858)">' + escH(f.name) + "</b>" +
      (flags ? '<label><input type="checkbox" data-fa="ro"' + (f.readonly ? " checked" : "") + "> 🔒 schreibgeschützt (für Schüler:innen)</label>" +
               '<label><input type="checkbox" data-fa="hid"' + (f.hidden ? " checked" : "") + "> 🙈 versteckt (wird mitkompiliert)</label>" : "") +
      '<button data-fa="ren">umbenennen</button>' +
      (this.files.length > 1 ? '<button class="del" data-fa="del">Datei löschen</button>' : "");
    const self2 = this;
    if(flags){
      this.el.fileacts.querySelector('[data-fa="ro"]').onchange = function(){ f.readonly = this.checked; self2._renderTabs(); self2._changed(); };
      this.el.fileacts.querySelector('[data-fa="hid"]').onchange = function(){ f.hidden = this.checked; self2._renderTabs(); self2._changed(); };
    }
    this.el.fileacts.querySelector('[data-fa="ren"]').onclick = () => this._renameFile();
    const del = this.el.fileacts.querySelector('[data-fa="del"]');
    if(del) del.onclick = () => this._deleteFile();
  } else {
    this.el.fileacts.style.display = "none";
  }
};
JavaView.prototype._validName = function(nm, ignoreIdx){
  nm = (nm || "").trim();
  if(!/^[A-Za-z_][A-Za-z0-9_]*\.java$/.test(nm)) return null;
  const dup = this.files.some((f, i) => i !== ignoreIdx && f.name === nm);
  return dup ? null : nm;
};
JavaView.prototype._newFile = function(){
  const raw = prompt("Dateiname (Klassenname.java):", "Klasse.java");
  if(raw === null) return;
  const nm = this._validName(raw, -1);
  if(!nm){ alert("Ungültiger oder doppelter Dateiname. Muster: Klassenname.java"); return; }
  const cls = nm.replace(/\.java$/, "");
  this._saveActive(); this._commit();
  this.files.push({ name: nm, content: "public class " + cls + " {\n\n\t\n\n}\n", readonly:false, hidden:false });
  this.active = this.files.length - 1;
  this._renderTabs(); this._loadActive(); this._changed();
};
JavaView.prototype._renameFile = function(){
  const f = this.files[this.active];
  const raw = prompt("Neuer Dateiname:", f.name);
  if(raw === null) return;
  const nm = this._validName(raw, this.active);
  if(!nm){ alert("Ungültiger oder doppelter Dateiname. Muster: Klassenname.java"); return; }
  this._undo.delete(f.name);
  f.name = nm;
  this._renderTabs(); this._changed();
};
JavaView.prototype._deleteFile = function(){
  const f = this.files[this.active];
  if(!confirm('Datei "' + f.name + '" wirklich löschen?')) return;
  this._undo.delete(f.name);
  this.files.splice(this.active, 1);
  this.active = Math.max(0, this.active - 1);
  this._renderTabs(); this._loadActive(); this._changed();
};
JavaView.prototype._changed = function(){ if(this.onChange) this.onChange(); };

JavaView.prototype._saveActive = function(){
  const f = this.files[this.active];
  if(f && !this._edLocked) f.content = this.el.ed.value;
};
JavaView.prototype._loadActive = function(keepScroll){
  const vis = this._visibleFiles();
  if(!vis.length){ this.el.ed.value = ""; return; }
  if(!vis.includes(this.files[this.active])) this.active = this.files.indexOf(vis[0]);
  const f = this.files[this.active];
  const ed = this.el.ed;
  const st = keepScroll ? ed.scrollTop : 0;
  ed.value = f.content;
  const locked = this.readonlyAll || (this.mode === "solve" && f.readonly);
  this._edLocked = locked;
  ed.readOnly = locked;
  this.el.robanner.style.display = (this.mode === "solve" && f.readonly) ? "" : "none";
  this._renderGutter();
  ed.scrollTop = st;
};
JavaView.prototype._renderGutter = function(errLine){
  const lines = this.el.ed.value.split("\n").length;
  let html = "";
  for(let i = 1; i <= lines; i++)
    html += (errLine === i ? '<span class="err">' + i + "</span>" : i) + "\n";
  this.el.gutter.innerHTML = html;
  this.el.gutter.scrollTop = this.el.ed.scrollTop;
};

/* ---------- Konsole ---------- */
JavaView.prototype._print = function(text, cls){
  const self = this;
  if(cls){
    this._flushOut();
    const sp = document.createElement("span");
    sp.className = cls;
    sp.textContent = text;
    this.el.cout.appendChild(sp);
    this.el.cout.scrollTop = this.el.cout.scrollHeight;
    return;
  }
  this._outBuf += text;
  this._outTotal = (this._outTotal || 0) + text.length;          // kumulativ über den ganzen Lauf (Puffer wird ja geflusht)
  if(this._outTotal > 400000){ this._outBuf += "\n… (Ausgabe gekürzt – zu viel Text)"; this.stop(); }
  if(!this._outRaf) this._outRaf = requestAnimationFrame(() => self._flushOut());
};
JavaView.prototype._flushOut = function(){
  this._outRaf = 0;
  if(!this._outBuf) return;
  this.el.cout.appendChild(document.createTextNode(this._outBuf));
  this._outBuf = "";
  this.el.cout.scrollTop = this.el.cout.scrollHeight;
};
JavaView.prototype._sendInput = function(){
  if(!this._pendInput) return;
  const v = this.el.cinp.value;
  this.el.cinp.value = "";
  this.el.cin.classList.remove("on");
  this._print("› " + v + "\n", "inp");
  const r = this._pendInput;
  this._pendInput = null;
  r.resolve(v);
};

/* ---------- Ausführen ---------- */
JavaView.prototype.run = async function(){
  if(this.running) return;
  this._saveActive(); this._commit();
  const self = this;
  this.el.cout.innerHTML = "";
  this._outBuf = ""; this._outTotal = 0;
  this._renderGutter();
  this.stopFlag = { stopped:false };
  let compiled;
  try{
    compiled = JavaEngine.compile(this.files.map(f => ({ name: f.name, content: f.content })));
  } catch(e){
    const j = e.jerr;
    if(j){ this._showError(j); return; }
    this._print("Interner Fehler: " + e.message + "\n", "err");
    return;
  }
  this.running = true;
  this.el.btnRun.disabled = true;
  this.el.btnStop.disabled = false;
  this.el.status.innerHTML = '<span class="run">● läuft …</span>';
  const io = {
    print: s => self._print(s),
    input: () => new Promise(resolve => {
      self._flushOut();
      self._pendInput = { resolve };
      self.el.cin.classList.add("on");
      self.el.cinp.focus();
    }),
  };
  const t0 = performance.now();
  try{
    await JavaEngine.run(compiled, io, { stopFlag: this.stopFlag, maxSteps: 50000000 });
    this._flushOut();
    const ms = Math.round(performance.now() - t0);
    this._print("\n— Programm beendet (" + ms + " ms) —\n", "sys");
  } catch(e){
    this._flushOut();
    const j = e.jerr;
    if(j && j.name === "Gestoppt") this._print("\n— Programm gestoppt —\n", "sys");
    else if(j) this._showError(j);
    else this._print("\nInterner Fehler: " + e.message + "\n", "err");
  } finally {
    this.running = false;
    this.el.btnRun.disabled = this.readonlyNoRun || false;
    this.el.btnStop.disabled = true;
    this.el.status.textContent = "";
    if(this._pendInput){ this.el.cin.classList.remove("on"); this._pendInput = null; }
  }
};
JavaView.prototype.stop = function(){
  this.stopFlag.stopped = true;
  if(this._pendInput){                       // wartende Eingabe abbrechen
    const r = this._pendInput;
    this._pendInput = null;
    this.el.cin.classList.remove("on");
    r.resolve(null);
  }
};
JavaView.prototype._showError = function(j){
  const head = j.kind === "compile" ? "Compilerfehler" : (j.name || "Laufzeitfehler");
  const loc = (j.file || "") + (j.line ? ", Zeile " + j.line : "");
  this._print("\n" + head + (loc ? " (" + loc + ")" : "") + ":\n" + j.message + "\n", "err");
  /* Fehlerdatei öffnen + Zeile markieren */
  if(j.file){
    const i = this.files.findIndex(f => f.name === j.file);
    if(i >= 0 && this._visibleFiles().includes(this.files[i])){
      this._saveActive();
      this.active = i;
      this._renderTabs(); this._loadActive(true);
      if(j.line){
        this._renderGutter(j.line);
        const lh = 19.5;
        this.el.ed.scrollTop = Math.max(0, (j.line - 4) * lh);
        this.el.gutter.scrollTop = this.el.ed.scrollTop;
      }
    }
  }
};

/* ---------- API ---------- */
JavaView.prototype.getData = function(){
  this._saveActive();
  return { files: this.files.map(f => ({ name: f.name, content: f.content, readonly: !!f.readonly, hidden: !!f.hidden })) };
};
JavaView.prototype.setData = function(data){
  const fs = (data && Array.isArray(data.files) && data.files.length) ? data.files : [DEFAULT_FILE];
  this.files = fs.map(f => ({ name: f.name || "Main.java", content: f.content || "", readonly: !!f.readonly, hidden: !!f.hidden }));
  this.active = 0;
  this._undo = new Map();
  const mi = this.files.findIndex(f => /\bstatic\s+void\s+main\b/.test(f.content) && (this.mode !== "solve" || !f.hidden));
  if(mi >= 0) this.active = mi;
  this._renderTabs(); this._loadActive();
};
JavaView.prototype.setReadonly = function(b){
  this.readonlyAll = !!b;
  this._loadActive(true);
};
JavaView.prototype.destroy = function(){
  this.stop();
  clearTimeout(this._ct);
  if(this._outRaf) cancelAnimationFrame(this._outRaf);
};
JavaView.ensureStyles = ensureStyles;

window.JavaView = JavaView;

})();
