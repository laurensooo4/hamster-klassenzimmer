"use strict";
/* ============================================================================
   javaview.js — IDE-Oberfläche für das ☕-Java-Tool (Codeboard-angelehnt)
   ----------------------------------------------------------------------------
   window.JavaView — API wie FiliusView/SqlView:
     const v = new JavaView(hostElement, opts)
       opts.mode      "solve" (Schüler) | "edit" (Lehrkraft) | "view" (readonly)
                      | "free" (Sandbox/Review: Dateiverwaltung ohne Flags)
       opts.onChange  optionaler Callback bei Änderungen
     v.getData()      -> { files:[{name,content,readonly,hidden}] }
     v.setData(data)  Dateien setzen
     v.setReadonly(b) alles sperren (Review)
     v.destroy()      Programm stoppen + aufräumen
   v2.35: dunkler Editor mit Syntax-Farben (wie Hamster-Simulator),
   Hover-Signaturen für Methoden, Ziehgriffe für Editor-/Konsolenhöhe,
   Hamster-Einrückung (Enter = Einrückung der Vorzeile, kein Extra-Tab).
   Nutzt window.JavaEngine (javaengine.js muss vorher geladen sein).
   ============================================================================ */
(function(){

const LH = 21;                                   // Zeilenhöhe Editor (px) — überall identisch!
const EDFONT = '13.5px/21px "JetBrains Mono",Consolas,ui-monospace,monospace';

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
.jv-tab.on{background:#1f2530;color:#d6dbe4;border-color:var(--line,#e6ebf2)}
.jv-tab .ic{font-size:11px}
.jv-fileacts{display:flex;align-items:center;gap:10px;padding:5px 10px;border-bottom:1.5px solid var(--line,#e6ebf2);background:var(--bg,#f7f9fc);font-size:12px;color:var(--muted,#7a8aa0);flex-wrap:wrap}
.jv-fileacts label{display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-weight:700}
.jv-fileacts button{border:none;background:transparent;color:var(--blue,#1cb0f6);font-family:inherit;font-weight:800;font-size:12px;cursor:pointer;padding:2px 4px}
.jv-fileacts button.del{color:var(--red-d,#e63a3a)}
.jv-main{display:flex;flex-direction:column;flex:1;min-height:0}
.jv-edwrap{display:flex;flex:1;min-height:140px;position:relative;overflow:hidden;background:#1f2530}
.jv-gutter{width:46px;flex:none;background:#2a313e;border-right:1px solid #323a47;color:#5d6675;font:${EDFONT.replace("13.5px","12px")};text-align:right;padding:10px 7px 10px 0;overflow:hidden;user-select:none;white-space:pre}
.jv-gutter .err{background:var(--red,#ff4b4b);color:#fff;border-radius:4px;padding:0 3px;margin-right:-3px}
.jv-codebox{position:relative;flex:1;min-width:0;overflow:hidden}
.jv-hl,.jv-ed{position:absolute;inset:0;margin:0;padding:10px 12px;border:0;font:${EDFONT};white-space:pre;tab-size:4;overflow:auto}
.jv-hl{pointer-events:none;color:#d6dbe4;overflow:hidden}
.jv-ed{background:transparent;color:transparent;caret-color:#fff;resize:none;outline:none}
.jv-ed::selection{background:rgba(28,176,246,.35)}
.jv-ed[readonly]{caret-color:transparent}
.jv .c-kw{color:#c792ea}.jv .c-type{color:#82d2ff}.jv .c-lit{color:#ff9e7a}.jv .c-call{color:#82aaff}.jv .c-str{color:#c3e88d}.jv .c-num{color:#ff9e7a}.jv .c-com{color:#5f6b7d;font-style:italic}
.jv-tip{position:fixed;z-index:90;max-width:440px;background:#12161d;color:#dbe6f3;border:1px solid #323a47;border-radius:9px;padding:8px 11px;font:12px/1.55 ui-monospace,Consolas,monospace;box-shadow:0 8px 22px rgba(0,0,0,.4);pointer-events:none;display:none;white-space:pre-wrap}
.jv-tip .sig{color:#82d2ff;font-weight:700}
.jv-tip .desc{color:#8fa1b8;font-family:"Nunito",system-ui,sans-serif}
.jv-robanner{padding:5px 12px;background:#fff7e0;border-bottom:1.5px solid #e3c98a;color:#8a6d1d;font-size:12px;font-weight:700}
:root[data-theme="dark"] .jv-robanner{background:#3a3320;border-color:#6d5a26;color:#e8cf7a}
.jv-vresize{height:7px;flex:none;background:var(--bg,#f7f9fc);border-top:1.5px solid var(--line,#e6ebf2);border-bottom:1.5px solid var(--line,#e6ebf2);cursor:ns-resize;display:flex;align-items:center;justify-content:center}
.jv-vresize::after{content:"";width:44px;height:3px;border-radius:2px;background:var(--muted,#7a8aa0);opacity:.45}
.jv-console{background:#1d232c;display:flex;flex-direction:column;height:var(--jvConsole,190px);min-height:70px;flex:none}
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
.jv-hgrip{height:9px;flex:none;background:var(--bg,#f7f9fc);border-top:1.5px solid var(--line,#e6ebf2);cursor:ns-resize;display:flex;align-items:center;justify-content:center}
.jv-hgrip::after{content:"";width:56px;height:3px;border-radius:2px;background:var(--muted,#7a8aa0);opacity:.45}
.jv-status{font-size:12px;color:var(--muted,#7a8aa0);font-weight:700;margin-left:auto}
.jv-status .run{color:var(--green-d,#46a302)}
/* ---------- Light-Mode: heller Editor + helle Konsole (dunkel bleibt der Standard) ---------- */
:root[data-theme="light"] .jv-tab.on{background:#fff;color:#1f2530}
:root[data-theme="light"] .jv-edwrap{background:#fff}
:root[data-theme="light"] .jv-gutter{background:#f3f6fa;border-right-color:#e3e9f1;color:#7a8aa0}
:root[data-theme="light"] .jv-hl{color:#1f2530}
:root[data-theme="light"] .jv-ed{caret-color:#1a2330}
:root[data-theme="light"] .jv-ed[readonly]{caret-color:transparent}
:root[data-theme="light"] .jv-ed::selection{background:rgba(28,176,246,.22)}
:root[data-theme="light"] .jv .c-kw{color:#a626a4}
:root[data-theme="light"] .jv .c-type{color:#0184bc}
:root[data-theme="light"] .jv .c-lit{color:#e45649}
:root[data-theme="light"] .jv .c-call{color:#4078f2}
:root[data-theme="light"] .jv .c-str{color:#50a14f}
:root[data-theme="light"] .jv .c-num{color:#b76b01}
:root[data-theme="light"] .jv .c-com{color:#7a8aa0}
:root[data-theme="light"] .jv-tip{background:#fff;color:#3c4858;border-color:#dbe3ec;box-shadow:0 8px 22px rgba(30,40,60,.18)}
:root[data-theme="light"] .jv-tip .sig{color:#0184bc}
:root[data-theme="light"] .jv-tip .desc{color:#7a8aa0}
:root[data-theme="light"] .jv-console{background:#fafbfd}
:root[data-theme="light"] .jv-chead{color:#5d6b7e;background:#eef2f7}
:root[data-theme="light"] .jv-chead button{color:#5d6b7e}
:root[data-theme="light"] .jv-cout{color:#1f2530}
:root[data-theme="light"] .jv-cout .err{color:#d03530}
:root[data-theme="light"] .jv-cout .sys{color:#3a6ea8}
:root[data-theme="light"] .jv-cout .inp{color:#2f8f3f}
:root[data-theme="light"] .jv-cin{background:#eef2f7;border-top-color:#dbe3ec}
:root[data-theme="light"] .jv-cin .pfx{color:#2f8f3f}
:root[data-theme="light"] .jv-cin input{border-color:#d6dee9;background:#fff;color:#1f2530}
`;

function ensureStyles(){
  if(document.getElementById("jv-styles")){ document.getElementById("jv-styles").remove(); }
  const st = document.createElement("style");
  st.id = "jv-styles";
  st.textContent = CSS;
  document.head.appendChild(st);
}

const escH = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const DEFAULT_FILE = { name:"Main.java", content:'public class Main {\n\n\tpublic static void main(String[] args) {\n\t\tSystem.out.println("Hallo Welt!");\n\t}\n\n}\n', readonly:false, hidden:false };

/* ---------------- Syntax-Highlighting (Java) ---------------- */
const JKW = new Set(["class","extends","implements","public","private","protected","static","final","abstract","void","new","this","super","return","if","else","while","do","for","break","continue","switch","case","default","import","package","instanceof"]);
const JTYPE = new Set(["int","double","boolean","char","float","long","short","byte","String","ArrayList","Scanner","Math","System","Integer","Double","Boolean","Character","Object"]);
const JLIT = new Set(["true","false","null"]);
function highlightJava(src){
  let o = "", i = 0;
  const n = src.length;
  const isW = c => /[A-Za-z0-9_$ÄÖÜäöüß]/.test(c);
  while(i < n){
    const c = src[i];
    if(c === "/" && src[i+1] === "/"){ let j = i; while(j < n && src[j] !== "\n") j++; o += '<span class="c-com">' + escH(src.slice(i, j)) + "</span>"; i = j; continue; }
    if(c === "/" && src[i+1] === "*"){ let j = i + 2; while(j < n && !(src[j] === "*" && src[j+1] === "/")) j++; j = Math.min(n, j + 2); o += '<span class="c-com">' + escH(src.slice(i, j)) + "</span>"; i = j; continue; }
    if(c === '"'){ let j = i + 1; while(j < n && src[j] !== '"'){ if(src[j] === "\\") j++; j++; } j = Math.min(n, j + 1); o += '<span class="c-str">' + escH(src.slice(i, j)) + "</span>"; i = j; continue; }
    if(c === "'"){ let j = i + 1; while(j < n && src[j] !== "'"){ if(src[j] === "\\") j++; j++; } j = Math.min(n, j + 1); o += '<span class="c-str">' + escH(src.slice(i, j)) + "</span>"; i = j; continue; }
    if(/[0-9]/.test(c)){ let j = i; while(j < n && /[0-9.]/.test(src[j])) j++; o += '<span class="c-num">' + src.slice(i, j) + "</span>"; i = j; continue; }
    if(/[A-Za-z_$ÄÖÜäöüß]/.test(c)){
      let j = i; while(j < n && isW(src[j])) j++;
      const w = src.slice(i, j);
      let k = j; while(k < n && (src[k] === " " || src[k] === "\t")) k++;
      let cl = "";
      if(JKW.has(w)) cl = "c-kw";
      else if(JTYPE.has(w)) cl = "c-type";
      else if(JLIT.has(w)) cl = "c-lit";
      else if(src[k] === "(") cl = "c-call";
      o += cl ? '<span class="' + cl + '">' + escH(w) + "</span>" : escH(w);
      i = j; continue;
    }
    o += escH(c); i++;
  }
  return o;
}

/* ---------------- Hover-Signaturen: eingebaute Methoden ---------------- */
const BUILTIN_SIGS = {
  println:[["void println(x)","Gibt x aus und beendet die Zeile."]],
  print:[["void print(x)","Gibt x aus (ohne Zeilenumbruch)."]],
  length:[["int length()","Anzahl der Zeichen des Strings. (Arrays: .length ohne Klammern)"]],
  charAt:[["char charAt(int i)","Zeichen an Position i (0-basiert)."]],
  substring:[["String substring(int von)","Teilstring ab Position von."],["String substring(int von, int bisExkl)","Teilstring von..bisExkl-1."]],
  equals:[["boolean equals(x)","Inhaltlicher Vergleich (Strings NIE mit == vergleichen!)."]],
  equalsIgnoreCase:[["boolean equalsIgnoreCase(String s)","Vergleich ohne Groß-/Kleinschreibung."]],
  contains:[["boolean contains(String s)","Ist s enthalten?"]],
  indexOf:[["int indexOf(String|char x)","Erste Position von x, sonst -1."]],
  lastIndexOf:[["int lastIndexOf(String|char x)","Letzte Position von x, sonst -1."]],
  toUpperCase:[["String toUpperCase()","Alles in Großbuchstaben."]],
  toLowerCase:[["String toLowerCase()","Alles in Kleinbuchstaben."]],
  trim:[["String trim()","Entfernt Leerzeichen am Anfang/Ende."]],
  replace:[["String replace(alt, neu)","Ersetzt alle Vorkommen (char oder String)."]],
  split:[["String[] split(String trenner)","Zerlegt den String am Trenner."]],
  compareTo:[["int compareTo(String s)","<0, 0 oder >0 je nach Reihenfolge."]],
  isEmpty:[["boolean isEmpty()","Ist die Länge 0?"]],
  add:[["boolean add(E element)","Hängt ein Element hinten an."],["void add(int i, E element)","Fügt an Position i ein."]],
  get:[["E get(int i)","Element an Position i."]],
  set:[["E set(int i, E element)","Ersetzt Element an Position i."]],
  remove:[["E remove(int i)","Entfernt Element an Position i."]],
  size:[["int size()","Anzahl der Elemente."]],
  clear:[["void clear()","Entfernt alle Elemente."]],
  nextInt:[["int nextInt()","Liest die nächste ganze Zahl von der Konsole."]],
  nextDouble:[["double nextDouble()","Liest die nächste Kommazahl (mit PUNKT: 3.5)."]],
  nextLine:[["String nextLine()","Liest den Rest der Zeile."]],
  next:[["String next()","Liest das nächste Wort."]],
  nextBoolean:[["boolean nextBoolean()","Liest true oder false."]],
  close:[["void close()","Schließt den Scanner."]],
  abs:[["int|double Math.abs(x)","Betrag von x."]],
  max:[["int|double Math.max(a, b)","Größerer der beiden Werte."]],
  min:[["int|double Math.min(a, b)","Kleinerer der beiden Werte."]],
  pow:[["double Math.pow(basis, exponent)","Potenz."]],
  sqrt:[["double Math.sqrt(x)","Quadratwurzel."]],
  round:[["int Math.round(x)","Kaufmännisch gerundet."]],
  floor:[["double Math.floor(x)","Abrunden."]],
  ceil:[["double Math.ceil(x)","Aufrunden."]],
  random:[["double Math.random()","Zufallszahl 0.0 ≤ x < 1.0."]],
  parseInt:[["int Integer.parseInt(String s)","Wandelt Text in eine ganze Zahl um."]],
  parseDouble:[["double Double.parseDouble(String s)","Wandelt Text in eine Kommazahl um (Punkt!)."]],
  parseBoolean:[["boolean Boolean.parseBoolean(String s)",'true, wenn s (egal wie geschrieben) "true" ist.']],
  valueOf:[["String String.valueOf(x)","Wandelt x in einen String um."]],
  toString:[["String toString()","Text-Darstellung des Objekts (überschreibbar)."]],
  isDigit:[["boolean Character.isDigit(char c)","Ist c eine Ziffer?"]],
  isLetter:[["boolean Character.isLetter(char c)","Ist c ein Buchstabe?"]],
  main:[["public static void main(String[] args)","Hier startet das Programm."]],
};

function JavaView(host, opts){
  opts = opts || {};
  ensureStyles();
  const self = this;
  this.host = host;
  this.mode = opts.mode || "solve";
  this.readonlyAll = this.mode === "view";
  this.onChange = opts.onChange || null;
  this.files = [ JSON.parse(JSON.stringify(DEFAULT_FILE)) ];
  this.active = 0;
  this.stopFlag = { stopped:false };
  this.running = false;
  this._undo = new Map();
  this._pendInput = null;
  this._outBuf = ""; this._outRaf = 0; this._outTotal = 0;
  this._sigs = null; this._sigT = null;

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
          <div class="jv-codebox" data-r="codebox">
            <pre class="jv-hl" data-r="hl"></pre>
            <textarea class="jv-ed" data-r="ed" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
          </div>
        </div>
        <div class="jv-vresize" data-r="vresize" title="Konsolenhöhe ziehen"></div>
        <div class="jv-console" data-r="console">
          <div class="jv-chead">KONSOLE<span class="sp"></span><button data-a="clear">leeren</button></div>
          <pre class="jv-cout" data-r="cout"></pre>
          <div class="jv-cin" data-r="cin">
            <span class="pfx">›</span>
            <input data-r="cinp" placeholder="Eingabe … (Enter sendet)">
            <button data-a="send">Senden</button>
          </div>
        </div>
      </div>
      <div class="jv-hgrip" data-r="hgrip" title="Editor-Gesamthöhe ziehen"></div>
    </div>
    <div class="jv-tip" data-r="tip"></div>`;
  this.root = host.firstElementChild;
  const R = sel => host.querySelector('[data-r="' + sel + '"]');
  this.el = { tabs:R("tabs"), fileacts:R("fileacts"), robanner:R("robanner"), gutter:R("gutter"),
              hl:R("hl"), ed:R("ed"), codebox:R("codebox"), cout:R("cout"), cin:R("cin"), cinp:R("cinp"),
              status:R("status"), console:R("console"), vresize:R("vresize"), hgrip:R("hgrip"), tip:R("tip") };
  this.el.btnRun  = this.root.querySelector('[data-a="run"]');
  this.el.btnStop = this.root.querySelector('[data-a="stop"]');

  /* gespeicherte Größen wiederherstellen (Gesamthöhe NICHT im view-Modus — Modals behalten ihr Layout) */
  try{
    const ch = parseInt(localStorage.getItem("jvConH") || "", 10);
    if(ch >= 70 && ch <= 600) this.el.console.style.height = ch + "px";
    if(this.mode !== "view"){
      const th = parseInt(localStorage.getItem("jvTotH") || "", 10);
      if(th >= 380 && th <= 2200) host.style.height = th + "px";
    }
  }catch(e){}

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
  ed.addEventListener("scroll", () => self._syncScroll());
  ed.addEventListener("input", () => {
    self._saveActive();
    self._paint();
    self._commitSoon();
    self._sigSoon();
    if(self.onChange) self.onChange();
  });
  ed.addEventListener("keydown", (e) => {
    self._hideTip();
    if(ed.readOnly) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if(ctrl && !e.shiftKey && e.key.toLowerCase() === "z"){ e.preventDefault(); self._undoStep(-1); return; }
    if(ctrl && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))){ e.preventDefault(); self._undoStep(1); return; }
    if(e.key === "Tab"){
      e.preventDefault();
      self._insert("\t");
    } else if(e.key === "Enter"){
      /* Einrückung wie im Hamster-Simulator: Einrückung der aktuellen Zeile übernehmen,
         KEIN Extra-Tab nach '{'; Cursor am Zeilenanfang -> keine Einrückung. */
      e.preventDefault();
      const v = ed.value, s = ed.selectionStart;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const indent = (s === lineStart) ? "" : (v.slice(lineStart).match(/^[\t ]*/) || [""])[0];
      self._insert("\n" + indent);
    }
  });
  /* Hover-Signaturen */
  ed.addEventListener("mousemove", (e) => self._hoverMove(e));
  ed.addEventListener("mouseleave", () => self._hideTip());
  ed.addEventListener("mousedown", () => self._hideTip());
  /* Ziehgriffe */
  this._wireDrag(this.el.vresize, (dy, start) => {
    const h = Math.max(70, Math.min(600, start - dy));
    self.el.console.style.height = h + "px";
    try{ localStorage.setItem("jvConH", String(h)); }catch(e){}
    self._scrollOut();
  }, () => self.el.console.getBoundingClientRect().height);
  this._wireDrag(this.el.hgrip, (dy, start) => {
    const h = Math.max(380, Math.min(2200, start + dy));
    self.host.style.height = h + "px";
    try{ localStorage.setItem("jvTotH", String(h)); }catch(e){}
  }, () => self.host.getBoundingClientRect().height);

  this._renderTabs();
  this._loadActive();
  this._sigSoon();
}

JavaView.prototype._wireDrag = function(handle, onMove, getStart){
  let startY = 0, startV = 0, active = false;
  const move = (e) => { if(active) onMove(e.clientY - startY, startV); };
  const up = () => { active = false; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    active = true; startY = e.clientY; startV = getStart();
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
};

JavaView.prototype._insert = function(text){
  const ed = this.el.ed;
  const s = ed.selectionStart, e = ed.selectionEnd;
  ed.value = ed.value.slice(0, s) + text + ed.value.slice(e);
  ed.selectionStart = ed.selectionEnd = s + text.length;
  this._saveActive(); this._paint(); this._commit(); this._sigSoon();
  if(this.onChange) this.onChange();
};

/* ---------- Editor: Farben + Gutter + Scroll-Sync ---------- */
JavaView.prototype._paint = function(errLine){
  this.el.hl.innerHTML = highlightJava(this.el.ed.value) + "\n";
  const lines = this.el.ed.value.split("\n").length;
  let html = "";
  for(let i = 1; i <= lines; i++)
    html += (errLine === i ? '<span class="err">' + i + "</span>" : i) + "\n";
  this.el.gutter.innerHTML = html;
  this._syncScroll();
};
JavaView.prototype._syncScroll = function(){
  const ed = this.el.ed;
  this.el.hl.scrollTop = ed.scrollTop; this.el.hl.scrollLeft = ed.scrollLeft;
  this.el.gutter.scrollTop = ed.scrollTop;
};

/* ---------- Hover-Signaturen ---------- */
JavaView.prototype._sigSoon = function(){
  const self = this;
  clearTimeout(this._sigT);
  this._sigT = setTimeout(() => {
    try{
      self._saveActive();
      const compiled = JavaEngine.compile(self.files.map(f => ({ name: f.name, content: f.content })));
      const map = {};
      for(const c of compiled.chk.classes.values()){
        for(const m of c.methods){
          const ps = m.params.map(p => self._tn(p.type) + " " + p.name).join(", ");
          const sig = (m.static ? "static " : "") + self._tn(m.ret) + " " + m.name + "(" + ps + ")";
          (map[m.name] = map[m.name] || []).push([sig, "Klasse " + c.name + (m.abstract ? " (abstract)" : "")]);
        }
        for(const k of c.ctors){
          if(k.implicit) continue;
          const ps = k.params.map(p => self._tn(p.type) + " " + p.name).join(", ");
          (map[c.name] = map[c.name] || []).push([c.name + "(" + ps + ")", "Konstruktor der Klasse " + c.name]);
        }
      }
      self._sigs = map;
    }catch(e){ /* Compilerfehler: letzte gültige Signaturen behalten */ }
  }, 900);
};
JavaView.prototype._tn = function(t){
  if(!t) return "?";
  let s = t.base;
  if(t.elem) s += "<" + this._tn(t.elem) + ">";
  else if(t.targs && t.targs.length) s += "<" + t.targs.map(x => this._tn(x)).join(", ") + ">";
  for(let i = 0; i < (t.dims || 0); i++) s += "[]";
  return s;
};
JavaView.prototype._charW = function(){
  if(this._cw) return this._cw;
  const cv = document.createElement("canvas").getContext("2d");
  cv.font = "13.5px \"JetBrains Mono\",Consolas,ui-monospace,monospace";
  return (this._cw = cv.measureText("MMMMMMMMMM").width / 10);
};
JavaView.prototype._hoverMove = function(e){
  const self = this;
  clearTimeout(this._tipT);
  this._tipT = setTimeout(() => {
    const ed = self.el.ed;
    const r = ed.getBoundingClientRect();
    const y = e.clientY - r.top + ed.scrollTop - 10;
    const x = e.clientX - r.left + ed.scrollLeft - 12;
    const lineNo = Math.floor(y / LH);
    const lines = ed.value.split("\n");
    if(lineNo < 0 || lineNo >= lines.length){ self._hideTip(); return; }
    const line = lines[lineNo];
    /* Spalte -> Zeichenindex (Tabs = 4 Spalten) */
    const cw = self._charW();
    const col = Math.floor(x / cw);
    if(col < 0){ self._hideTip(); return; }
    let acc = 0, idx = -1;
    for(let i = 0; i < line.length; i++){
      const w = line[i] === "\t" ? (4 - (acc % 4)) : 1;
      if(col >= acc && col < acc + w){ idx = i; break; }
      acc += w;
    }
    if(idx < 0){ self._hideTip(); return; }
    /* Bezeichner unter dem Cursor */
    const isW = c => /[A-Za-z0-9_$ÄÖÜäöüß]/.test(c);
    if(!isW(line[idx])){ self._hideTip(); return; }
    let a = idx, b = idx;
    while(a > 0 && isW(line[a-1])) a--;
    while(b < line.length - 1 && isW(line[b+1])) b++;
    const word = line.slice(a, b + 1);
    let k = b + 1; while(k < line.length && (line[k] === " " || line[k] === "\t")) k++;
    const isCall = line[k] === "(";
    const entries = (self._sigs && self._sigs[word]) || BUILTIN_SIGS[word] || null;
    if(!entries || (!isCall && !(self._sigs && self._sigs[word]))){ self._hideTip(); return; }
    const tip = self.el.tip;
    tip.innerHTML = entries.slice(0, 4).map(x => '<div class="sig">' + escH(x[0]) + '</div><div class="desc">' + escH(x[1]) + "</div>").join('<div style="height:5px"></div>');
    tip.style.display = "block";
    const tw = Math.min(440, tip.offsetWidth || 300);
    tip.style.left = Math.min(window.innerWidth - tw - 12, e.clientX + 12) + "px";
    tip.style.top = (e.clientY + 16) + "px";
  }, 120);
};
JavaView.prototype._hideTip = function(){
  clearTimeout(this._tipT);
  if(this.el && this.el.tip) this.el.tip.style.display = "none";
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
                  (f.hidden ? '<span class="ic" title="im Editor ausgeblendet (wird mitkompiliert – kein Versteck für Lösungen!)">🙈</span>' : "");
    return '<span class="jv-tab' + (f === act ? " on" : "") + '" data-fi="' + i + '">' + escH(f.name) + marks + "</span>";
  }).join("");
  const self = this;
  this.el.tabs.querySelectorAll(".jv-tab").forEach(t => t.onclick = () => {
    self._saveActive(); self._commit();
    self.active = parseInt(t.dataset.fi, 10);
    self._renderTabs(); self._loadActive();
  });
  if(this.mode === "edit" || this.mode === "free"){
    const f = this.files[this.active];
    const flags = this.mode === "edit";
    this.el.fileacts.style.display = "";
    this.el.fileacts.innerHTML =
      '<b style="color:var(--ink,#3c4858)">' + escH(f.name) + "</b>" +
      (flags ? '<label><input type="checkbox" data-fa="ro"' + (f.readonly ? " checked" : "") + "> 🔒 schreibgeschützt (für Schüler:innen)</label>" +
               '<label title="Blendet die Datei im Schüler-Editor aus. Sie wird mitkompiliert und ist daher technisch auslesbar – KEINE Musterlösungen oder Prüf-Geheimnisse hier ablegen! Dafür gibt es die Musterlösung und versteckte Testfälle."><input type="checkbox" data-fa="hid"' + (f.hidden ? " checked" : "") + "> 🙈 im Editor ausblenden</label>" : "") +
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
JavaView.prototype._changed = function(){ this._sigSoon(); if(this.onChange) this.onChange(); };

JavaView.prototype._saveActive = function(){
  const f = this.files[this.active];
  if(f && !this._edLocked) f.content = this.el.ed.value;
};
JavaView.prototype._loadActive = function(keepScroll){
  const vis = this._visibleFiles();
  if(!vis.length){ this.el.ed.value = ""; this._paint(); return; }
  if(!vis.includes(this.files[this.active])) this.active = this.files.indexOf(vis[0]);
  const f = this.files[this.active];
  const ed = this.el.ed;
  const st = keepScroll ? ed.scrollTop : 0;
  ed.value = f.content;
  const locked = this.readonlyAll || (this.mode === "solve" && f.readonly);
  this._edLocked = locked;
  ed.readOnly = locked;
  this.el.robanner.style.display = (this.mode === "solve" && f.readonly) ? "" : "none";
  this._paint();
  ed.scrollTop = st;
  this._syncScroll();
};

/* ---------- Konsole ---------- */
JavaView.prototype._scrollOut = function(){
  const o = this.el.cout;
  o.scrollTop = o.scrollHeight;
  requestAnimationFrame(() => { o.scrollTop = o.scrollHeight; });   // nach Layout nochmal (immer ganz unten lesen können)
};
JavaView.prototype._print = function(text, cls){
  const self = this;
  if(cls){
    this._flushOut();
    const sp = document.createElement("span");
    sp.className = cls;
    sp.textContent = text;
    this.el.cout.appendChild(sp);
    this._scrollOut();
    return;
  }
  this._outBuf += text;
  this._outTotal = (this._outTotal || 0) + text.length;
  if(this._outTotal > 400000){ this._outBuf += "\n… (Ausgabe gekürzt – zu viel Text)"; this.stop(); }
  if(!this._outRaf) this._outRaf = requestAnimationFrame(() => self._flushOut());
};
JavaView.prototype._flushOut = function(){
  this._outRaf = 0;
  if(!this._outBuf) return;
  this.el.cout.appendChild(document.createTextNode(this._outBuf));
  this._outBuf = "";
  this._scrollOut();
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
  this._paint();
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
      self._scrollOut();
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
    if((j && j.name === "Gestoppt") || this.stopFlag.stopped) this._print("\n— Programm gestoppt —\n", "sys");
    else if(j) this._showError(j);
    else this._print("\nInterner Fehler: " + e.message + "\n", "err");
  } finally {
    this.running = false;
    this.el.btnRun.disabled = false;
    this.el.btnStop.disabled = true;
    this.el.status.textContent = "";
    if(this._pendInput){ this.el.cin.classList.remove("on"); this._pendInput = null; }
  }
};
JavaView.prototype.stop = function(){
  this.stopFlag.stopped = true;
  if(this._pendInput){
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
  if(j.file){
    const i = this.files.findIndex(f => f.name === j.file);
    if(i >= 0 && this._visibleFiles().includes(this.files[i])){
      this._saveActive();
      this.active = i;
      this._renderTabs(); this._loadActive(true);
      if(j.line){
        this._paint(j.line);
        this.el.ed.scrollTop = Math.max(0, (j.line - 4) * LH);
        this._syncScroll();
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
  this._renderTabs(); this._loadActive(); this._sigSoon();
};
JavaView.prototype.setReadonly = function(b){
  this.readonlyAll = !!b;
  this._loadActive(true);
};
JavaView.prototype.destroy = function(){
  this.stop();
  this._hideTip();
  clearTimeout(this._ct); clearTimeout(this._sigT); clearTimeout(this._tipT);
  if(this._outRaf) cancelAnimationFrame(this._outRaf);
  const tip = this.host && this.host.querySelector(".jv-tip");
  if(tip) tip.remove();
};
JavaView.ensureStyles = ensureStyles;

window.JavaView = JavaView;

})();
