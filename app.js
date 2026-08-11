"use strict";
/* ============================================================================
   Hamster-Klassenzimmer · App-Logik (Auth, Routing, Klassen)
   ============================================================================ */
const CONFIG = window.HAMSTER_CONFIG;
const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

let ME = null;          // aktuelles Profil {id, username, role, display_name}
let ACTIVE_TOOL = null; // gewähltes Lern-Tool: 'hamster' | 'sql' (null => Tool-Auswahl zeigen)
const app = () => document.getElementById("app");

/* ---------- Helfer ---------- */
const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
/* Aktualisieren-Schaltfläche neben dem Klassennamen (alle Tools, Lehrer+Schüler) */
const CLASS_REFRESH_BTN = '<button class="btn btn-ghost btn-sm" id="btnClassRefresh" title="Seite aktualisieren" style="vertical-align:middle;margin-left:6px">🔄</button>';
function wireClassRefresh(fn){ const b=document.getElementById("btnClassRefresh"); if(b) b.onclick=fn; }
/* Vorschau der (freigegebenen) Lehrer-Rückmeldung in der Aufgabenliste */
function feedbackPreviewHtml(body){ const t=(body||"").trim(); if(!t) return ""; const short=t.length>90?t.slice(0,90)+"…":t; return `<span class="s" style="color:var(--gold-d);font-weight:800">💬 Rückmeldung: ${esc(short)}</span>`; }
/* Rücksprung-Ziel für Unterseiten (Vorlagen/Sandbox/Datenbanken/Netzwerke): merkt sich,
   von wo die Seite geöffnet wurde, damit „zurück" dorthin führt (Übersicht ODER Klasse).
   back = {label, go} beim externen Aufruf; undefined bei internem Neu-Rendern (behält Ziel). */
function subBack(fn, back){ if(back && typeof back.go==="function") fn._back = back; return fn._back || null; }   // ignoriert Events/Müll – nur echte {label,go}-Objekte werden gespeichert
/* Vollbild-Overlay für die Abgabe-Matrix (über die gesamte Bildschirmbreite).
   paint(host, q, close) rendert die Matrix in host und verdrahtet die Zellen (ruft close() vor Navigation). */
function openMatrixModal(title, paint){
  if(document.querySelector(".matrix-modal")) return;   // nie doppelt öffnen (z. B. Enter auf fokussiertem ⛶-Button)
  const prevFocus = document.activeElement;
  const ov=document.createElement("div"); ov.className="matrix-modal";
  ov.innerHTML=`<div class="mm-head"><h2>${esc(title)}</h2><input class="input" id="mmSearch" placeholder="🔍 Schüler:in suchen" style="max-width:260px"><div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="mmClose" title="Schließen (Esc)">✕ Schließen</button></div><div class="mm-body" id="mmHost"></div>`;
  document.body.appendChild(ov);
  const appEl=document.getElementById("app"); if(appEl) appEl.inert=true;   // Seite dahinter aus der Tab-Reihenfolge nehmen (keine unsichtbaren Dialoge)
  const host=ov.querySelector("#mmHost"); let done=false;
  const close=()=>{ if(done) return; done=true; openMatrixModal._close=null; try{ ov.remove(); }catch(e){} document.removeEventListener("keydown", onKey); if(appEl) appEl.inert=false; if(prevFocus&&prevFocus.focus){ try{ prevFocus.focus(); }catch(e){} } };
  openMatrixModal._close = close;                       // für zentrales Schließen (z. B. Browser-Zurück)
  function onKey(e){ if(e.key==="Escape"){ e.stopPropagation(); close(); } }
  const repaint=(q)=> paint(host, q, close);
  repaint("");
  { const s=ov.querySelector("#mmSearch"); if(s){ s.oninput=()=> repaint(s.value); s.focus(); } }
  ov.querySelector("#mmClose").onclick=close;
  document.addEventListener("keydown", onKey);
}
const normUser = u => u.trim().toLowerCase();
const userEmail = u => normUser(u) + "@" + CONFIG.EMAIL_DOMAIN;
const initials = s => (s||"?").trim().slice(0,1).toUpperCase();
function toast(msg, type){ const t=document.getElementById("toast"); t.textContent=msg; t.className=(type||"")+" show"; clearTimeout(toast._t); toast._t=setTimeout(()=>t.className=t.className.replace("show","").trim(),2400); }
function hideSplash(){ const s=document.getElementById("splash"); if(s) s.classList.add("hide"); }
const HAMSTER = "🐹";

/* ---------- Theme (hell / dunkel / automatisch) ---------- */
function themePref(){ try{ return localStorage.getItem("themePref")||"auto"; }catch(e){ return "auto"; } }
function themeIsDark(p){ p=p||themePref(); return p==="dark" || (p==="auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme:dark)").matches); }
function applyTheme(){
  const p=themePref();
  document.documentElement.setAttribute("data-theme", themeIsDark(p)?"dark":"light");
  const b=document.getElementById("themeBtn");
  if(b){ b.textContent = p==="dark"?"🌙":p==="light"?"☀️":"🌗"; b.title = "Design: "+(p==="dark"?"Dunkel":p==="light"?"Hell":"Automatisch (System)")+" – klicken zum Wechseln"; }
}
function cycleTheme(){ const order=["auto","light","dark"]; const next=order[(order.indexOf(themePref())+1)%order.length]; try{ localStorage.setItem("themePref", next); }catch(e){} applyTheme(); }
if(window.matchMedia){ try{ window.matchMedia("(prefers-color-scheme:dark)").addEventListener("change", ()=>{ if(themePref()==="auto") applyTheme(); }); }catch(e){} }

/* ---------- Modal ---------- */
function openModal(html, wide){
  closeModal();
  const bg=document.createElement("div"); bg.className="modal-bg"; bg.id="modalBg";
  bg.innerHTML = `<div class="modal ${wide?"wide":""}">${html}</div>`;
  bg.addEventListener("mousedown", e=>{ if(e.target===bg) closeModal(); });
  document.body.appendChild(bg);
  return bg;
}
function closeModal(){ if(typeof modalView!=="undefined" && modalView){ try{ modalView.destroy(); }catch(e){} modalView=null; } const m=document.getElementById("modalBg"); if(m) m.remove(); }

/* ---------- Boot / Routing ---------- */
async function boot(){
  applyTheme();
  try{
    const { data:{ session } } = await sb.auth.getSession();
    if(session) await loadMe(session.user.id);
  }catch(e){ console.error(e); }
  hideSplash();
  route();
  sb.auth.onAuthStateChange((event)=>{ if(event==="SIGNED_OUT"){ ME=null; ACTIVE_TOOL=null; route(); } });
}
async function loadMe(uid){
  const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  if(error){ console.error(error); }
  ME = data || null;
  return ME;
}
let viewFromAdmin=false;   // merkt sich, ob eine Klasse aus der Admin-Ansicht geöffnet wurde
function route(){
  if(typeof setChrome === "function") setChrome();
  if(!ME){ renderAuth(); return; }
  if(!ACTIVE_TOOL){ toolLauncher(); return; }
  if(ACTIVE_TOOL==="sql"){ if(ME.role==="teacher") sqlTeacherHome(); else sqlStudentHome(); return; }
  if(ACTIVE_TOOL==="filius"){ if(ME.role==="teacher") filiusTeacherHome(); else filiusStudentHome(); return; }
  if(ACTIVE_TOOL==="java"){ if(ME.role==="teacher") javaTeacherHome(); else javaStudentHome(); return; }
  if(ME.role==="teacher") teacherHome();
  else studentHome();
}
async function signOut(){
  if(typeof pageLeave === "function"){ try{ await pageLeave(); }catch(e){} pageLeave = null; }   // Entwurf noch MIT Session sichern
  if(typeof navReset === "function") navReset();                                                 // Browser-History gehört zum Nutzer
  await sb.auth.signOut(); ME=null; ACTIVE_TOOL=null; renderAuth(); if(typeof setChrome==="function") setChrome();
}

/* ---------- Tool-Auswahl (Launcher) ---------- */
const TOOLS = [
  { id:"hamster", name:"Hamster-Simulator", icon:"🐹", desc:"Programmieren lernen mit dem Hamster – nach dem Java-Hamster-Modell von D. Boles", active:true },
  { id:"sql",     name:"SQL-Playground",    icon:"🗄️", desc:"Datenbanken & SQL-Abfragen üben",     active:true },
  { id:"filius",  name:"Netzwerke",         icon:"🌐", desc:"Computernetzwerke verstehen – angelehnt an FILIUS (Uni Siegen)", active:true },
  { id:"java",    name:"Java",              icon:"☕", desc:"Java programmieren wie die Profis",    active:true },
];
function toolLauncher(){
  shell(`<div class="page-head" style="justify-content:center;text-align:center"><div>
      <h2 style="margin:0">Was möchtest du nutzen?</h2></div></div>
    <div class="grid toolgrid">${TOOLS.map(t=>`
      <div class="card tool ${t.active?"click":"disabled"}" ${t.active?`data-tool="${t.id}"`:""}>
        <div class="ticon">${t.icon}</div>
        <h3 style="margin:0 0 4px">${esc(t.name)}</h3>
        <div class="meta">${esc(t.desc)}</div>
        ${t.active?"":'<div style="margin-top:10px"><span class="badge gray">in Arbeit</span></div>'}
      </div>`).join("")}</div>`);
  document.querySelectorAll(".card.tool.click[data-tool]").forEach(c=> c.onclick=()=> setTool(c.dataset.tool));
}
function setTool(id){ ACTIVE_TOOL=id; route(); }
function switchTool(){ ACTIVE_TOOL=null; route(); }
/* Tool-abhängige Lehrer-Klassenansicht (Hamster / SQL / Filius / Java) */
function classViewFor(tool){ return tool==="sql"?sqlTeacherClassView : tool==="filius"?filiusTeacherClassView : tool==="java"?javaTeacherClassView : teacherClassView; }

/* ============================================================================
   AUTH-SCREEN (Duolingo-Stil)
   ============================================================================ */
let authState = { mode:"login", role:"student" };
function renderAuth(){
  const s=authState; const cfg=window.HAMSTER_CONFIG||{};
  const allowReg = cfg.ALLOW_REGISTRATION !== false;   // Release/Schulserver kann Selbst-Registrierung abschalten (nur Login)
  if(!allowReg) s.mode="login";
  const isReg = allowReg && s.mode==="register";
  const logoSrc = cfg.LOGO_URL || "logo-gywem.png";   // Standard: Schul-Logo (Fallback 🐹, falls Datei fehlt)
  const logo = `<img src="${esc(logoSrc)}" alt="Logo" style="max-height:92px;max-width:82%;object-fit:contain" onerror="this.outerHTML='${HAMSTER}'">`;
  const codeField = isReg ? (s.role==="teacher"
      ? `<div class="field"><label>Einladungscode</label><input class="input" id="auCode" placeholder="z. B. AB3KM-7PQXR-…" autocomplete="off" style="font-family:ui-monospace,Consolas,monospace;letter-spacing:1px"></div>`
      : `<div class="field"><label>Klassencode <span style="color:#7a8aa0;font-weight:600;text-transform:none;letter-spacing:0">(optional)</span></label><input class="input" id="auCode" placeholder="z. B. K7Q2MX – kann leer bleiben" autocomplete="off" style="text-transform:uppercase;letter-spacing:2px;font-family:monospace"></div>`) : "";
  const foot = isReg ? (s.role==="teacher" ? "Lehrer:innen brauchen einen persönlichen Einladungscode von der Administration." : "Mit Klassencode trittst du direkt bei – oder ohne starten und später beitreten.")
                     : (allowReg ? 'Noch kein Account? Tippe oben auf "Registrieren".' : 'Deine Zugangsdaten bekommst du von deiner Schule.');
  app().innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="mascot">${logo}</div>
    <h1>Informatik am Gymnasium Wesermünde</h1>
    <p class="sub">${isReg?"Lass uns loslegen!":"Willkommen zurück!"}</p>
    ${allowReg?`<div class="tabs">
      <button data-m="login" class="${!isReg?"active":""}">Anmelden</button>
      <button data-m="register" class="${isReg?"active":""}">Registrieren</button>
    </div>`:""}
    <div class="auth-msg" id="authMsg"></div>
    ${isReg ? `<div class="field"><label>Ich bin…</label>
        <div class="role-pick">
          <div class="role-opt ${s.role==="student"?"active":""}" data-role="student"><span class="ic">🎒</span>Schüler:in</div>
          <div class="role-opt ${s.role==="teacher"?"active":""}" data-role="teacher"><span class="ic">👨‍🏫</span>Lehrer:in</div>
        </div></div>` : ""}
    ${codeField}
    ${isReg?`<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Vorname</label><input class="input" id="auFirst" autocomplete="given-name"></div><div class="field" style="flex:1"><label>Nachname</label><input class="input" id="auLast" autocomplete="family-name"></div></div>`:""}
    <div class="field"><label>Benutzername</label>
      <input class="input" id="auUser" placeholder="z. B. max.muster" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    <div class="field"><label>Passwort</label>
      <input class="input" id="auPass" type="password" placeholder="Passwort" autocomplete="${isReg?"new-password":"current-password"}"></div>
    <button class="btn btn-primary btn-lg" id="auSubmit">${isReg?"Account erstellen":"Anmelden"}</button>
    <p class="auth-foot">${foot}</p>
  </div></div>`;
  app().querySelectorAll(".tabs button").forEach(b=> b.onclick=()=>{ authState.mode=b.dataset.m; renderAuth(); });
  app().querySelectorAll(".role-opt").forEach(r=> r.onclick=()=>{ authState.role=r.dataset.role; renderAuth(); });
  const submit = ()=> isReg ? doRegister() : doLogin();
  document.getElementById("auSubmit").onclick = submit;
  document.getElementById("auPass").addEventListener("keydown", e=>{ if(e.key==="Enter") submit(); });
  document.getElementById("auUser").focus();
}
function authMsg(text, type){ const m=document.getElementById("authMsg"); if(!m) return; m.textContent=text; m.className="auth-msg "+(type||"err"); }

async function doLogin(){
  const u=document.getElementById("auUser").value, p=document.getElementById("auPass").value;
  if(!u||!p){ authMsg("Bitte Benutzername und Passwort eingeben."); return; }
  setBusy(true);
  const { data, error } = await sb.auth.signInWithPassword({ email:userEmail(u), password:p });
  if(error){ setBusy(false); authMsg("Benutzername oder Passwort ist falsch."); return; }
  await loadMe(data.user.id);
  if(!ME){
    await sb.from("profiles").insert({ id:data.user.id, username:normUser(u), role:"student", display_name:u.trim() });
    await loadMe(data.user.id);
  }
  ACTIVE_TOOL=null;   // neue Anmeldung -> immer Tool-Auswahl zeigen (geteiltes Gerät)
  if(typeof navReset === "function") navReset();   // Browser-Historie des vorherigen Nutzers verwerfen
  route();
}
async function doRegister(){
  const uRaw=document.getElementById("auUser").value.trim(), p=document.getElementById("auPass").value, role=authState.role;
  const u=normUser(uRaw);
  const codeEl=document.getElementById("auCode"); const code=codeEl?codeEl.value.trim():"";
  const first=(document.getElementById("auFirst")||{value:""}).value.trim();
  const last=(document.getElementById("auLast")||{value:""}).value.trim();
  if(!/^[a-z0-9_.\-]{3,20}$/.test(u)){ authMsg("Benutzername: 3-20 Zeichen, nur Buchstaben/Zahlen/._-"); return; }
  if(!first||!last){ authMsg("Bitte Vor- und Nachnamen eingeben."); return; }
  if(p.length<6){ authMsg("Das Passwort muss mindestens 6 Zeichen haben."); return; }
  if(role==="teacher" && !code){ authMsg("Bitte den Einladungscode eingeben."); return; }
  const displayName = first+" "+last;
  setBusy(true);
  ACTIVE_TOOL=null;   // Standard: nach Registrierung Tool-Auswahl (bei Klassencode-Beitritt unten überschrieben)
  // 1) Code prüfen, BEVOR ein Account angelegt wird
  let className=null;
  if(role==="teacher"){
    const { data:ok, error:e1 } = await sb.rpc("check_teacher_code", { p_code: code });
    if(e1){ setBusy(false); authMsg("Prüfung fehlgeschlagen: "+e1.message); return; }
    if(!ok){ setBusy(false); authMsg("Dieser Einladungscode ist ungültig, schon benutzt oder abgelaufen."); return; }
  } else if(code){
    const { data:cn, error:e1 } = await sb.rpc("class_exists", { p_code: code });
    if(e1){ setBusy(false); authMsg("Prüfung fehlgeschlagen: "+e1.message); return; }
    if(!cn){ setBusy(false); authMsg("Klassencode nicht gefunden."); return; }
    className=cn;
  }
  // 2) Account anlegen
  const { data, error } = await sb.auth.signUp({ email:userEmail(u), password:p });
  if(error){ setBusy(false); if(/already registered|already exists/i.test(error.message)) authMsg("Dieser Benutzername ist schon vergeben."); else authMsg(error.message); return; }
  const uid = data.user.id;
  // 3) Profil anlegen (+ Klassenbeitritt bei Schüler:innen)
  if(role==="teacher"){
    const { error:e2 } = await sb.rpc("register_teacher", { p_username:u, p_display:displayName, p_code:code });
    if(e2){ setBusy(false); authMsg("Registrierung fehlgeschlagen: "+e2.message); return; }
  } else {
    const { error:e2 } = await sb.from("profiles").insert({ id:uid, username:u, role:"student", display_name:displayName });
    if(e2){ setBusy(false); if(/duplicate|unique/i.test(e2.message)) authMsg("Dieser Benutzername ist schon vergeben."); else authMsg("Profil konnte nicht angelegt werden: "+e2.message); return; }
    if(code){ const { data:jc, error:e3 } = await sb.rpc("join_class", { p_code: code }); if(e3){ setBusy(false); authMsg("Beitritt fehlgeschlagen: "+e3.message); return; } const j=Array.isArray(jc)?jc[0]:jc; if(j&&j.tool) ACTIVE_TOOL=j.tool; }
  }
  await loadMe(uid);
  if(typeof navReset === "function") navReset();
  toast(className?("Willkommen in "+className+", "+first+"! 🎉"):("Willkommen, "+first+"! 🎉"),"ok");
  route();
}
function setBusy(b){ const btn=document.getElementById("auSubmit"); if(btn){ btn.disabled=b; btn.innerHTML = b?'<span class="spin" style="width:18px;height:18px;border-top-color:#fff;border-color:rgba(255,255,255,.4)"></span>':(authState.mode==="login"?"Anmelden":"Account erstellen"); } }

/* ============================================================================
   APP-SHELL (Topbar)
   ============================================================================ */
let pageLeave = null;   // Seiten registrieren hier einen Hook, der VOR jedem Seitenwechsel feuert (z. B. Entwurf sichern)
function shell(inner){
  if(typeof pageLeave === "function"){ try{ pageLeave(); }catch(e){} pageLeave = null; }
  if(typeof pageView!=="undefined" && pageView){ try{ pageView.destroy(); }catch(e){} pageView=null; }
  const roleBadge = ME.is_admin ? `<span class="badge" style="background:#ffe0b2;color:#b35900">Admin</span>` : ME.role==="teacher" ? `<span class="badge blue">Lehrkraft</span>` : `<span class="badge">Schüler:in</span>`;
  app().innerHTML = `
    <div class="topbar">
      <div class="brand"><img class="blogo" src="logo-gywem.png" alt="" onerror="this.outerHTML='<span class=&quot;h&quot;>${HAMSTER}</span>'"> Informatik am Gymnasium Wesermünde</div>
      <button class="btn btn-ghost btn-sm" id="homeBtn" title="Zur Tool-Auswahl" style="margin-left:8px">🏠</button>
      ${ACTIVE_TOOL?`<span style="margin-left:9px;font-weight:800;font-size:13.5px;color:var(--muted)">${esc((TOOLS.find(t=>t.id===ACTIVE_TOOL)||{}).name||"")}</span>`:""}
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" id="themeBtn" title="Design wechseln" style="margin-right:8px">🌗</button>
      ${roleBadge}
      <div class="usermenu">
        <button class="chip ${ME.role} chipbtn" id="userBtn" title="Konto-Menü"><span class="av">${esc(initials(ME.display_name||ME.username))}</span>${esc(ME.display_name||ME.username)}<span class="caret">▾</span></button>
        <div class="menu" id="userMenu" style="display:none">
          ${ME.is_admin?`<button class="menu-item" data-act="admin">🛠️ Admin-Bereich</button>`:""}
          <button class="menu-item" data-act="pw">🔑 Passwort ändern</button>
          <button class="menu-item danger" data-act="logout">🚪 Abmelden</button>
        </div>
      </div>
    </div>
    <div class="container" id="view"></div>
    ${ME.role==="teacher"?`<button class="patch-fab" id="btnPatch" title="Patch-Notes – was ist neu?"><span class="dot"></span>🗒️<span class="lbl">&nbsp;Patch-Notes</span></button>`:""}`;
  { const hb=document.getElementById("homeBtn"); if(hb) hb.onclick=()=> switchTool(); }
  { const ub=document.getElementById("userBtn"), um=document.getElementById("userMenu");
    if(ub&&um){
      ub.onclick=(e)=>{ e.stopPropagation(); um.style.display = (um.style.display==="none"?"block":"none"); };
      um.querySelectorAll("[data-act]").forEach(b=> b.onclick=()=>{ const a=b.dataset.act; um.style.display="none"; if(a==="admin") adminHome(); else if(a==="pw") changePasswordDialog(); else if(a==="logout") signOut(); });
    }
  }
  if(!window._umClose){ window._umClose=true; document.addEventListener("click",(e)=>{ const um=document.getElementById("userMenu"); if(um && um.style.display!=="none" && !e.target.closest("#userMenu") && !e.target.closest("#userBtn")) um.style.display="none"; }); }
  { const bp=document.getElementById("btnPatch"); if(bp) bp.onclick = patchNotesDialog; }
  { const tb=document.getElementById("themeBtn"); if(tb) tb.onclick = cycleTheme; }
  applyTheme();
  document.getElementById("view").innerHTML = inner;
}

/* ============================================================================
   DATEN-API
   ============================================================================ */
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(n){ n=n||6; let s=""; const a=new Uint32Array(n); window.crypto.getRandomValues(a); for(let i=0;i<n;i++) s+=ALPH[a[i]%ALPH.length]; return s; }

const api = {
  async myClasses(){
    const { data, error } = await sb.from("classes").select("*").eq("tool", ACTIVE_TOOL||"hamster").order("created_at",{ascending:false});
    if(error) throw error; return data||[];
  },
  // Lehrer-Ansicht: NUR eigene + Klassen, in denen ich Co-Lehrkraft bin (auch als Admin) – gefiltert nach aktivem Tool
  async myTeacherClasses(){
    const tool = ACTIVE_TOOL||"hamster";
    const own = await sb.from("classes").select("*").eq("teacher_id", ME.id).eq("tool", tool); if(own.error) throw own.error;
    const ct = await sb.from("class_teachers").select("class_id").eq("teacher_id", ME.id); if(ct.error) throw ct.error;
    const coIds = (ct.data||[]).map(r=>r.class_id);
    let co=[]; if(coIds.length){ const r = await sb.from("classes").select("*").in("id", coIds); if(r.error) throw r.error; co=(r.data||[]).filter(c=>c.tool===tool); }
    const map=new Map(); [...(own.data||[]), ...co].forEach(c=> map.set(c.id, c));
    return [...map.values()].sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  },
  async deleteClass(id){ const { error } = await sb.from("classes").delete().eq("id", id); if(error) throw error; },
  async createClass(name, toolArg){
    const tool = toolArg || ACTIVE_TOOL || "hamster";
    for(let tries=0; tries<5; tries++){
      const code = genCode(6);
      const { data, error } = await sb.from("classes").insert({ name, code, teacher_id:ME.id, tool }).select().single();
      if(!error) return data;
      if(!/duplicate|unique/i.test(error.message)) throw error;
    }
    throw new Error("Konnte keinen eindeutigen Code erzeugen.");
  },
  async joinClass(code){
    const { data, error } = await sb.rpc("join_class", { p_code: code });
    if(error) throw error; return Array.isArray(data)?data[0]:data;
  },
  async classRoster(classId){
    const { data, error } = await sb.from("memberships")
      .select("student_id, joined_at, profiles:student_id(username,display_name)")
      .eq("class_id", classId).order("joined_at");
    if(error) throw error; return data||[];
  },
};

/* ===== Aufgaben & Abgaben ===== */
let modalView=null, pageView=null;
let solveState=null, reviewState=null, sampleState=null, sandboxState=null, assignEditState=null;
let classSecOpen={};   // pro Klasse {auf,mat,stu,leh}: Einklapp-Status, überlebt Re-Render, klassenspezifisch
let _classActivity=null;                                      // Cache {class_id: ms} für die Sortierung "letzte Änderung"
const DEFAULT_STARTER = "void main() {\n\t\n}";
api.listAssignments = async (classId)=>{ const {data,error}=await sb.from("assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };
api.getAssignment = async (id)=>{ const {data,error}=await sb.from("assignments").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.createAssignment = async (a)=>{ const {data:mn}=await sb.from("assignments").select("position").eq("class_id",a.class_id).order("position",{ascending:true}).limit(1); const position=(mn&&mn[0]?mn[0].position:1)-1; const {data,error}=await sb.from("assignments").insert(Object.assign({position},a)).select().single(); if(error) throw error; return data; };   // neue Aufgabe ganz nach OBEN
api.deleteAssignment = async (id)=>{ const {error}=await sb.from("assignments").delete().eq("id",id); if(error) throw error; };
api.updateAssignment = async (id, patch)=>{ const {data,error}=await sb.from("assignments").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
api.listTemplates = async ()=>{ const {data,error}=await sb.from("templates").select("*").order("created_at",{ascending:false}); if(error) throw error; return data||[]; };
api.createTemplate = async (t)=>{ const {data,error}=await sb.from("templates").insert(Object.assign({owner_id:ME.id},t)).select().single(); if(error) throw error; return data; };
api.deleteTemplate = async (id)=>{ const {error}=await sb.from("templates").delete().eq("id",id); if(error) throw error; };
api.updateTemplate = async (id, patch)=>{ const {data,error}=await sb.from("templates").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
async function moveAssignment(list, id, dir){ const i=list.findIndex(x=>x.id===id); const j=i+dir; if(i<0||j<0||j>=list.length) return; const a=list[i], b=list[j]; await api.updateAssignment(a.id,{position:b.position}); await api.updateAssignment(b.id,{position:a.position}); }
/* Abgaben: mehrere je Schüler:in + Historie; genau eine ist "aktuell" (is_current) */
api.addSubmission = async (s)=>{ const row=Object.assign({student_id:ME.id, is_current:true, submitted_at:new Date().toISOString()}, s); const {data,error}=await sb.from("submissions").insert(row).select().single(); if(error) throw error; return data; };
api.myCurrentSubmission = async (assignmentId)=>{ const {data,error}=await sb.from("submissions").select("*").eq("assignment_id",assignmentId).eq("student_id",ME.id).eq("is_current",true).maybeSingle(); if(error) throw error; return data; };
api.mySubmissions = async (assignmentId)=>{ const {data,error}=await sb.from("submissions").select("*").eq("assignment_id",assignmentId).eq("student_id",ME.id).order("submitted_at",{ascending:false}); if(error) throw error; return data||[]; };
api.classSubmissions = async (assignmentIds)=>{ if(!assignmentIds.length) return []; const {data,error}=await sb.from("submissions").select("*").in("assignment_id",assignmentIds).order("submitted_at",{ascending:false}); if(error) throw error; return data||[]; };

/* Schüler-Kommentar zur eigenen Abgabe (Lehrkraft kann lesen) */
api.getSubmissionNote = async (subId)=>{ const {data,error}=await sb.from("submission_student_notes").select("*").eq("submission_id",subId).maybeSingle(); if(error) throw error; return data; };
api.saveSubmissionNote = async (subId, body)=>{ const {error}=await sb.from("submission_student_notes").upsert({submission_id:subId, body, updated_at:new Date().toISOString()},{onConflict:"submission_id"}); if(error) throw error; };
api.deleteSubmissionNote = async (subId)=>{ const {error}=await sb.from("submission_student_notes").delete().eq("submission_id",subId); if(error) throw error; };
api.submissionNotes = async (subIds)=>{ if(!subIds.length) return []; const {data,error}=await sb.from("submission_student_notes").select("*").in("submission_id",subIds); if(error) throw error; return data||[]; };

/* Lehrer: Schüler-Überblick + Notizen */
api.studentOverview = async (sid)=>{ const {data,error}=await sb.rpc("student_overview",{p_student:sid}); if(error) throw error; return (Array.isArray(data)?data[0]:data)||null; };
api.getStudentNote = async (classId, sid)=>{ const {data,error}=await sb.from("student_notes").select("*").eq("class_id",classId).eq("student_id",sid).maybeSingle(); if(error) throw error; return data; };
api.saveStudentNote = async (classId, sid, body)=>{ const {error}=await sb.from("student_notes").upsert({class_id:classId, student_id:sid, author_id:ME.id, body, updated_at:new Date().toISOString()},{onConflict:"class_id,student_id"}); if(error) throw error; };

/* Lehrer-Kommentare zu einer Abgabe (für Schüler:in freigebbar) */
api.getComment = async (submissionId)=>{ const {data,error}=await sb.from("submission_comments").select("*").eq("submission_id",submissionId).maybeSingle(); if(error) throw error; return data; };
api.myComments = async (submissionIds)=>{ if(!submissionIds.length) return []; const {data,error}=await sb.from("submission_comments").select("*").in("submission_id",submissionIds); if(error) throw error; return data||[]; };
api.saveComment = async (submissionId, body, released)=>{ const {data,error}=await sb.from("submission_comments").upsert({submission_id:submissionId, author_id:ME.id, body, released, updated_at:new Date().toISOString()},{onConflict:"submission_id"}).select().single(); if(error) throw error; return data; };
api.deleteComment = async (submissionId)=>{ const {error}=await sb.from("submission_comments").delete().eq("submission_id",submissionId); if(error) throw error; };

/* Musterlösungen (mehrere je Aufgabe, freigebbar, löschbar) */
api.listSamples = async (assignmentId)=>{ const {data,error}=await sb.from("sample_solutions").select("*").eq("assignment_id",assignmentId).order("created_at"); if(error) throw error; return data||[]; };
api.releasedSamples = async (assignmentId)=>{ const {data,error}=await sb.from("sample_solutions").select("*").eq("assignment_id",assignmentId).eq("released",true).order("created_at"); if(error) throw error; return data||[]; };
api.createSample = async (s)=>{ const {data,error}=await sb.from("sample_solutions").insert(Object.assign({author_id:ME.id}, s)).select().single(); if(error) throw error; return data; };
api.updateSample = async (id, patch)=>{ const {data,error}=await sb.from("sample_solutions").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
api.deleteSample = async (id)=>{ const {error}=await sb.from("sample_solutions").delete().eq("id",id); if(error) throw error; };

/* Lösungscode je Aufgabe (nur Lehrkraft – treibt den Auto-Check "Mit Musterlösung vergleichen") */
api.getAssignmentSolution = async (assignmentId)=>{ const {data,error}=await sb.from("assignment_solutions").select("*").eq("assignment_id",assignmentId).maybeSingle(); if(error) throw error; return data; };
api.saveAssignmentSolution = async (assignmentId, code, matchHamster)=>{ const {error}=await sb.from("assignment_solutions").upsert({assignment_id:assignmentId, author_id:ME.id, code, match_hamster:!!matchHamster, updated_at:new Date().toISOString()},{onConflict:"assignment_id"}); if(error) throw error; };
api.deleteAssignmentSolution = async (assignmentId)=>{ const {error}=await sb.from("assignment_solutions").delete().eq("assignment_id",assignmentId); if(error) throw error; };

/* Sandbox: je Klasse aktivierbar; Schüler-Projekte (Welt + Code) */
api.setSandboxEnabled = async (classId, on)=>{ const {error}=await sb.from("classes").update({sandbox_enabled:!!on}).eq("id",classId); if(error) throw error; };
api.listSandboxProjects = async (classId)=>{ let q=sb.from("sandbox_projects").select("*").eq("owner_id",ME.id); q = (classId==null) ? q.is("class_id",null) : q.eq("class_id",classId); const {data,error}=await q.order("updated_at",{ascending:false}); if(error) throw error; return data||[]; };
api.getSandboxProject = async (id)=>{ const {data,error}=await sb.from("sandbox_projects").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.createSandboxProject = async (p)=>{ const {data,error}=await sb.from("sandbox_projects").insert(Object.assign({owner_id:ME.id},p)).select().single(); if(error) throw error; return data; };
api.updateSandboxProject = async (id, patch)=>{ const {data,error}=await sb.from("sandbox_projects").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.deleteSandboxProject = async (id)=>{ const {error}=await sb.from("sandbox_projects").delete().eq("id",id); if(error) throw error; };

/* Mehrere Lehrkräfte je Klasse + Schüler/Lehrer entfernen/löschen + Admin-Flag */
api.assignableTeachers = async ()=>{ const {data,error}=await sb.rpc("assignable_teachers"); if(error) throw error; return data||[]; };
api.classTeachersNamed = async (classId)=>{ const {data,error}=await sb.rpc("class_teachers_named",{p_class:classId}); if(error) throw error; return data||[]; };
api.addClassTeacher = async (classId, teacherId)=>{ const {error}=await sb.from("class_teachers").insert({class_id:classId, teacher_id:teacherId}); if(error) throw error; };
api.removeClassTeacher = async (classId, teacherId)=>{ const {error}=await sb.from("class_teachers").delete().eq("class_id",classId).eq("teacher_id",teacherId); if(error) throw error; };
api.transferClass = async (classId, newOwnerId)=>{ const {error}=await sb.rpc("transfer_class",{p_class:classId, p_new_owner:newOwnerId}); if(error) throw error; };
api.removeMembership = async (classId, studentId)=>{ const {error}=await sb.from("memberships").delete().eq("class_id",classId).eq("student_id",studentId); if(error) throw error; };
api.adminDeleteUser = async (userId)=>{ const {error}=await sb.rpc("admin_delete_user",{p_user:userId}); if(error) throw error; };
api.setAdmin = async (userId, makeAdmin)=>{ const {error}=await sb.rpc("set_admin",{p_user:userId, p_make:!!makeAdmin}); if(error) throw error; };
api.adminRenameUser = async (userId, newName)=>{ const {error}=await sb.rpc("admin_rename_user",{p_user:userId, p_new:newName}); if(error) throw error; };
api.setClassJoinOpen = async (classId, open)=>{ const {error}=await sb.from("classes").update({join_open:!!open}).eq("id",classId); if(error) throw error; };
api.regenerateClassCode = async (classId)=>{ for(let t=0;t<6;t++){ const code=genCode(6); const {error}=await sb.from("classes").update({code}).eq("id",classId); if(!error) return code; if(!/duplicate|unique/i.test(error.message)) throw error; } throw new Error("Konnte keinen eindeutigen Code erzeugen."); };
api.adminSetRole = async (userId, role)=>{ const {error}=await sb.rpc("admin_set_role",{p_user:userId, p_role:role}); if(error) throw error; };
api.adminSetDisplayName = async (userId, name)=>{ const {error}=await sb.rpc("admin_set_display_name",{p_user:userId, p_display:name}); if(error) throw error; };
/* ===== Lehrer-Einladungen (phaseZ): einmalige, ablaufende Codes statt festem Lehrer-Code ===== */
api.adminListInvites = async ()=>{ const {data,error}=await sb.from("teacher_invites").select("token_hash,note,created_at,expires_at,used_at,used_by,user:used_by(display_name,username)").order("created_at",{ascending:false}); if(error) throw error; return data||[]; };
api.adminCreateInvite = async (note, days)=>{ const {data,error}=await sb.rpc("admin_create_teacher_invite",{p_note:note||null, p_days:days||14}); if(error) throw error; return data; };
api.adminDeleteInvite = async (hash)=>{ const {error}=await sb.from("teacher_invites").delete().eq("token_hash",hash); if(error) throw error; };
/* ===== SQL-Playground: Datenbank-Bibliothek ===== */
api.sqlListDatabases = async ()=>{ const {data,error}=await sb.rpc("shared_sql_databases"); if(error) throw error; return data||[]; };
api.sandboxSqlDatabases = async ()=>{ const {data,error}=await sb.rpc("sandbox_sql_databases"); if(error) throw error; return data||[]; };   // Sandbox: geteilte + eigene (Lehrer) + Aufgaben-DBs (Schüler)
/* SQL-Sandbox: private Projekte (phaseU) */
api.listSqlSandboxProjects = async ()=>{ const {data,error}=await sb.from("sql_sandbox_projects").select("id,title,updated_at").eq("owner_id",ME.id).order("updated_at",{ascending:false}); if(error) throw error; return data||[]; };
api.getSqlSandboxProject = async (id)=>{ const {data,error}=await sb.from("sql_sandbox_projects").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.createSqlSandboxProject = async (p)=>{ const {data,error}=await sb.from("sql_sandbox_projects").insert(Object.assign({owner_id:ME.id},p)).select().single(); if(error) throw error; return data; };
api.updateSqlSandboxProject = async (id,patch)=>{ const {data,error}=await sb.from("sql_sandbox_projects").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.deleteSqlSandboxProject = async (id)=>{ const {error}=await sb.from("sql_sandbox_projects").delete().eq("id",id); if(error) throw error; };
/* Vorhandene:n Schüler:in per Benutzername zur Klasse hinzufügen (phaseU) */
api.enrollExistingStudent = async (classId, username)=>{ const {data,error}=await sb.rpc("teacher_enroll_student_by_username",{p_class:classId, p_username:username}); if(error) throw error; return data; };
api.sqlGetDatabase = async (id)=>{ const {data,error}=await sb.from("sql_databases").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.sqlCreateDatabase = async (d)=>{ const {data,error}=await sb.from("sql_databases").insert(Object.assign({owner_id:ME.id},d)).select().single(); if(error) throw error; return data; };
api.sqlUpdateDatabase = async (id,patch)=>{ const {data,error}=await sb.from("sql_databases").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.sqlDeleteDatabase = async (id)=>{ const {error}=await sb.from("sql_databases").delete().eq("id",id); if(error) throw error; };
/* ===== SQL-Playground: Aufgaben + Teilaufgaben ===== */
api.sqlListAssignments = async (classId)=>{ const {data,error}=await sb.from("sql_assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };
api.sqlGetAssignment = async (id)=>{ const {data,error}=await sb.from("sql_assignments").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.sqlCreateAssignment = async (a)=>{ const {data:mn}=await sb.from("sql_assignments").select("position").eq("class_id",a.class_id).order("position",{ascending:true}).limit(1); const position=(mn&&mn[0]?mn[0].position:1)-1; const {data,error}=await sb.from("sql_assignments").insert(Object.assign({position},a)).select().single(); if(error) throw error; return data; };
api.sqlUpdateAssignment = async (id,patch)=>{ const {data,error}=await sb.from("sql_assignments").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
api.sqlDeleteAssignment = async (id)=>{ const {error}=await sb.from("sql_assignments").delete().eq("id",id); if(error) throw error; };
api.sqlListSubtasks = async (assignmentId)=>{ const {data,error}=await sb.from("sql_subtasks").select("*").eq("assignment_id",assignmentId).order("position"); if(error) throw error; return data||[]; };
api.sqlInsertSubtask = async (s)=>{ const {data,error}=await sb.from("sql_subtasks").insert(s).select().single(); if(error) throw error; return data; };
api.sqlUpdateSubtask = async (id,patch)=>{ const {error}=await sb.from("sql_subtasks").update(patch).eq("id",id); if(error) throw error; };
api.sqlDeleteSubtask = async (id)=>{ const {error}=await sb.from("sql_subtasks").delete().eq("id",id); if(error) throw error; };
async function moveSqlAssignment(list, id, dir){ const i=list.findIndex(x=>x.id===id); const j=i+dir; if(i<0||j<0||j>=list.length) return; const a=list[i], b=list[j]; await api.sqlUpdateAssignment(a.id,{position:b.position}); await api.sqlUpdateAssignment(b.id,{position:a.position}); }
/* ===== SQL-Playground: Schüler:innen lösen + Benotung ===== */
api.sqlStudentAssignments = async (classId)=>{ const {data,error}=await sb.from("sql_assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };   // RLS -> nur veröffentlichte
api.sqlSubtasksForStudent = async (assignmentId)=>{ const {data,error}=await sb.rpc("sql_subtasks_for_student",{p_assignment:assignmentId}); if(error) throw error; return data||[]; };
api.sqlGradeSubtask = async (subtaskId, result)=>{ const {data,error}=await sb.rpc("sql_grade_subtask",{p_subtask:subtaskId, p_result:result}); if(error) throw error; return data; };
api.sqlGetMySubmission = async (assignmentId)=>{ const {data,error}=await sb.from("sql_submissions").select("*").eq("assignment_id",assignmentId).eq("student_id",ME.id).maybeSingle(); if(error) throw error; return data; };
api.sqlMySubmissions = async (assignmentIds)=>{ if(!assignmentIds.length) return []; const {data,error}=await sb.from("sql_submissions").select("*").in("assignment_id",assignmentIds).eq("student_id",ME.id); if(error) throw error; return data||[]; };
api.sqlSaveSubmission = async (assignmentId, answers, results, passed)=>{ const {error}=await sb.from("sql_submissions").upsert({assignment_id:assignmentId, student_id:ME.id, answers, results, passed, updated_at:new Date().toISOString()},{onConflict:"assignment_id,student_id"}); if(error) throw error; };
api.sqlClassSubmissions = async (assignmentIds)=>{ if(!assignmentIds.length) return []; const {data,error}=await sb.from("sql_submissions").select("assignment_id,student_id,results,passed,updated_at").in("assignment_id",assignmentIds); if(error) throw error; return data||[]; };   // RLS: nur Aufgaben, deren Lehrkraft ich bin (sqlsubm_teacher_read)
api.sqlSubtaskIds = async (assignmentIds)=>{ if(!assignmentIds.length) return []; const {data,error}=await sb.from("sql_subtasks").select("id,assignment_id").in("assignment_id",assignmentIds); if(error) throw error; return data||[]; };   // RLS: nur als Lehrkraft sichtbar (sqlsub_teacher_all)
api.sqlGetSubmission = async (assignmentId, studentId)=>{ const {data,error}=await sb.from("sql_submissions").select("*").eq("assignment_id",assignmentId).eq("student_id",studentId).maybeSingle(); if(error) throw error; return data; };   // Lehrer liest fremde Abgabe via sqlsubm_teacher_read
/* SQL-Playground: Lehrer-Rückmeldungen/Kommentare zu Abgaben (für Schüler:in freigebbar; phaseQ) */
api.sqlGetComment = async (submissionId)=>{ if(!submissionId) return null; const {data,error}=await sb.from("sql_submission_comments").select("*").eq("submission_id",submissionId).maybeSingle(); if(error) throw error; return data; };   // RLS: Lehrer immer, Schüler nur released+eigene
api.sqlSaveComment = async (submissionId, body, released)=>{ const {data,error}=await sb.from("sql_submission_comments").upsert({submission_id:submissionId, author_id:ME.id, body, released, updated_at:new Date().toISOString()},{onConflict:"submission_id"}).select().single(); if(error) throw error; return data; };
api.sqlDeleteComment = async (submissionId)=>{ const {error}=await sb.from("sql_submission_comments").delete().eq("submission_id",submissionId); if(error) throw error; };
api.sqlClassComments = async (submissionIds)=>{ if(!submissionIds.length) return []; const {data,error}=await sb.from("sql_submission_comments").select("submission_id,released,body").in("submission_id",submissionIds); if(error) throw error; return data||[]; };   // für spätere Matrix-Hinweise
/* SQL-Playground: Aufgaben-Vorlagen (phaseR) */
api.sqlListTemplates = async ()=>{ const {data,error}=await sb.rpc("shared_sql_templates"); if(error) throw error; return data||[]; };
api.sqlGetTemplate = async (id)=>{ const {data,error}=await sb.from("sql_assignment_templates").select("*").eq("id",id).single(); if(error) throw error; return data; };   // RLS: eigene + geteilte
api.sqlCreateTemplate = async (t)=>{ const {data,error}=await sb.from("sql_assignment_templates").insert(Object.assign({owner_id:ME.id},t)).select().single(); if(error) throw error; return data; };
api.sqlUpdateTemplate = async (id,patch)=>{ const {data,error}=await sb.from("sql_assignment_templates").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.sqlDeleteTemplate = async (id)=>{ const {error}=await sb.from("sql_assignment_templates").delete().eq("id",id); if(error) throw error; };
/* ===== FILIUS: Netzwerk-Bibliothek ===== */
api.filiusListNetworks = async ()=>{ const {data,error}=await sb.rpc("shared_filius_networks"); if(error) throw error; return data||[]; };
api.sandboxFiliusNetworks = async ()=>{ const {data,error}=await sb.rpc("sandbox_filius_networks"); if(error) throw error; return data||[]; };
api.filiusGetNetwork = async (id)=>{ const {data,error}=await sb.from("filius_networks").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.filiusCreateNetwork = async (d)=>{ const {data,error}=await sb.from("filius_networks").insert(Object.assign({owner_id:ME.id},d)).select().single(); if(error) throw error; return data; };
api.filiusUpdateNetwork = async (id,patch)=>{ const {data,error}=await sb.from("filius_networks").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.filiusDeleteNetwork = async (id)=>{ const {error}=await sb.from("filius_networks").delete().eq("id",id); if(error) throw error; };
/* ===== FILIUS: Aufgaben ===== */
api.filiusListAssignments = async (classId)=>{ const {data,error}=await sb.from("filius_assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };
api.filiusStudentAssignments = async (classId)=>{ const {data,error}=await sb.from("filius_assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };   // RLS -> nur veröffentlichte
api.filiusGetAssignment = async (id)=>{ const {data,error}=await sb.from("filius_assignments").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.filiusCreateAssignment = async (a)=>{ const {data:mn}=await sb.from("filius_assignments").select("position").eq("class_id",a.class_id).order("position",{ascending:true}).limit(1); const position=(mn&&mn[0]?mn[0].position:1)-1; const {data,error}=await sb.from("filius_assignments").insert(Object.assign({position},a)).select().single(); if(error) throw error; return data; };
api.filiusUpdateAssignment = async (id,patch)=>{ const {data,error}=await sb.from("filius_assignments").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
api.filiusDeleteAssignment = async (id)=>{ const {error}=await sb.from("filius_assignments").delete().eq("id",id); if(error) throw error; };
async function moveFiliusAssignment(list, id, dir){ const i=list.findIndex(x=>x.id===id); const j=i+dir; if(i<0||j<0||j>=list.length) return; const a=list[i], b=list[j]; await api.filiusUpdateAssignment(a.id,{position:b.position}); await api.filiusUpdateAssignment(b.id,{position:a.position}); }
/* Muster-Netzwerk je Aufgabe (nur Lehrkraft) + Schüler-RPC (nur bei Freigabe) */
api.filiusGetSolution = async (aid)=>{ const {data,error}=await sb.from("filius_assignment_solutions").select("*").eq("assignment_id",aid).maybeSingle(); if(error) throw error; return data; };
api.filiusSaveSolution = async (aid, data)=>{ const {error}=await sb.from("filius_assignment_solutions").upsert({assignment_id:aid, author_id:ME.id, data, updated_at:new Date().toISOString()},{onConflict:"assignment_id"}); if(error) throw error; };
api.filiusDeleteSolution = async (aid)=>{ const {error}=await sb.from("filius_assignment_solutions").delete().eq("assignment_id",aid); if(error) throw error; };
api.filiusSolutionForStudent = async (aid)=>{ const {data,error}=await sb.rpc("filius_solution_for_student",{p_assignment:aid}); if(error) throw error; return data; };
/* Abgaben (genau eine je Aufgabe+Schüler:in) */
api.filiusGetMySubmission = async (aid)=>{ const {data,error}=await sb.from("filius_submissions").select("*").eq("assignment_id",aid).eq("student_id",ME.id).maybeSingle(); if(error) throw error; return data; };
api.filiusMySubmissions = async (aids)=>{ if(!aids.length) return []; const {data,error}=await sb.from("filius_submissions").select("*").in("assignment_id",aids).eq("student_id",ME.id); if(error) throw error; return data||[]; };
api.filiusSaveSubmission = async (aid, data, results, passed)=>{ const {error}=await sb.from("filius_submissions").upsert({assignment_id:aid, student_id:ME.id, data, results, passed, updated_at:new Date().toISOString()},{onConflict:"assignment_id,student_id"}); if(error) throw error; };
api.filiusClassSubmissions = async (aids)=>{ if(!aids.length) return []; const {data,error}=await sb.from("filius_submissions").select("assignment_id,student_id,data,results,passed,updated_at").in("assignment_id",aids); if(error) throw error; return data||[]; };   // RLS: nur als Lehrkraft; data -> authoritative Neu-Auswertung
api.filiusGetSubmission = async (aid, sid)=>{ const {data,error}=await sb.from("filius_submissions").select("*").eq("assignment_id",aid).eq("student_id",sid).maybeSingle(); if(error) throw error; return data; };
/* Rückmeldungen zu Abgaben */
api.filiusGetComment = async (subId)=>{ if(!subId) return null; const {data,error}=await sb.from("filius_submission_comments").select("*").eq("submission_id",subId).maybeSingle(); if(error) throw error; return data; };
api.filiusSaveComment = async (subId, body, released)=>{ const {data,error}=await sb.from("filius_submission_comments").upsert({submission_id:subId, author_id:ME.id, body, released, updated_at:new Date().toISOString()},{onConflict:"submission_id"}).select().single(); if(error) throw error; return data; };
api.filiusDeleteComment = async (subId)=>{ const {error}=await sb.from("filius_submission_comments").delete().eq("submission_id",subId); if(error) throw error; };
api.filiusClassComments = async (subIds)=>{ if(!subIds.length) return []; const {data,error}=await sb.from("filius_submission_comments").select("submission_id,released,body").in("submission_id",subIds); if(error) throw error; return data||[]; };   // RLS: Schüler nur freigegebene+eigene
/* Vorlagen */
api.filiusListTemplates = async ()=>{ const {data,error}=await sb.rpc("shared_filius_templates"); if(error) throw error; return data||[]; };
api.filiusGetTemplate = async (id)=>{ const {data,error}=await sb.from("filius_assignment_templates").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.filiusCreateTemplate = async (t)=>{ const {data,error}=await sb.from("filius_assignment_templates").insert(Object.assign({owner_id:ME.id},t)).select().single(); if(error) throw error; return data; };
api.filiusUpdateTemplate = async (id,patch)=>{ const {data,error}=await sb.from("filius_assignment_templates").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.filiusDeleteTemplate = async (id)=>{ const {error}=await sb.from("filius_assignment_templates").delete().eq("id",id); if(error) throw error; };
/* Sandbox-Projekte */
api.filiusListSandboxProjects = async ()=>{ const {data,error}=await sb.from("filius_sandbox_projects").select("id,title,updated_at").eq("owner_id",ME.id).order("updated_at",{ascending:false}); if(error) throw error; return data||[]; };
api.filiusGetSandboxProject = async (id)=>{ const {data,error}=await sb.from("filius_sandbox_projects").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.filiusCreateSandboxProject = async (p)=>{ const {data,error}=await sb.from("filius_sandbox_projects").insert(Object.assign({owner_id:ME.id},p)).select().single(); if(error) throw error; return data; };
api.filiusUpdateSandboxProject = async (id,patch)=>{ const {data,error}=await sb.from("filius_sandbox_projects").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.filiusDeleteSandboxProject = async (id)=>{ const {error}=await sb.from("filius_sandbox_projects").delete().eq("id",id); if(error) throw error; };

/* Headless: Code auf frischer Kopie des Territoriums laufen lassen -> Endmodell (wirft bei Fehler) */
function runHeadless(code, territory){
  const ast=HamsterEngine.parse(code); HamsterEngine.compileCheck(ast);
  const model=HamsterEngine.toModel(territory);
  const m={rows:model.rows,cols:model.cols,walls:model.walls,grains:model.grains,hamster:model.hamster,onWrite:()=>{}};
  const it=HamsterEngine.makeInterpreter(ast,m); const g=it.run(); let n=0;
  while(true){ const r=g.next(); if(r.done)break; if(++n>2000000) throw new Error("Zu viele Schritte – läuft der Code in eine Endlosschleife?"); }
  return m;
}
/* Auto-Check eines Schüler-Codes gegen ein Ziel */
function gradeSubmission(code, territory, goal){
  if(!goal||!goal.type) return null;
  try{ return HamsterEngine.checkGoal(goal, runHeadless(code, territory))===true; }
  catch(e){ return false; }
}
/* Für das Aufgaben-Dashboard: einen Code (re-)ausführen und das Ergebnis kategorisieren. */
function classifySubmission(code, territory, goal){
  // Phase 1: Übersetzen (Lexer/Parser/Typprüfung) -> alles hier ist ein Compilerfehler
  try{ const ast=HamsterEngine.parse(code); HamsterEngine.compileCheck(ast); }
  catch(e){ return {status:"compile", msg:(e&&e.message)||String(e), line:(e&&e.line)||null}; }
  // Phase 2: Ausführen — prompt() headless stummschalten (sonst Dialog je Abgabe mit liesZahl/…)
  let m; const _prompt=window.prompt; window.prompt=function(){ return null; };
  try{ m = runHeadless(code, territory); }
  catch(e){
    const msg=(e&&e.message)||String(e), line=(e&&e.line)||null;
    if(e&&e.type) return {status:"runtime", type:e.type, msg, line};
    if(/Zu viele Schritte|Endlosschleife/.test(msg)) return {status:"loop", msg, line};
    if(/Unbekannte[rs]? (Befehl|Methode|Variable)/.test(msg)) return {status:"unknown", msg, line};
    return {status:"runtime", type:null, msg, line};
  }finally{ window.prompt=_prompt; }
  if(!goal||!goal.type) return {status:"ok"};   // läuft fehlerfrei, kein Auto-Check
  try{ return HamsterEngine.checkGoal(goal, m)===true ? {status:"passed"} : {status:"goalMissed"}; }
  catch(_){ return {status:"goalMissed"}; }
}
function errorCategory(c){
  if(!c || c.status==="passed" || c.status==="ok") return null;
  if(c.status==="goalMissed") return {key:"goal", icon:"🎯", label:"Läuft, aber Ziel nicht erreicht"};
  if(c.status==="compile") return {key:"compile", icon:"⌨️", label:"Compilerfehler"};
  if(c.status==="loop") return {key:"loop", icon:"🔁", label:"Endlosschleife"};
  if(c.status==="unknown") return {key:"unknown", icon:"❓", label:"Unbekannter Befehl / Variable (Tippfehler?)"};
  const t=c.type||"", msg=c.msg||"";
  if(t==="MauerDaException") return {key:"mauer", icon:"🧱", label:"Gegen die Mauer gelaufen"};
  if(t==="KachelLeerException") return {key:"kachel", icon:"🌾", label:"Kein Korn zum Fressen"};
  if(t==="MaulLeerException") return {key:"maul", icon:"👄", label:"Kein Korn im Maul"};
  if(/Division/.test(msg)) return {key:"div", icon:"➗", label:"Division durch 0"};
  if(/außerhalb|Grenzen|Index/.test(msg)) return {key:"array", icon:"🔢", label:"Array-Index-Fehler"};
  return {key:"runtime", icon:"⚠️", label:"Laufzeitfehler"};
}
/* Aus Lösungscode + Territorium den Soll-Zustand (Körner-Endlage, Hamster-Endpos) berechnen */
function computeSolutionGoal(code, territory, matchHamster){
  const m=runHeadless(code, territory);
  const grains={}; for(const [k,v] of m.grains){ if(v>0) grains[k]=v; }
  return { type:"solution", grains, matchHamster:!!matchHamster, hrow:m.hamster.row, hcol:m.hamster.col };
}
function goalLabel(goal){
  if(!goal||!goal.type) return "kein Auto-Check";
  if(goal.type==="noGrains") return "Feld leer (alle Körner gefressen)";
  if(goal.type==="grainsInMaul") return "≥ "+goal.n+" Körner im Maul";
  if(goal.type==="atPos") return "Hamster bei Reihe "+goal.row+", Spalte "+goal.col;
  if(goal.type==="solution") return "Ergebnis wie die Musterlösung"+(goal.matchHamster?" (inkl. Hamster-Endposition)":"");
  return "Auto-Check";
}

/* ---------- Lehrer: Aufgabe stellen / bearbeiten (eigene Seite) ---------- */
/* Editor wie bei Schüler:innen (solve = Code ausführbar) mit Umschalter zur Welt (design). */
function aeBuildView(){
  const s=assignEditState; if(!s) return;
  if(pageView){ try{ pageView.destroy(); }catch(e){} }
  if(s.sub==="code") pageView=new HamsterView("#aeHost",{ mode:"solve", model:s.territory, code:s.code, fill:true, commands:true });
  else pageView=new HamsterView("#aeHost",{ mode:"design", model:s.territory, fill:true });
}
function aeSync(){ const s=assignEditState; if(!s||!pageView) return; if(s.sub==="code") s.code=pageView.getCode(); else s.territory=pageView.getTerritory(); }
function aeSetSub(sub){
  const s=assignEditState; if(!s||s.sub===sub) return;
  aeSync(); s.sub=sub;
  const cb=document.getElementById("aeCode"), wb=document.getElementById("aeWelt");
  if(cb) cb.classList.toggle("on",sub==="code"); if(wb) wb.classList.toggle("on",sub==="welt");
  aeBuildView();
}
function aeTerritory(){ const s=assignEditState; return (s.sub==="welt"&&pageView)?pageView.getTerritory():s.territory; }
function aeCodeVal(){ const s=assignEditState; return (s.sub==="code"&&pageView)?pageView.getCode():s.code; }

function assignmentEditorPage(classId, onDone, existing, tplMode){
  const ex = existing || null;
  assignEditState = {
    classId, onDone, ex, tplMode: !!tplMode, sub:"code",
    code: (ex && ex.starter_code!=null) ? ex.starter_code : DEFAULT_STARTER,
    territory: (ex && ex.territory) ? ex.territory : HamsterEngine.toJSON(HamsterEngine.blankTerr())
  };
  const titleTxt = ex ? (tplMode?"Vorlage bearbeiten":"Aufgabe bearbeiten") : (tplMode?"Neue Vorlage":"Neue Aufgabe");
  const saveTxt  = tplMode ? "Vorlage speichern" : (ex?"Änderungen speichern":"Aufgabe stellen");
  shell(`
    <div class="page-head"><button class="crumb" id="back">← zurück</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(titleTxt)}</h2></div>
    <div class="card" style="margin-bottom:14px">
      ${(ex||tplMode)?"":`<div class="field"><label>Aus Vorlage laden</label>
        <div style="display:flex;gap:8px"><select class="input" id="asTpl" style="flex:1"><option value="">– keine –</option></select>
        <button class="btn btn-ghost btn-sm" id="asDelTpl" title="Vorlage löschen" style="display:none">🗑️</button></div></div>`}
      <div class="field"><label>Titel</label><input class="input" id="asTitle" placeholder="z. B. Lauf bis zur Wand" maxlength="80"></div>
      <div class="field"><label>Aufgabenstellung</label><textarea class="input" id="asDesc" placeholder="Was soll der Hamster tun?"></textarea></div>
      <div class="field"><label>Tipp / Hinweis (optional)</label><textarea class="input" id="asHint" style="min-height:54px" placeholder="Eigener Hinweis, den Schüler:innen einblenden können"></textarea></div>
      <div class="field"><label>Auto-Check (optional)</label>
        <select class="input" id="asGoalType">
          <option value="">Kein Auto-Check</option>
          <option value="noGrains">Feld leer – alle Körner gefressen</option>
          <option value="grainsInMaul">Hamster hat ≥ N Körner im Maul</option>
          <option value="atPos">Hamster steht am Ziel (Reihe/Spalte)</option>
          <option value="solution">Soll-Zustand vergleichen</option>
        </select>
        <div id="asGoalExtra" style="margin-top:8px"></div>
      </div>
      <label style="display:flex;gap:9px;align-items:center;font-weight:800;margin:2px 0 10px;cursor:pointer"><input type="checkbox" id="asShowCmd" style="width:18px;height:18px"> 📖 Befehls-Übersicht (Spickzettel) für Schüler:innen einblendbar</label>
      ${tplMode?"":`<label style="display:flex;gap:9px;align-items:center;font-weight:800;margin:2px 0 2px;cursor:pointer"><input type="checkbox" id="asPublish" style="width:18px;height:18px"> Für die Klasse sichtbar (veröffentlichen)</label>`}
    </div>
    <div class="page-head" style="margin-top:0"><h3 style="margin:0">✏️ Editor &amp; Startcode</h3><div class="spacer"></div>
      <span class="acts"><button class="abtn on" id="aeCode" title="Startcode programmieren &amp; ausführen">📝 Code</button><button class="abtn" id="aeWelt" title="Start-Territorium bauen">🌍 Welt</button></span></div>
    <div class="card" style="margin-bottom:10px;padding:10px 14px"><span class="muted" style="font-size:13px">📝 <b>Code</b> – der Startcode für Schüler:innen, genau wie ihr Editor und mit <b>▶ Start</b> direkt ausführbar. &nbsp; 🌍 <b>Welt</b> – das Start-Territorium bauen.</span></div>
    <div id="aeHost" style="--edh:70vh;min-height:560px"></div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center">
      ${tplMode?"":`<button class="btn btn-ghost" id="asSaveTpl" style="flex:none">💾 Als Vorlage</button>`}
      <button class="btn btn-primary btn-lg" id="asSave" style="max-width:320px">${esc(saveTxt)}</button>
    </div>`);
  document.getElementById("back").onclick = ()=>{ if(onDone) onDone(); };
  aeBuildView();
  document.getElementById("aeCode").onclick=()=>aeSetSub("code");
  document.getElementById("aeWelt").onclick=()=>aeSetSub("welt");

  const gt=document.getElementById("asGoalType"), extra=document.getElementById("asGoalExtra");
  const renderExtra=()=>{ if(gt.value==="grainsInMaul") extra.innerHTML=`<input class="input" id="asGoalN" type="number" min="1" value="5" placeholder="Anzahl Körner">`;
    else if(gt.value==="atPos") extra.innerHTML=`<div style="display:flex;gap:8px"><input class="input" id="asGoalR" type="number" min="0" value="0" placeholder="Reihe"><input class="input" id="asGoalC" type="number" min="0" value="0" placeholder="Spalte"></div>`;
    else if(gt.value==="solution") extra.innerHTML=`<textarea class="input" id="asSolCode" style="font-family:monospace;font-size:13px;min-height:96px" placeholder="Lösungscode der Lehrkraft – wird NICHT an Schüler:innen gezeigt"></textarea><label style="display:flex;gap:8px;align-items:center;font-weight:700;margin-top:6px;cursor:pointer"><input type="checkbox" id="asSolHam"> Endposition des Hamsters muss auch stimmen</label><div class="muted" style="font-size:12px;margin-top:4px">Unter „🌍 Welt" baust du die Startwelt – der Lösungscode erzeugt daraus den Soll-Zustand. Beim Speichern wird er getestet.</div>`;
    else extra.innerHTML=""; };
  gt.onchange=renderExtra;
  const gatherGoal=()=>{ if(gt.value==="noGrains")return{type:"noGrains"}; if(gt.value==="grainsInMaul")return{type:"grainsInMaul",n:Math.max(1,+(document.getElementById("asGoalN")||{}).value||1)}; if(gt.value==="atPos")return{type:"atPos",row:+(document.getElementById("asGoalR")||{}).value||0,col:+(document.getElementById("asGoalC")||{}).value||0};
    if(gt.value==="solution"){ const code=((document.getElementById("asSolCode")||{}).value||"").trim(); if(!code) throw new Error("Bitte den Lösungscode eingeben."); return computeSolutionGoal(code, aeTerritory(), !!(document.getElementById("asSolHam")||{}).checked); }
    return null; };
  const fill=(o, withWorld)=>{ document.getElementById("asTitle").value=o.title||""; document.getElementById("asDesc").value=o.description||""; document.getElementById("asHint").value=o.hint||""; const scEl=document.getElementById("asShowCmd"); if(scEl&&o.show_commands!=null) scEl.checked=o.show_commands!==false; gt.value=(o.goal&&o.goal.type)||""; renderExtra(); if(o.goal){ if(o.goal.type==="grainsInMaul"&&document.getElementById("asGoalN"))document.getElementById("asGoalN").value=o.goal.n; if(o.goal.type==="atPos"){ if(document.getElementById("asGoalR"))document.getElementById("asGoalR").value=o.goal.row; if(document.getElementById("asGoalC"))document.getElementById("asGoalC").value=o.goal.col; } } if(o.goal&&o.goal.type==="solution"){ const t=document.getElementById("asSolCode"); if(t&&o.solution_code!=null) t.value=o.solution_code; const h=document.getElementById("asSolHam"); if(h) h.checked=!!o.match_hamster; } if(withWorld){ const s=assignEditState; s.code = (o.starter_code!=null)? o.starter_code : DEFAULT_STARTER; s.territory = o.territory ? o.territory : HamsterEngine.toJSON(HamsterEngine.blankTerr()); aeBuildView(); } };
  { const pub=document.getElementById("asPublish"); if(pub) pub.checked = ex? !!ex.published : true; }
  { const sc=document.getElementById("asShowCmd"); if(sc) sc.checked = ex? (ex.show_commands!==false) : true; }
  if(ex){ fill(ex, false); if(!tplMode && ex.goal && ex.goal.type==="solution"){ api.getAssignmentSolution(ex.id).then(s=>{ if(s){ const t=document.getElementById("asSolCode"); if(t) t.value=s.code||""; const h=document.getElementById("asSolHam"); if(h) h.checked=!!s.match_hamster; } }).catch(()=>{}); } }
  else if(!tplMode){ renderExtra();
    const tplSel=document.getElementById("asTpl"), delTpl=document.getElementById("asDelTpl");
    api.listTemplates().then(tpls=>{ window._tpls=tpls; tplSel.innerHTML='<option value="">– keine –</option>'+tpls.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join(""); }).catch(()=>{});
    tplSel.onchange=()=>{ const t=(window._tpls||[]).find(x=>x.id===tplSel.value); delTpl.style.display=t?"inline-flex":"none"; if(t) fill(t, true); };
    delTpl.onclick=async()=>{ if(!tplSel.value)return; if(!confirm("Vorlage löschen?"))return; try{ await api.deleteTemplate(tplSel.value); window._tpls=(window._tpls||[]).filter(x=>x.id!==tplSel.value); tplSel.innerHTML='<option value="">– keine –</option>'+window._tpls.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join(""); delTpl.style.display="none"; toast("Vorlage gelöscht","ok"); }catch(e){ toast(e.message,"err"); } };
  }
  else { renderExtra(); }
  document.getElementById("asTitle").focus();
  { const saveTplBtn=document.getElementById("asSaveTpl"); if(saveTplBtn) saveTplBtn.onclick=async()=>{
    aeSync();
    const title=document.getElementById("asTitle").value.trim()||"Unbenannte Vorlage";
    let goal; try{ goal=gatherGoal(); }catch(e){ toast(e.message||"Lösungscode fehlerhaft","err"); return; }
    try{ await api.createTemplate({ title, description:document.getElementById("asDesc").value.trim(), territory:aeTerritory(), starter_code:aeCodeVal()||null, goal, hint:document.getElementById("asHint").value.trim()||null, solution_code:(document.getElementById("asSolCode")||{}).value||null, match_hamster:!!(document.getElementById("asSolHam")||{}).checked, show_commands:document.getElementById("asShowCmd").checked }); toast("Als Vorlage gespeichert 💾","ok"); }
    catch(e){ toast(e.message||"Fehler","err"); }
  }; }
  document.getElementById("asSave").onclick=async()=>{
    aeSync();
    const title=document.getElementById("asTitle").value.trim(); if(!title){ document.getElementById("asTitle").focus(); return; }
    let goal; try{ goal=gatherGoal(); }catch(e){ toast(e.message||"Lösungscode fehlerhaft","err"); return; }
    const solCode=(document.getElementById("asSolCode")||{}).value||"", solHam=!!(document.getElementById("asSolHam")||{}).checked;
    const showCmd=document.getElementById("asShowCmd").checked;
    const territory=aeTerritory(), starter=aeCodeVal();
    const btn=document.getElementById("asSave"); btn.disabled=true; btn.textContent="Speichere…";
    if(tplMode){
      const tplPayload={ title, description:document.getElementById("asDesc").value.trim(), territory, starter_code:starter||null, goal, hint:document.getElementById("asHint").value.trim()||null, solution_code:solCode||null, match_hamster:solHam, show_commands:showCmd };
      try{ if(ex) await api.updateTemplate(ex.id, tplPayload); else await api.createTemplate(tplPayload); toast(ex?"Vorlage aktualisiert ✓":"Vorlage gespeichert 💾","ok"); if(onDone) onDone(); }
      catch(e){ btn.disabled=false; btn.textContent=saveTxt; toast(e.message||"Fehler","err"); }
      return;
    }
    const payload={ title, description:document.getElementById("asDesc").value.trim(), territory, starter_code:starter||null, goal, hint:document.getElementById("asHint").value.trim()||null, published:document.getElementById("asPublish").checked, show_commands:showCmd };
    try{
      let aid;
      if(ex){ await api.updateAssignment(ex.id, payload); aid=ex.id; }
      else { const created=await api.createAssignment(Object.assign({class_id:classId}, payload)); aid=created.id; }
      if(goal && goal.type==="solution"){ await api.saveAssignmentSolution(aid, solCode, solHam); }
      else { try{ await api.deleteAssignmentSolution(aid); }catch(_){} }
      toast(ex?"Aufgabe aktualisiert ✓":(payload.published?"Aufgabe veröffentlicht 🎉":"Entwurf gespeichert ✓"),"ok");
      if(onDone) onDone();
    } catch(e){ btn.disabled=false; btn.textContent=saveTxt; toast(e.message||"Fehler","err"); }
  };
}

/* ---------- Lehrer: Vorlagen-Übersicht ---------- */
async function templatesPage(back){
  const b = subBack(templatesPage, back) || {label:"← Meine Klassen", go:teacherHome};
  shell(`<div class="center-load"><span class="spin"></span>Vorlagen…</div>`);
  let tpls=[];
  try{ tpls=await api.listTemplates(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const list = tpls.length ? `<div class="list">${tpls.map(t=>`
      <div class="row"><span class="grow"><span class="t clickable" data-edit="${t.id}" title="Vorlage bearbeiten">${esc(t.title)}</span><span class="s">${t.description?esc(t.description.slice(0,80)):"keine Beschreibung"}${t.goal&&t.goal.type?` · 🎯 ${esc(goalLabel(t.goal))}`:""}</span></span>
        <span class="acts"><button class="abtn" data-edit="${t.id}" title="bearbeiten">✏️</button><button class="abtn" data-del="${t.id}" title="löschen">🗑️</button></span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Erstelle deine erste!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>📋 Aufgaben-Vorlagen</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewTpl">+ Neue Vorlage</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Vorlagen sind wiederverwendbare Aufgaben-Bausteine. Beim Erstellen einer Aufgabe kannst du oben „Aus Vorlage laden" wählen.</span></div>
    ${list}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewTpl").onclick = ()=> assignmentEditorPage(null, templatesPage, null, true);
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=>{ const t=tpls.find(x=>x.id===b.dataset.edit); assignmentEditorPage(null, templatesPage, t, true); });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Vorlage löschen?")) return; try{ await api.deleteTemplate(b.dataset.del); templatesPage(); }catch(e){ toast(e.message||"Fehler","err"); } });
}

/* ---------- Lehrer: Abgabe(n) live öffnen, bearbeiten, kommentieren ---------- */
function reviewSubmission(assignment, history, studentName, classId){
  history = (history||[]).slice().sort((x,y)=> new Date(y.submitted_at)-new Date(x.submitted_at));
  const current = history.find(s=>s.is_current) || history[0];
  reviewState = { assignment, history, studentName, classId, viewing: current };
  shell(`
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0">
      <h2>Abgabe von ${esc(studentName)}</h2>
      <div class="spacer"></div>
      <span id="revStatus"></span>
      <button class="btn btn-ghost btn-sm" id="btnOrig" style="margin-left:8px" title="Diese Abgabe wiederherstellen">↺ Original</button>
      <button class="btn btn-blue btn-sm" id="btnSaveSample" style="margin-left:8px" title="Aktuellen Code als Musterlösung speichern">★ Als Musterlösung</button>
    </div>
    <div class="card" style="margin-bottom:10px;padding:12px 16px">
      <b>Aufgabe:</b> ${esc(assignment.title)}${assignment.description?` – ${esc(assignment.description)}`:""}
      <span class="muted" style="font-size:12px;display:block;margin-top:3px">🛠️ Live-Korrektur: Du kannst den Code bearbeiten &amp; laufen lassen – Änderungen werden nicht automatisch gespeichert.</span>
    </div>
    ${history.length>1?`<div class="card" style="margin-bottom:10px;padding:10px 14px"><b style="font-size:13px">Versionen (neueste zuerst):</b> <span id="verNav"></span></div>`:""}
    <div id="reviewHost" style="--edh:70vh;min-height:560px"></div>
    <div id="revStudentNote" style="margin-top:14px"></div>
    <div class="card" style="margin-top:14px">
      <h3 style="margin:0 0 8px">💬 Rückmeldung an ${esc(studentName)}</h3>
      <textarea class="input" id="revComment" style="min-height:70px" placeholder="Kommentar zu dieser Abgabe…"></textarea>
      <div style="display:flex;gap:12px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <label style="display:flex;gap:8px;align-items:center;font-weight:800;cursor:pointer"><input type="checkbox" id="revRelease" style="width:18px;height:18px"> Für Schüler:in sichtbar</label>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" id="revDelete" style="display:none">Löschen</button>
        <button class="btn btn-primary" id="revSave">Kommentar speichern</button>
      </div>
      <span id="revMsg" class="muted" style="display:block;margin-top:6px"></span>
    </div>`);
  document.getElementById("back").onclick = ()=> teacherClassView(classId);
  document.getElementById("btnOrig").onclick = ()=>{ if(pageView&&reviewState.viewing) pageView.setCode(reviewState.viewing.code); };
  document.getElementById("btnSaveSample").onclick = saveReviewAsSample;
  document.getElementById("revSave").onclick = saveReviewComment;
  document.getElementById("revDelete").onclick = deleteReviewComment;
  showReviewVersion(current);
}
function renderVerNav(){
  const s=reviewState; const el=document.getElementById("verNav"); if(!el) return;
  el.innerHTML = s.history.map((sub,i)=>{
    const on = s.viewing && s.viewing.id===sub.id;
    const tag = sub.is_current?" ●":"";
    return `<button class="abtn ${on?'on':''}" data-ver="${sub.id}" title="${esc(fmtDateTime(sub.submitted_at))}${sub.is_current?' · aktuelle Version':''}">v${s.history.length-i}${tag}</button>`;
  }).join(" ");
  el.querySelectorAll("[data-ver]").forEach(b=> b.onclick=()=>{ const sub=s.history.find(x=>x.id===b.dataset.ver); showReviewVersion(sub); });
}
async function showReviewVersion(sub){
  const s=reviewState; if(!sub) return; s.viewing=sub;
  const passed = sub.passed===true ? `<span class="badge">bestanden ✓</span>` : `<span class="badge gold">abgegeben</span>`;
  const st=document.getElementById("revStatus"); if(st) st.innerHTML = passed + ` <span class="muted" style="font-size:12px">${esc(fmtDateTime(sub.submitted_at))}</span>`;
  if(pageView){ try{ pageView.destroy(); }catch(e){} }
  pageView = new HamsterView("#reviewHost", { mode:"solve", model:s.assignment.territory, code:sub.code, fill:true, goal:s.assignment.goal, commands:true });
  if(s.history.length>1) renderVerNav();
  const ta=document.getElementById("revComment"), rel=document.getElementById("revRelease"), del=document.getElementById("revDelete"), msg=document.getElementById("revMsg");
  if(ta) ta.value=""; if(rel) rel.checked=false; if(del) del.style.display="none"; if(msg) msg.textContent="";
  try{ const c=await api.getComment(sub.id); if(c){ if(ta) ta.value=c.body||""; if(rel) rel.checked=!!c.released; if(del) del.style.display=""; } }catch(e){}
  const snEl=document.getElementById("revStudentNote");
  if(snEl){ snEl.innerHTML="";
    try{ const sn=await api.getSubmissionNote(sub.id); if(sn && (sn.body||"").trim()) snEl.innerHTML=`<div class="card" style="background:#fff7e9;border-color:#ffe0a3"><b>✍️ Kommentar von ${esc(s.studentName)}:</b><div style="margin-top:4px;white-space:pre-wrap">${esc(sn.body)}</div></div>`; }catch(e){}
  }
}
async function saveReviewComment(){
  const s=reviewState; const body=document.getElementById("revComment").value.trim();
  const released=document.getElementById("revRelease").checked;
  if(!body){ toast("Bitte einen Kommentar eingeben.","err"); return; }
  const btn=document.getElementById("revSave"); btn.disabled=true; btn.textContent="Speichere…";
  try{ await api.saveComment(s.viewing.id, body, released); document.getElementById("revDelete").style.display=""; document.getElementById("revMsg").textContent = released?"Gespeichert & für Schüler:in sichtbar ✓":"Gespeichert (noch nicht freigegeben) ✓"; toast("Kommentar gespeichert ✓","ok"); }
  catch(e){ toast(e.message||"Fehler","err"); }
  finally{ btn.disabled=false; btn.textContent="Kommentar speichern"; }
}
async function deleteReviewComment(){
  const s=reviewState; if(!confirm("Kommentar löschen?")) return;
  try{ await api.deleteComment(s.viewing.id); document.getElementById("revComment").value=""; document.getElementById("revRelease").checked=false; document.getElementById("revDelete").style.display="none"; document.getElementById("revMsg").textContent="Kommentar gelöscht."; toast("Gelöscht","ok"); }
  catch(e){ toast(e.message||"Fehler","err"); }
}
async function saveReviewAsSample(){
  const s=reviewState; const code=pageView?pageView.getCode():"";
  if(!code.trim()){ toast("Kein Code zum Speichern.","err"); return; }
  const title=prompt("Titel der Musterlösung (optional):","Musterlösung");
  if(title===null) return;
  try{ await api.createSample({ assignment_id:s.assignment.id, title:title.trim()||null, code, released:false }); toast("Als Musterlösung gespeichert ★ (noch nicht freigegeben)","ok"); }
  catch(e){ toast(e.message||"Fehler","err"); }
}

/* ---------- Lehrer: Musterlösungen verwalten ---------- */
async function sampleManager(assignment, classId){
  shell(`<div class="center-load"><span class="spin"></span>Musterlösungen…</div>`);
  let samples=[];
  try{ samples=await api.listSamples(assignment.id); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  sampleState = { assignment, classId, samples, editingId:null };
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>🏆 Musterlösungen – ${esc(assignment.title)}</h2></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px">
      <span class="muted" style="font-size:13px">Schreibe eine Lösung, lass sie laufen und speichere sie. <b>Freigegebene</b> Musterlösungen können Schüler:innen ansehen.</span>
    </div>
    <div id="smList"></div>
    <div class="page-head" style="margin-top:10px"><h3 id="smEditTitle" style="margin:0">➕ Neue Musterlösung</h3><div class="spacer"></div><span id="smEditHint" class="muted" style="font-size:12px"></span></div>
    <div class="field" style="max-width:420px"><label>Titel (optional)</label><input class="input" id="smTitleIn" placeholder="z. B. Kurze Lösung" maxlength="80"></div>
    <div id="smEditHost" style="--edh:70vh;min-height:560px"></div>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary btn-lg" id="smSave" style="max-width:260px">💾 Speichern</button>
      <button class="btn btn-ghost" id="smNew" style="display:none">➕ Neue (Editor leeren)</button>
      <span id="smMsg" class="muted"></span>
    </div>`;
  document.getElementById("back").onclick = ()=> teacherClassView(classId);
  pageView = new HamsterView("#smEditHost", { mode:"solve", model:assignment.territory, code:(assignment.starter_code||DEFAULT_STARTER), fill:true, goal:assignment.goal, commands:true });
  renderSampleList();
  document.getElementById("smSave").onclick = saveSampleFromEditor;
  document.getElementById("smNew").onclick = ()=> resetSampleEditor();
}
function renderSampleList(){
  const s=sampleState; const el=document.getElementById("smList"); if(!el) return;
  if(!s.samples.length){ el.innerHTML=`<div class="empty" style="padding:14px"><span class="ic">🏆</span>Noch keine Musterlösung gespeichert.</div>`; return; }
  el.innerHTML = `<div class="list">${s.samples.map((sm,i)=>`
    <div class="row"><span class="grow"><span class="t">${esc(sm.title||("Musterlösung "+(i+1)))} ${sm.released?'<span class="badge">freigegeben</span>':'<span class="badge gray">privat</span>'}</span><span class="s">${esc(fmtDateTime(sm.created_at))}</span></span>
      <span class="acts">
        <button class="abtn" data-load="${sm.id}" title="in den Editor laden">✏️</button>
        <button class="abtn" data-rel="${sm.id}" data-on="${sm.released?1:0}" title="${sm.released?'Freigabe zurücknehmen':'für Schüler:innen freigeben'}">${sm.released?'🙈':'🚀'}</button>
        <button class="abtn" data-del="${sm.id}" title="löschen">🗑️</button>
      </span></div>`).join("")}</div>`;
  el.querySelectorAll("[data-load]").forEach(b=> b.onclick=()=>{ const sm=s.samples.find(x=>x.id===b.dataset.load); loadSampleIntoEditor(sm); });
  el.querySelectorAll("[data-rel]").forEach(b=> b.onclick=async()=>{ try{ await api.updateSample(b.dataset.rel,{released:b.dataset.on!=="1"}); sampleManager(s.assignment, s.classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  el.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Musterlösung löschen?"))return; try{ await api.deleteSample(b.dataset.del); sampleManager(s.assignment, s.classId); }catch(e){ toast(e.message||"Fehler","err"); } });
}
function loadSampleIntoEditor(sm){
  const s=sampleState; s.editingId=sm.id;
  if(pageView) pageView.setCode(sm.code);
  document.getElementById("smTitleIn").value = sm.title||"";
  document.getElementById("smEditTitle").textContent = "✏️ Musterlösung bearbeiten";
  document.getElementById("smEditHint").textContent = "Du bearbeitest „"+(sm.title||"Musterlösung")+"“";
  document.getElementById("smNew").style.display="";
  document.getElementById("smSave").textContent="💾 Änderungen speichern";
  const h=document.getElementById("smEditHost"); if(h) h.scrollIntoView({behavior:"smooth",block:"center"});
}
function resetSampleEditor(){
  const s=sampleState; s.editingId=null;
  if(pageView) pageView.setCode(s.assignment.starter_code||DEFAULT_STARTER);
  document.getElementById("smTitleIn").value="";
  document.getElementById("smEditTitle").textContent="➕ Neue Musterlösung";
  document.getElementById("smEditHint").textContent="";
  document.getElementById("smNew").style.display="none";
  document.getElementById("smSave").textContent="💾 Speichern";
}
async function saveSampleFromEditor(){
  const s=sampleState; const code=pageView?pageView.getCode():""; const title=document.getElementById("smTitleIn").value.trim()||null;
  if(!code.trim()){ toast("Kein Code zum Speichern.","err"); return; }
  const btn=document.getElementById("smSave"); const lbl=btn.textContent; btn.disabled=true; btn.textContent="Speichere…";
  try{
    if(s.editingId){ await api.updateSample(s.editingId,{code,title}); toast("Musterlösung aktualisiert ✓","ok"); }
    else { await api.createSample({assignment_id:s.assignment.id, code, title, released:false}); toast("Musterlösung gespeichert ★","ok"); }
    sampleManager(s.assignment, s.classId);
  }catch(e){ btn.disabled=false; btn.textContent=lbl; toast(e.message||"Fehler","err"); }
}

/* ---------- Schüler: Aufgabe lösen (Historie, Kommentare, Musterlösung) ---------- */
async function solveAssignment(assignmentId){
  shell(`<div class="center-load"><span class="spin"></span>Aufgabe lädt…</div>`);
  let a, history=[], comments=[], samples=[], notes=[];
  try{
    a = await api.getAssignment(assignmentId);
    history = await api.mySubmissions(assignmentId);
    comments = await api.myComments(history.map(s=>s.id));
    samples = await api.releasedSamples(assignmentId);
    try{ notes = await api.submissionNotes(history.map(s=>s.id)); }catch(e){ notes=[]; }
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const current = history.find(s=>s.is_current) || null;
  const code = current ? current.code : (a.starter_code || DEFAULT_STARTER);
  solveState = { a, history, comments, samples, notes, current, viewingId: current?current.id:null };
  const statusHtml = current ? (current.passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`) : `<span class="badge gray">offen</span>`;
  const curComment = current ? comments.find(c=>c.submission_id===current.id && c.released) : null;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(a.title)}</h2><div class="spacer"></div><span id="solveStatus">${statusHtml}</span></div>
    ${a.description?`<div class="card" style="margin-bottom:12px"><b>Aufgabe:</b> ${esc(a.description)}${a.goal?`<div class="muted" style="margin-top:6px;font-size:13px">🎯 Ziel: ${esc(goalLabel(a.goal))}</div>`:""}</div>`:""}
    ${a.hint?`<div style="margin-bottom:12px"><button class="btn btn-ghost btn-sm" id="btnHint">💡 Tipp anzeigen</button><div id="hintBox" class="card" style="display:none;margin-top:8px;background:#fffaf0">💡 ${esc(a.hint)}</div></div>`:""}
    <div id="curComment" style="margin-bottom:12px">${curComment?`<div class="card" style="background:#eef6ff;border-color:#bcd9f5"><b>💬 Rückmeldung deiner Lehrkraft:</b><div style="margin-top:4px;white-space:pre-wrap">${esc(curComment.body)}</div></div>`:""}</div>
    <div id="editNote" class="editnote" style="display:none"></div>
    <div id="solveHost" style="--edh:70vh;min-height:600px"></div>
    <div style="display:flex;gap:10px;margin-top:14px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary btn-lg" id="btnSubmit" style="max-width:240px">📤 Abgeben</button>
      <button class="btn btn-ghost" id="btnToLive" style="display:none">↺ Zur aktuellen Version</button>
      ${samples.length?`<button class="btn btn-ghost" id="btnSamples">🏆 Musterlösung${samples.length>1?"en":""} ansehen</button>`:""}
      <span id="submitMsg" class="muted"></span>
    </div>
    <div class="card" id="myNoteCard" style="margin-top:14px">
      <h3 style="margin:0 0 8px">✍️ Mein Kommentar an die Lehrkraft <span class="muted" style="font-weight:600;font-size:12px">(optional, zur geöffneten Abgabe)</span></h3>
      <textarea class="input" id="myNote" style="min-height:64px" placeholder="z. B. eine Frage oder was du ausprobiert hast…"></textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px"><button class="btn btn-ghost" id="myNoteSave">Kommentar speichern</button><span id="myNoteMsg" class="muted" style="font-size:13px"></span></div>
    </div>
    <div id="histCard"></div>`;
  document.getElementById("back").onclick = ()=> studentClassView(a.class_id);
  if(a.hint){ const hb=document.getElementById("hintBox"), bh=document.getElementById("btnHint"); bh.onclick=()=>{ const show=hb.style.display==="none"; hb.style.display=show?"block":"none"; bh.textContent=show?"💡 Tipp verbergen":"💡 Tipp anzeigen"; }; }
  pageView = new HamsterView("#solveHost", { mode:"solve", model:a.territory, code, fill:true, goal:a.goal, commands: a.show_commands!==false });
  renderHistoryCard();
  const sb2=document.getElementById("btnSamples"); if(sb2) sb2.onclick=()=> openSamplesViewer(a, samples);
  document.getElementById("btnToLive").onclick = ()=> loadVersion(solveState.current);
  document.getElementById("btnSubmit").onclick = submitSolution;
  renderMyNote(current?current.id:null);
  document.getElementById("myNoteSave").onclick = saveMyNote;
}
function renderMyNote(subId){
  const card=document.getElementById("myNoteCard"); if(!card||!solveState) return;
  const ta=document.getElementById("myNote"), btn=document.getElementById("myNoteSave"), msg=document.getElementById("myNoteMsg");
  if(!subId){ if(ta){ta.value="";ta.disabled=true;} if(btn) btn.disabled=true; if(msg) msg.textContent="Erst nach dem Abgeben möglich."; return; }
  if(ta) ta.disabled=false; if(btn) btn.disabled=false;
  const n=(solveState.notes||[]).find(x=>x.submission_id===subId);
  if(ta) ta.value = n?n.body:""; if(msg) msg.textContent = (n&&n.updated_at)? ("gespeichert: "+fmtDateTime(n.updated_at)) : "";
}
async function saveMyNote(){
  const s=solveState; if(!s) return; const subId=s.viewingId;
  if(!subId){ toast("Erst abgeben, dann kommentieren.","err"); return; }
  const body=document.getElementById("myNote").value;
  const btn=document.getElementById("myNoteSave"); btn.disabled=true; btn.textContent="Speichere…";
  try{
    await api.saveSubmissionNote(subId, body);
    const arr=s.notes||(s.notes=[]); const i=arr.findIndex(x=>x.submission_id===subId);
    const row={submission_id:subId, body, updated_at:new Date().toISOString()}; if(i>=0) arr[i]=row; else arr.push(row);
    const msg=document.getElementById("myNoteMsg"); if(msg) msg.textContent="gespeichert ✓"; toast("Kommentar gespeichert ✓","ok");
  }catch(e){ toast(e.message||"Fehler","err"); }
  finally{ btn.disabled=false; btn.textContent="Kommentar speichern"; }
}
function setEditNote(){
  const el=document.getElementById("editNote"); if(!el||!solveState) return;
  const s=solveState; const v=s.history.find(x=>x.id===s.viewingId);
  const toLive=document.getElementById("btnToLive");
  if(v && !v.is_current){
    el.style.display="block";
    el.innerHTML = `✏️ Du bearbeitest eine Kopie deiner Abgabe vom <b>${esc(fmtDateTime(v.submitted_at))}</b>. Mit „Abgeben" wird das deine neue aktuelle Version.`;
    if(toLive) toLive.style.display="";
  } else {
    el.style.display="none";
    if(toLive) toLive.style.display="none";
  }
}
function renderSolveComment(subId){
  const el=document.getElementById("curComment"); if(!el||!solveState) return;
  const c=(solveState.comments||[]).find(x=>x.submission_id===subId && x.released);
  el.innerHTML = c ? `<div class="card" style="background:#eef6ff;border-color:#bcd9f5"><b>💬 Rückmeldung deiner Lehrkraft:</b><div style="margin-top:4px;white-space:pre-wrap">${esc(c.body)}</div></div>` : "";
}
function loadVersion(sub){
  if(!sub||!solveState) return;
  solveState.viewingId = sub.id;
  if(pageView){ pageView.setCode(sub.code); if(pageView.reset) pageView.reset(); }   // Code laden + Territorium auf Aufgaben-Start zurücksetzen
  setEditNote(); renderSolveComment(sub.id); renderMyNote(sub.id); renderHistoryCard();   // Buttons aktualisieren -> geöffnete Abgabe markieren
  const h=document.getElementById("solveHost"); if(h) h.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderHistoryCard(){
  const s=solveState; const card=document.getElementById("histCard"); if(!card) return;
  if(!s.history.length){ card.innerHTML=""; return; }
  const items = s.history.map(sub=>{
    const c = s.comments.find(x=>x.submission_id===sub.id && x.released);
    const badge = sub.passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`;
    const live = sub.is_current?`<span class="badge blue">aktuell</span>`:"";
    const open = sub.id===s.viewingId?`<button class="btn btn-sm btn-ghost" disabled style="margin-left:8px;opacity:.5">geöffnet</button>`:`<button class="btn btn-sm btn-ghost" data-open="${sub.id}" style="margin-left:8px">Öffnen</button>`;
    return `<div class="row"><span class="grow"><span class="t">${esc(fmtDateTime(sub.submitted_at))} ${live}</span>${c?`<span class="s">💬 ${esc(c.body.slice(0,90))}${c.body.length>90?"…":""}</span>`:""}</span>
      ${badge}${open}</div>`;
  }).join("");
  card.innerHTML = `<div class="card" style="margin-top:16px"><h3 style="margin:0">🗂️ Meine Abgaben <span class="badge gray">${s.history.length}</span></h3>
    <div class="list" style="margin-top:10px">${items}</div></div>`;
  card.querySelectorAll("[data-open]").forEach(b=> b.onclick=()=>{ const sub=s.history.find(x=>x.id===b.dataset.open); loadVersion(sub); });
}
async function submitSolution(){
  const s=solveState, a=s.a;
  const myCode = pageView.getCode();
  const passed = gradeSubmission(myCode, a.territory, a.goal);
  const btn=document.getElementById("btnSubmit"); btn.disabled=true; btn.textContent="Sende…";
  try{
    const row = await api.addSubmission({ assignment_id:a.id, code:myCode, status:"submitted", passed });
    s.history.forEach(x=> x.is_current=false);
    s.history.unshift(row); s.current=row; s.viewingId=row.id;
    document.getElementById("solveStatus").innerHTML = passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`;
    document.getElementById("submitMsg").textContent = passed===true ? "Super, Ziel erreicht! 🎉" : passed===false ? "Abgegeben – Ziel noch nicht erfüllt, du kannst es nochmal versuchen." : "Abgegeben! ✓";
    setEditNote(); renderHistoryCard(); renderSolveComment(row.id); renderMyNote(row.id);
    btn.disabled=false; btn.textContent="📤 Erneut abgeben";
    toast("Abgegeben!","ok");
  }catch(e){ btn.disabled=false; btn.textContent="📤 Abgeben"; toast(e.message||"Fehler","err"); }
}
function openSamplesViewer(a, samples){
  let idx=0;
  const tabs = samples.length>1
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${samples.map((sm,i)=>`<button class="btn btn-ghost btn-sm smtab" data-i="${i}">${esc(sm.title||("Lösung "+(i+1)))}</button>`).join("")}</div>`
    : `<div id="smTitle" style="font-weight:800;margin-bottom:8px"></div>`;
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>🏆 Musterlösung${samples.length>1?"en":""}</h3>
    ${tabs}
    <p class="muted" style="font-size:12px;margin:0 0 8px">Wähle eine Lösung; du kannst sie laufen lassen und Schritt für Schritt nachvollziehen.</p>
    <div id="smHost" style="--edh:62vh;min-height:460px"></div>`, true);
  const show=()=>{ const sm=samples[idx];
    if(modalView){ try{ modalView.destroy(); }catch(e){} }
    modalView=new HamsterView("#smHost",{mode:"solve", model:a.territory, code:sm.code, fill:true, goal:a.goal, commands:true});
    if(samples.length>1){ document.querySelectorAll(".smtab").forEach((b,i)=>{ b.classList.toggle("btn-blue", i===idx); b.classList.toggle("btn-ghost", i!==idx); }); }
    else { const t=document.getElementById("smTitle"); if(t) t.textContent=sm.title||"Musterlösung"; }
  };
  document.querySelectorAll(".smtab").forEach(b=> b.onclick=()=>{ idx=+b.dataset.i; show(); });
  show();
}

function fmtDateTime(s){ try{ return new Date(s).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}); }catch(e){ return ""; } }

/* ---------- Passwort ändern (alle Rollen) ---------- */
function changePasswordDialog(){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Passwort ändern</h3><p class="muted" style="margin:2px 0 16px">Gib zur Sicherheit zuerst dein <b>aktuelles</b> Passwort ein, dann das neue (mind. 6 Zeichen).</p>
    <div class="field"><label>Aktuelles Passwort</label><input class="input" id="np0" type="password" autocomplete="current-password"></div>
    <div class="field"><label>Neues Passwort</label><input class="input" id="np1" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Wiederholen</label><input class="input" id="np2" type="password" autocomplete="new-password"></div>
    <button class="btn btn-primary btn-lg" id="npSave">Passwort speichern</button>`);
  document.getElementById("np0").focus();
  document.getElementById("npSave").onclick=async()=>{
    const cur=document.getElementById("np0").value, a=document.getElementById("np1").value, b=document.getElementById("np2").value;
    if(!cur){ toast("Bitte gib dein aktuelles Passwort ein.","err"); return; }
    if(a.length<6){ toast("Das neue Passwort braucht mindestens 6 Zeichen.","err"); return; }
    if(a!==b){ toast("Die Passwörter stimmen nicht überein.","err"); return; }
    const btn=document.getElementById("npSave"); btn.disabled=true; btn.textContent="Speichere…";
    // 1) aktuelles Passwort prüfen – über einen separaten Client, der die eigene Session NICHT stört.
    //    E-Mail aus der AKTUELLEN Session ableiten (robust, falls der Benutzername zwischenzeitlich geändert wurde).
    let curEmail = userEmail(ME.username);
    try{ const { data:gu } = await sb.auth.getUser(); if(gu && gu.user && gu.user.email) curEmail = gu.user.email; }catch(e){}
    const verify = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });
    const { error:vErr } = await verify.auth.signInWithPassword({ email:curEmail, password:cur });
    try{ await verify.auth.signOut({ scope:"local" }); }catch(e){}   // NUR lokal abmelden – 'global' (Default) würde die Tokens der Haupt-Session widerrufen!
    if(vErr){ btn.disabled=false; btn.textContent="Passwort speichern"; toast("Das aktuelle Passwort ist nicht korrekt.","err"); return; }
    // 2) neues Passwort auf der eigenen (Haupt-)Session setzen
    const { error } = await sb.auth.updateUser({ password:a });
    if(error){ btn.disabled=false; btn.textContent="Passwort speichern"; toast(error.message||"Fehler","err"); return; }
    closeModal(); toast("Passwort geändert ✓","ok");
  };
}

/* ---------- Lehrer: Schüler-Passwort zurücksetzen ---------- */
async function resetStudentPw(studentId, name){
  if(!confirm("Passwort von "+name+" zurücksetzen? Es wird ein neues 6-stelliges Passwort erzeugt.")) return;
  const { data:newPw, error } = await sb.rpc("reset_student_password", { p_student: studentId });
  if(error){ toast(error.message||"Fehler","err"); return; }
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Neues Passwort für ${esc(name)}</h3>
    <p class="muted" style="margin:2px 0 14px">Gib es an ${esc(name)} weiter. Damit einloggen, dann oben unter „🔑 Passwort" selbst ein neues setzen.</p>
    <div style="text-align:center;margin:12px 0 6px"><span class="codechip" style="font-size:30px;letter-spacing:5px">${esc(newPw)}</span></div>`);
}

/* ============================================================================
   ADMIN-ANSICHT (alle Klassen & Nutzer:innen verwalten)
   ============================================================================ */
let adminState=null;
async function adminHome(){
  shell(`<div class="center-load"><span class="spin"></span>Admin lädt…</div>`);
  let classes=[], users=[];
  try{
    const c=await sb.from("classes").select("*, teacher:teacher_id(display_name,username)").order("created_at",{ascending:false}); if(c.error) throw c.error; classes=c.data||[];
    const u=await sb.from("profiles").select("id,username,display_name,role,is_admin").order("role"); if(u.error) throw u.error; users=u.data||[];
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  adminState={classes, users};
  const tN=users.filter(u=>u.role==="teacher").length, sN=users.filter(u=>u.role==="student").length, aN=users.filter(u=>u.is_admin).length;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="admBack">← Lehrer-Ansicht</button></div>
    <div class="page-head" style="margin-top:0"><h2>🛠️ Admin</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewClass">+ Neue Klasse</button></div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">📚 Klassen <span class="badge gray">${classes.length}</span></h3><div style="flex:1"></div>
        <input class="input" id="admClsSearch" placeholder="🔍 Klasse · Code · Lehrkraft" style="max-width:260px"></div>
      <div id="admClasses" style="margin-top:12px"></div></div>
    <div class="card">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">👥 Nutzer:innen <span class="badge gray">${users.length}</span> <span class="muted" style="font-weight:600;font-size:12px">· ${tN} Lehrkräfte · ${sN} Schüler:innen${aN?" · "+aN+" Admin":""}</span></h3><div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" id="admImport" style="margin-right:8px">📥 Importieren</button><input class="input" id="admUsrSearch" placeholder="🔍 Name · Benutzername" style="max-width:260px"></div>
      <div id="admUsers" style="margin-top:12px"></div></div>
    ${((window.HAMSTER_CONFIG||{}).ALLOW_REGISTRATION === false) ? "" : `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">✉️ Lehrer-Einladungen</h3><div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" id="admNewInvite">+ Einladung erstellen</button></div>
      <p class="muted" style="margin:6px 0 0;font-size:13px">Wer sich als <b>Lehrkraft</b> registrieren will, braucht einen Einladungscode von dir. Jeder Code gilt <b>einmal</b> und läuft ab.</p>
      <div id="admInvites" style="margin-top:12px"></div></div>`}`;
  document.getElementById("admBack").onclick = ()=> route();   // zurück ins aktive Tool (nicht hart Hamster)
  document.getElementById("btnNewClass").onclick = ()=> newClassDialog({pickTool:true});
  const cs=document.getElementById("admClsSearch"), us=document.getElementById("admUsrSearch");
  cs.oninput=()=> renderAdminClasses(cs.value); us.oninput=()=> renderAdminUsers(us.value);
  document.getElementById("admImport").onclick = ()=> adminImportDialog();
  { const bi=document.getElementById("admNewInvite"); if(bi){ bi.onclick = ()=> newInviteDialog(); } }
  renderAdminClasses(""); renderAdminUsers(""); renderAdminInvites();
}

/* ---------- Admin: Lehrer-Einladungen (phaseZ) ---------- */
async function renderAdminInvites(){
  const el=document.getElementById("admInvites"); if(!el) return;   // fehlt auf dem Schulserver (Registrierung aus)
  el.innerHTML = `<div class="muted" style="font-size:13px">Lade…</div>`;
  let list=[];
  try{ list = await api.adminListInvites(); }
  catch(e){ el.innerHTML = `<div class="empty" style="padding:14px"><span class="ic">⚠️</span>Einladungen konnten nicht geladen werden. Wurde <code>schema_update_phaseZ_security.sql</code> schon eingespielt?</div>`; return; }
  if(!list.length){ el.innerHTML = `<div class="empty" style="padding:14px"><span class="ic">✉️</span>Noch keine Einladung erstellt.</div>`; return; }
  const now=Date.now();
  const rows=list.map(v=>{
    const used=!!v.used_at, exp=new Date(v.expires_at).getTime()<now;
    const who=v.user?(v.user.display_name||v.user.username):"";
    const status = used ? `<span class="badge gray">benutzt${who?" · "+esc(who):""}</span>`
                : exp ? `<span class="badge gray">abgelaufen</span>`
                      : `<span class="badge blue">offen bis ${esc(fmtDateTime(v.expires_at))}</span>`;
    return `<tr><td class="stu">${esc(v.note||"–")}</td><td>${status}</td><td class="muted" style="font-size:12px">${esc(fmtDateTime(v.created_at))}</td>
      <td style="white-space:nowrap"><button class="btn btn-sm btn-ghost" data-delinv="${esc(v.token_hash)}" title="Einladung entfernen">🗑️</button></td></tr>`;
  }).join("");
  el.innerHTML = `<div style="overflow:auto"><table class="matrix" style="width:100%"><thead><tr><th class="stu">Notiz</th><th>Status</th><th>Erstellt</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  el.querySelectorAll("[data-delinv]").forEach(b=> b.onclick=async()=>{
    if(!confirm("Diese Einladung entfernen? Ein noch nicht benutzter Code wird dadurch ungültig.")) return;
    try{ await api.adminDeleteInvite(b.dataset.delinv); toast("Einladung entfernt","ok"); renderAdminInvites(); }
    catch(e){ toast(e.message||"Fehler","err"); }
  });
}
function newInviteDialog(){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>✉️ Lehrer-Einladung erstellen</h3>
    <p class="muted" style="margin:2px 0 14px">Der Code wird dir <b>nur einmal</b> angezeigt – danach ist er nicht mehr lesbar (er liegt nur verschlüsselt in der Datenbank).</p>
    <div class="field"><label>Für wen? (Notiz)</label><input class="input" id="ivNote" maxlength="60" placeholder="z. B. Herr Glücks"></div>
    <div class="field"><label>Gültig für</label><select class="input" id="ivDays">
      <option value="7">7 Tage</option><option value="14" selected>14 Tage</option><option value="30">30 Tage</option><option value="90">90 Tage</option></select></div>
    <button class="btn btn-primary btn-lg" id="ivGo">Einladung erstellen</button>`);
  const note=document.getElementById("ivNote"); note.focus();
  document.getElementById("ivGo").onclick = async ()=>{
    const btn=document.getElementById("ivGo"); btn.disabled=true; btn.textContent="Erstelle…";
    try{
      const code = await api.adminCreateInvite(note.value.trim(), parseInt(document.getElementById("ivDays").value,10));
      openModal(`<button class="x" onclick="closeModal()">✕</button>
        <h3>✅ Einladung erstellt</h3>
        <p class="muted" style="margin:2px 0 12px">Gib diesen Code weiter. Er funktioniert <b>genau einmal</b> und wird <b>nicht wieder angezeigt</b>.</p>
        <div style="background:var(--bg,#f7f9fc);border:2px dashed var(--line,#e6ebf2);border-radius:12px;padding:16px;text-align:center;font-family:ui-monospace,Consolas,monospace;font-size:20px;font-weight:800;letter-spacing:2px;word-break:break-all" id="ivCode">${esc(code)}</div>
        <button class="btn btn-ghost btn-lg" id="ivCopy" style="margin-top:12px">📋 Kopieren</button>`);
      document.getElementById("ivCopy").onclick = ()=>{
        try{ navigator.clipboard.writeText(code); toast("Code kopiert ✓","ok"); }
        catch(e){ toast("Bitte von Hand markieren und kopieren.","err"); }
      };
      renderAdminInvites();
    }catch(e){ btn.disabled=false; btn.textContent="Einladung erstellen"; toast(e.message||"Fehler","err"); }
  };
}
function renderAdminClasses(q){
  const el=document.getElementById("admClasses"); if(!el||!adminState) return;
  q=(q||"").trim().toLowerCase();
  const tname=c=>(c.teacher&&(c.teacher.display_name||c.teacher.username))||"";
  const list=adminState.classes.filter(c=> !q || (c.name||"").toLowerCase().includes(q)||(c.code||"").toLowerCase().includes(q)||tname(c).toLowerCase().includes(q));
  const toolBadge=c=> c.tool==="sql"?'<span class="badge blue" style="margin-left:6px">SQL</span>':c.tool==="filius"?'<span class="badge" style="margin-left:6px;background:#e7ddff;color:#6b3fd4">Netzwerke</span>':c.tool==="java"?'<span class="badge" style="margin-left:6px;background:#ffe3c9;color:#a05a00">Java</span>':'<span class="badge gray" style="margin-left:6px">Hamster</span>';
  el.innerHTML = list.length ? `<div class="grid">${list.map(c=>`
      <div class="card click" data-id="${c.id}" data-tool="${esc(c.tool||"hamster")}"><h3>${esc(c.name)}${toolBadge(c)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b> · 👩‍🏫 ${esc(tname(c)||"–")}</div></div>`).join("")}</div>`
    : `<div class="empty" style="padding:14px"><span class="ic">🔍</span>Keine Klasse gefunden.</div>`;
  el.querySelectorAll(".card.click").forEach(c=> c.onclick=()=>{ viewFromAdmin=true; classViewFor(c.dataset.tool)(c.dataset.id); });
}
function renderAdminUsers(q){
  const el=document.getElementById("admUsers"); if(!el||!adminState) return;
  q=(q||"").trim().toLowerCase();
  const list=adminState.users.filter(u=> !q || (u.display_name||"").toLowerCase().includes(q)||(u.username||"").toLowerCase().includes(q));
  const rows=list.map(u=>{
    const nm=esc(u.display_name||u.username);
    const badge = u.is_admin?'<span class="badge" style="background:#ffe0b2;color:#b35900">Admin</span>':u.role==="teacher"?'<span class="badge blue">Lehrkraft</span>':'<span class="badge gray">Schüler:in</span>';
    let acts="";
    if(u.is_admin){
      acts = (u.id===ME.id) ? '<span class="muted" style="font-size:12px">(du)</span>'
        : `<button class="btn btn-sm btn-ghost" data-unadmin="${u.id}" data-nm="${nm}">Admin-Rang entfernen</button>`;
    } else {
      if(u.role==="teacher") acts += `<button class="btn btn-sm btn-ghost" data-mkadmin="${u.id}" data-nm="${nm}" title="zum Admin machen">⭐ Admin</button> `;
      acts += `<button class="btn btn-sm btn-ghost" data-pw="${u.id}" data-nm="${nm}" title="Passwort neu generieren">🔑</button> `;
      acts += `<button class="btn btn-sm btn-ghost" data-deluser="${u.id}" data-nm="${nm}" title="Account löschen">🗑️</button>`;
    }
    if(u.id!==ME.id) acts = `<button class="btn btn-sm btn-ghost" data-rename="${u.id}" data-nm="${nm}" data-un="${esc(u.username)}" title="Name & Benutzername ändern">✏️ Bearbeiten</button> ` + acts;
    return `<tr><td class="stu clickable" data-prof="${u.id}" title="Profil ansehen">${nm}</td><td><code>${esc(u.username)}</code></td><td>${badge}</td><td style="white-space:nowrap">${acts}</td></tr>`;
  }).join("");
  el.innerHTML = list.length ? `<div style="overflow:auto"><table class="matrix" style="width:100%"><thead><tr><th class="stu">Name</th><th>Benutzername</th><th>Rolle</th><th>Aktionen</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty" style="padding:14px"><span class="ic">🔍</span>Niemand gefunden.</div>`;
  el.querySelectorAll("[data-prof]").forEach(b=> b.onclick=()=> adminUserProfile(b.dataset.prof));
  el.querySelectorAll("[data-rename]").forEach(b=> b.onclick=()=> renameUserDialog(b.dataset.rename, b.dataset.nm, b.dataset.un));
  el.querySelectorAll("[data-pw]").forEach(b=> b.onclick=()=> resetStudentPw(b.dataset.pw, b.dataset.nm));
  el.querySelectorAll("[data-deluser]").forEach(b=> b.onclick=async()=>{ if(!confirm("Account von "+b.dataset.nm+" WIRKLICH löschen? Alle zugehörigen Daten – bei Lehrkräften auch ihre erstellten Klassen – werden entfernt. Nicht umkehrbar.")) return; try{ await api.adminDeleteUser(b.dataset.deluser); toast("Account gelöscht","ok"); adminHome(); }catch(e){ toast(e.message||"Fehler","err"); } });
  el.querySelectorAll("[data-mkadmin]").forEach(b=> b.onclick=async()=>{ if(!confirm(b.dataset.nm+" zum Admin machen? (Behält die Lehrer-Rolle.)")) return; try{ await api.setAdmin(b.dataset.mkadmin, true); toast("Ist jetzt Admin ⭐","ok"); adminHome(); }catch(e){ toast(e.message||"Fehler","err"); } });
  el.querySelectorAll("[data-unadmin]").forEach(b=> b.onclick=async()=>{ if(!confirm(b.dataset.nm+" den Admin-Rang entziehen?")) return; try{ await api.setAdmin(b.dataset.unadmin, false); toast("Admin-Rang entfernt","ok"); adminHome(); }catch(e){ toast(e.message||"Fehler","err"); } });
}

/* ---------- Admin: Benutzername ändern ---------- */
function renameUserDialog(userId, name, currentUsername){
  const sp=String(name||"").trim().split(/\s+/); const first0=sp.shift()||""; const last0=sp.join(" ");
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Nutzer:in bearbeiten</h3>
    <p class="muted" style="margin:2px 0 14px">Vor- und Nachname sowie Benutzername (= Login-Name) ändern.</p>
    <div class="field"><label>Vorname</label><input class="input" id="ruFirst" maxlength="40"></div>
    <div class="field"><label>Nachname</label><input class="input" id="ruLast" maxlength="40"></div>
    <div class="field"><label>Benutzername</label><input class="input" id="ruName" autocapitalize="none" spellcheck="false" style="font-family:monospace"></div>
    <button class="btn btn-primary btn-lg" id="ruSave">Speichern</button>`);
  const fi=document.getElementById("ruFirst"), la=document.getElementById("ruLast"), inp=document.getElementById("ruName");
  fi.value=first0; la.value=last0; inp.value=currentUsername||""; fi.focus(); fi.select();
  const go=async()=>{
    const u=inp.value.trim().toLowerCase();
    const disp=(fi.value.trim()+" "+la.value.trim()).trim();
    const origDisp=String(name||"").replace(/\s+/g," ").trim();   // gleiche Normalisierung wie disp -> kein Schreib-Write bei reiner Whitespace-Differenz
    if(!/^[a-z0-9_.\-]{3,20}$/.test(u)){ toast("Benutzername: 3–20 Zeichen: a–z, 0–9, Punkt, _ , -","err"); return; }
    if(!disp){ toast("Bitte einen Vor- und/oder Nachnamen eingeben.","err"); return; }
    const unchanged = (u===currentUsername) && (disp===origDisp);
    if(unchanged){ closeModal(); return; }
    const btn=document.getElementById("ruSave"); btn.disabled=true; btn.textContent="Speichere…";
    try{
      if(u!==currentUsername) await api.adminRenameUser(userId, u);
      if(disp!==origDisp) await api.adminSetDisplayName(userId, disp);
      closeModal(); toast("Gespeichert ✓","ok"); adminHome();
    }catch(e){ btn.disabled=false; btn.textContent="Speichern"; toast(e.message||"Fehler","err"); }
  };
  document.getElementById("ruSave").onclick=go;
  [fi,la,inp].forEach(el=> el.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); }));
}

/* ---------- Admin: Nutzer-Profil (Schüler & Lehrkräfte) ---------- */
async function adminUserProfile(userId){
  shell(`<div class="center-load"><span class="spin"></span>Profil…</div>`);
  let prof=null, overview=null;
  try{ const {data,error}=await sb.from("profiles").select("*").eq("id",userId).single(); if(error) throw error; prof=data; }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!prof){ document.getElementById("view").innerHTML=errBox({message:"Nutzer:in nicht gefunden."}); return; }
  try{ overview=await api.studentOverview(userId); }catch(e){ overview=null; }
  const name=prof.display_name||prof.username;
  const roleBadge = prof.is_admin?'<span class="badge" style="background:#ffe0b2;color:#b35900">Admin</span>':prof.role==="teacher"?'<span class="badge blue">Lehrkraft</span>':'<span class="badge gray">Schüler:in</span>';
  const lastLogin=(overview&&overview.last_login)?fmtDateTime(overview.last_login):"—";
  const lastSub=overview&&overview.last_submission?new Date(overview.last_submission):null;
  const lastSbx=overview&&overview.last_sandbox?new Date(overview.last_sandbox):null;
  let activity="—";
  if(lastSbx && (!lastSub||lastSbx>lastSub)) activity="🧪 Sandbox gespeichert · "+fmtDateTime(overview.last_sandbox);
  else if(lastSub) activity="📤 Aufgabe abgegeben · "+fmtDateTime(overview.last_submission);
  let classesHtml="";
  try{
    if(prof.role==="student"){
      const {data:ms}=await sb.from("memberships").select("joined_at, classes:class_id(id,name,code,tool,teacher:teacher_id(display_name,username))").eq("student_id",userId);
      const rows=(ms||[]).map(m=>{ const c=m.classes||{}; const t=c.teacher||{}; return `<div class="row clickrow" data-cls="${c.id}" data-tool="${esc(c.tool||"hamster")}" style="cursor:pointer"><span class="grow"><span class="t">${esc(c.name||"?")}</span><span class="s">Code: ${esc(c.code||"–")} · 👩‍🏫 ${esc(t.display_name||t.username||"–")}</span></span><span style="color:#7a8aa0">→</span></div>`; }).join("");
      classesHtml=`<h3 style="margin:0 0 10px">🎒 Klassen (Mitglied) <span class="badge gray">${(ms||[]).length}</span></h3><div class="list">${rows||'<div class="muted" style="font-size:13px">In keiner Klasse.</div>'}</div>`;
    } else {
      const own=await sb.from("classes").select("id,name,code,tool").eq("teacher_id",userId).order("created_at",{ascending:false});
      const co=await sb.from("class_teachers").select("classes:class_id(id,name,code,tool)").eq("teacher_id",userId);
      const ownRows=((own.data)||[]).map(c=>`<div class="row clickrow" data-cls="${c.id}" data-tool="${esc(c.tool||"hamster")}" style="cursor:pointer"><span class="grow"><span class="t">${esc(c.name)}</span><span class="s">Code: ${esc(c.code)} · Eigentümer:in</span></span><span style="color:#7a8aa0">→</span></div>`).join("");
      const coRows=((co.data)||[]).map(x=>{ const c=x.classes||{}; return `<div class="row clickrow" data-cls="${c.id}" data-tool="${esc(c.tool||"hamster")}" style="cursor:pointer"><span class="grow"><span class="t">${esc(c.name||"?")}</span><span class="s">Code: ${esc(c.code||"–")} · Co-Lehrkraft</span></span><span style="color:#7a8aa0">→</span></div>`; }).join("");
      const cnt=((own.data)||[]).length+((co.data)||[]).length;
      classesHtml=`<h3 style="margin:0 0 10px">👩‍🏫 Klassen <span class="badge gray">${cnt}</span></h3><div class="list">${(ownRows+coRows)||'<div class="muted" style="font-size:13px">Keine Klassen.</div>'}</div>`;
    }
  }catch(e){ classesHtml=`<div class="muted" style="font-size:13px">Klassen konnten nicht geladen werden.</div>`; }
  document.getElementById("view").innerHTML=`
    <div class="page-head"><button class="crumb" id="back">← Admin-Bereich</button></div>
    <div class="page-head" style="margin-top:0"><h2><span class="chip" style="font-size:16px"><span class="av">${esc(initials(name))}</span>${esc(name)}</span></h2><div class="spacer"></div>${roleBadge}</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-bottom:14px">
      <div class="card"><div class="meta">🪪 Benutzername</div><div style="font-weight:900;margin-top:4px"><code>${esc(prof.username)}</code></div></div>
      <div class="card"><div class="meta">🕐 Zuletzt eingeloggt</div><div style="font-weight:900;margin-top:4px">${esc(lastLogin)}</div></div>
      <div class="card"><div class="meta">⚡ Letzte Aktivität</div><div style="font-weight:900;margin-top:4px">${esc(activity)}</div></div>
    </div>
    <div class="card">${classesHtml}</div>`;
  document.getElementById("back").onclick = adminHome;
  document.querySelectorAll("[data-cls]").forEach(b=> b.onclick=()=>{ viewFromAdmin=true; classViewFor(b.dataset.tool)(b.dataset.cls); });
}

/* ============================================================================
   LEHRER-ANSICHT
   ============================================================================ */
/* ---------- Klassen-Übersicht: Suche + Sortierung (Lehrer:innen & Schüler:innen) ---------- */
function classSearchSortControls(){
  return `<input class="input" id="clsSearch" placeholder="🔍 Klasse suchen" style="max-width:220px">
    <div class="spacer"></div>
    <select class="input" id="clsSort" style="max-width:230px">
      <option value="created-desc">Sortieren: Neueste zuerst</option>
      <option value="created-asc">Älteste zuerst</option>
      <option value="name-asc">Name A–Z</option>
      <option value="name-desc">Name Z–A</option>
      <option value="activity">Letzte Änderung</option>
    </select>`;
}
async function loadClassActivity(){
  if(_classActivity) return _classActivity;
  try{ const { data } = await sb.rpc("class_activity"); const m={}; (data||[]).forEach(r=> m[r.class_id]=new Date(r.last_at).getTime()); _classActivity=m; }
  catch(e){ _classActivity={}; }
  return _classActivity;
}
function sortClasses(arr, key){
  const a=arr.slice(); const nm=c=>(c.name||"").toLowerCase(); const created=c=> new Date(c.created_at).getTime();
  if(key==="name-asc") a.sort((x,y)=> nm(x).localeCompare(nm(y),"de"));
  else if(key==="name-desc") a.sort((x,y)=> nm(y).localeCompare(nm(x),"de"));
  else if(key==="created-asc") a.sort((x,y)=> created(x)-created(y));
  else if(key==="activity"){ const m=_classActivity||{}; a.sort((x,y)=> (m[y.id]||created(y))-(m[x.id]||created(x))); }
  else a.sort((x,y)=> created(y)-created(x));   // created-desc (Default)
  return a;
}
function wireClassOverview(classes, cardHtml, onOpen, emptyHtml){
  const host=document.getElementById("clsHost"); if(!host) return;
  let q="", sortKey="created-desc";
  const paint=()=>{
    let list=classes.slice(); const qq=q.trim().toLowerCase();
    if(qq) list=list.filter(c=> (c.name||"").toLowerCase().includes(qq) || (c.code||"").toLowerCase().includes(qq));
    list=sortClasses(list, sortKey);
    host.innerHTML = list.length ? `<div class="grid">${list.map(cardHtml).join("")}</div>`
      : (qq ? `<div class="empty" style="padding:14px"><span class="ic">🔍</span>Keine Klasse gefunden.</div>` : (emptyHtml||""));
    host.querySelectorAll(".card.click").forEach(c=> c.onclick=()=> onOpen(c.dataset.id));
  };
  const se=document.getElementById("clsSearch"); if(se) se.oninput=()=>{ q=se.value; paint(); };
  const so=document.getElementById("clsSort"); if(so) so.onchange=async()=>{ sortKey=so.value; if(sortKey==="activity" && !_classActivity){ so.disabled=true; await loadClassActivity(); so.disabled=false; } paint(); };
  paint();
}

async function teacherHome(){
  shell(`<div class="center-load"><span class="spin"></span>Klassen werden geladen…</div>`);
  _classActivity=null;   // bei jedem Übersichts-Aufruf frisch laden (Aktivitäts-Sortierung)
  let classes=[];
  try{ classes = await api.myTeacherClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnTemplates">📋 Vorlagen</button>
      <button class="btn btn-ghost" id="btnSandbox" style="margin-left:8px">🧪 Sandbox</button>
      <button class="btn btn-primary" id="btnNewClass" style="margin-left:8px">+ Neue Klasse</button></div>
    ${classes.length>1?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnSandbox").onclick = ()=> sandboxHome(null);
  document.getElementById("btnTemplates").onclick = ()=> templatesPage({label:"← Meine Klassen", go:teacherHome});
  document.getElementById("btnNewClass").onclick = newClassDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}">
        <h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b></div>
      </div>`, id=>{ viewFromAdmin=false; teacherClassView(id); },
    `<div class="empty"><span class="ic">📚</span>Noch keine Klassen. Erstelle deine erste Klasse!</div>`);
}
function newClassDialog(opts){
  opts=opts||{};
  const toolField = opts.pickTool ? `<div class="field"><label>Tool</label><select class="input" id="clTool"><option value="hamster">🐹 Hamster-Simulator</option><option value="sql">🗄️ SQL-Playground</option><option value="filius">🌐 Netzwerke (angelehnt an FILIUS)</option><option value="java">☕ Java</option></select></div>` : "";
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Neue Klasse</h3><p class="muted" style="margin:2px 0 16px">Gib der Klasse einen Namen – der Einlade-Code wird automatisch erzeugt.</p>
    ${toolField}
    <div class="field"><label>Klassenname</label><input class="input" id="clName" placeholder="z. B. Informatik 9b" maxlength="60"></div>
    <button class="btn btn-primary btn-lg" id="clCreate">Klasse erstellen</button>`);
  const inp=document.getElementById("clName"); inp.focus();
  const go=async()=>{ const name=inp.value.trim(); if(!name){ inp.focus(); return; }
    const tool = opts.pickTool ? (document.getElementById("clTool").value||"hamster") : (ACTIVE_TOOL||"hamster");
    const btn=document.getElementById("clCreate"); btn.disabled=true; btn.textContent="Erstelle…";
    try{ const c=await api.createClass(name, tool); closeModal(); toast('Klasse "'+name+'" erstellt 🎉',"ok"); viewFromAdmin = !!opts.pickTool; classViewFor(tool)(c.id); }
    catch(e){ btn.disabled=false; btn.textContent="Klasse erstellen"; toast(e.message||"Fehler","err"); } };
  document.getElementById("clCreate").onclick=go;
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}

async function teacherClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Klasse wird geladen…</div>`);
  const secOpen = classSecOpen[classId] || (classSecOpen[classId]={auf:true, mat:true, stu:true, leh:true});
  let cls, roster=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single();
    cls=data; roster = await api.classRoster(classId);
    roster.sort((a,b)=>{ const na=((a.profiles&&(a.profiles.display_name||a.profiles.username))||"").toLowerCase(), nb=((b.profiles&&(b.profiles.display_name||b.profiles.username))||"").toLowerCase(); return na.localeCompare(nb,"de"); });
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!cls){ document.getElementById("view").innerHTML=errBox({message:"Klasse nicht gefunden."}); return; }
  let teachers=[]; try{ teachers = await api.classTeachersNamed(classId); }catch(e){ teachers=[]; }
  const canTeam = (cls.teacher_id===ME.id || ME.is_admin);
  const iAmCoTeacher = !canTeam && teachers.some(t=>t.id===ME.id && !t.is_owner);

  const rosterHtml = roster.length ? `<div class="list">${roster.map(m=>{
      const p=m.profiles||{}; const nm=p.display_name||p.username||"?";
      return `<div class="row"><span class="chip chipbtn" data-prof="${m.student_id}" title="Profil ansehen" style="cursor:pointer"><span class="av">${esc(initials(nm))}</span>${esc(nm)}</span>
        <div class="grow"></div><span class="muted" style="font-size:11.5px;margin-right:4px">${fmtDate(m.joined_at)}</span>
        <button class="btn btn-sm btn-ghost" data-stu="${m.student_id}" data-nm="${esc(nm)}" title="Passwort zurücksetzen">🔑</button>
        <button class="btn btn-sm btn-ghost" data-rmstu="${m.student_id}" data-nm="${esc(nm)}" title="aus Klasse entfernen">🗑️</button></div>`;
    }).join("")}</div>`
    : `<div class="empty"><span class="ic">🎒</span>Noch keine Schüler:innen. Teile den Code <b>${esc(cls.code)}</b>!</div>`;

  let assignments=[], subs=[];
  try{ assignments = await api.listAssignments(classId); subs = await api.classSubmissions(assignments.map(a=>a.id)); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }

  const assignHtml = assignments.length ? `<div class="list">${assignments.map(a=>`
      <div class="row"><span class="grow"><span class="t clickable" data-edit="${a.id}" title="Aufgabe bearbeiten">${esc(a.title)} ${a.published?"":'<span class="badge gold">Entwurf</span>'}</span><span class="s">${a.goal?`🎯 ${esc(goalLabel(a.goal))}`:"kein Auto-Check"}</span></span>
        <span class="acts">
          <button class="abtn" data-up="${a.id}" title="nach oben">↑</button>
          <button class="abtn" data-down="${a.id}" title="nach unten">↓</button>
          <button class="abtn" data-pub="${a.id}" data-on="${a.published?1:0}" title="${a.published?'verbergen (Entwurf)':'veröffentlichen'}">${a.published?'👁️':'🚀'}</button>
          <button class="abtn" data-stats="${a.id}" title="Statistik / Dashboard">📊</button>
          <button class="abtn" data-sample="${a.id}" title="Musterlösungen verwalten">★</button>
          <button class="abtn" data-edit="${a.id}" title="bearbeiten">✏️</button>
          <button class="abtn" data-del="${a.id}" title="löschen">🗑️</button>
        </span></div>`).join("")}</div>`
    : `<div class="empty" style="padding:16px"><span class="ic">📝</span>Noch keine Aufgaben.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${viewFromAdmin?"← Admin-Bereich":"← Meine Klassen"}</button><div class="spacer"></div><button class="btn btn-ghost btn-sm" id="btnTplTop">📋 Vorlagen</button></div>
    <div class="page-head" style="margin-top:0">
      <h2>${esc(cls.name)} <button class="btn btn-ghost btn-sm" id="btnRename" title="Klasse umbenennen" style="vertical-align:middle">✏️</button>${CLASS_REFRESH_BTN}</h2>
      <div class="spacer"></div>
      <span class="codechip" title="Einlade-Code" style="${cls.join_open===false?'opacity:.55;':''}">🔑 ${esc(cls.code)}${cls.join_open===false?' <span class="badge gray" title="Beitritt mit diesem Code ist deaktiviert">aus</span>':''} <button class="btn btn-sm btn-ghost" id="copyCode" style="margin-left:4px">Kopieren</button></span>
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnCodeToggle" style="margin-left:8px" title="${cls.join_open===false?'Beitritt mit diesem Code wieder erlauben':'Beitritt mit diesem Code deaktivieren'}">${cls.join_open===false?'🔓 Aktivieren':'🚫 Code deaktivieren'}</button><button class="btn btn-ghost btn-sm" id="btnCodeNew" style="margin-left:6px" title="Neuen Code erzeugen – der alte wird ungültig">🔄 Neuer Code</button>`:''}
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnDeleteClass" style="margin-left:8px;color:#e63a3a" title="Klasse löschen">🗑️ Löschen</button>`:(iAmCoTeacher?`<button class="btn btn-ghost btn-sm" id="btnLeaveClass" style="margin-left:8px;color:#e63a3a" title="Klasse verlassen">🚪 Klasse verlassen</button>`:"")}
    </div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="auf" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.auf?"▼":"▶"}</span><h3 style="margin:0">📝 Aufgaben <span class="badge gray">${assignments.length}</span></h3></span><div style="flex:1"></div><button class="btn btn-blue btn-sm" id="btnNewAssign">+ Aufgabe stellen</button></div>
      <div id="sec-auf" style="margin-top:12px${secOpen.auf?"":";display:none"}">${assignHtml}</div></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="mat" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.mat?"▼":"▶"}</span><h3 style="margin:0">📊 Abgabe-Matrix</h3></span><div style="flex:1"></div>${(assignments.length&&roster.length)?'<button class="btn btn-ghost btn-sm" id="btnMatrixMax" title="Matrix im Vollbild öffnen">⛶ Vergrößern</button>':''}</div>
      <div id="sec-mat" style="margin-top:12px${secOpen.mat?"":";display:none"}">${(assignments.length&&roster.length)?`<div style="display:flex;margin-bottom:10px"><div style="flex:1"></div><input class="input" id="matrixSearch" placeholder="🔍 Schüler:in suchen" style="max-width:240px"></div>`:""}<div id="matrixHost"></div></div></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="stu" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.stu?"▼":"▶"}</span><h3 style="margin:0">🎒 Schüler:innen <span class="badge gray">${roster.length}</span></h3></span><div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="btnImport">📥 Importieren</button></div>
      <div id="sec-stu" style="margin-top:12px${secOpen.stu?"":";display:none"}">${rosterHtml}</div></div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="leh" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.leh?"▼":"▶"}</span><h3 style="margin:0">👩‍🏫 Lehrkräfte <span class="badge gray">${teachers.length}</span></h3></span><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnTeachers">+ verwalten</button>':''}</div>
      <div id="sec-leh" class="list" style="margin-top:12px${secOpen.leh?"":";display:none"}">${teachers.length?teachers.map(t=>`<div class="row"><span class="chip"><span class="av">${esc(initials(t.display_name||t.username))}</span>${esc(t.display_name||t.username)}</span><div class="grow"></div>${t.is_owner?'<span class="badge blue">Ersteller:in</span>':'<span class="badge gray">Co-Lehrkraft</span>'}</div>`).join(""):'<div class="muted" style="font-size:13px">—</div>'}</div></div>`;
  document.getElementById("back").onclick = ()=> (viewFromAdmin?adminHome():teacherHome());
  document.getElementById("btnTplTop").onclick = ()=> templatesPage({label:"← zurück zur Klasse", go:()=> teacherClassView(classId)});
  document.getElementById("copyCode").onclick = ()=>{ if(navigator.clipboard) navigator.clipboard.writeText(cls.code); toast("Code kopiert: "+cls.code,"ok"); };
  document.getElementById("btnRename").onclick = ()=> renameClassDialog(classId, cls.name, cls.tool);
  wireClassRefresh(()=> teacherClassView(classId));
  { const bt=document.getElementById("btnCodeToggle"); if(bt) bt.onclick=async()=>{ const disabling=(cls.join_open!==false); if(disabling){ if(!confirm(`Beitritt für „${cls.name}" deaktivieren?\n\nMit dem Code ${cls.code} kann danach niemand mehr neu beitreten. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; } try{ await api.setClassJoinOpen(classId, !disabling); toast(disabling?"Beitritt deaktiviert 🚫":"Beitritt wieder aktiv 🔓","ok"); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bn=document.getElementById("btnCodeNew"); if(bn) bn.onclick=async()=>{ if(!confirm(`Neuen Einlade-Code für „${cls.name}" erzeugen?\n\nDer bisherige Code ${cls.code} wird sofort ungültig – verteile danach den neuen Code. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; try{ const nc=await api.regenerateClassCode(classId); toast("Neuer Code: "+nc,"ok"); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  document.querySelectorAll(".sectoggle[data-sec]").forEach(t=> t.onclick=()=>{ const k=t.dataset.sec; secOpen[k]=!secOpen[k]; const body=document.getElementById("sec-"+k); if(body) body.style.display=secOpen[k]?"":"none"; const ar=t.querySelector(".secarrow"); if(ar) ar.textContent=secOpen[k]?"▼":"▶"; });
  { const bd=document.getElementById("btnDeleteClass"); if(bd) bd.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich löschen? Alle Aufgaben, Abgaben und Zuordnungen dieser Klasse werden unwiderruflich entfernt.`)) return; try{ await api.deleteClass(classId); toast("Klasse gelöscht","ok"); if(viewFromAdmin) adminHome(); else teacherHome(); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bl=document.getElementById("btnLeaveClass"); if(bl) bl.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich verlassen? Du bist danach keine Co-Lehrkraft mehr und siehst die Klasse nicht mehr.`)) return; try{ await api.removeClassTeacher(classId, ME.id); toast("Klasse verlassen","ok"); teacherHome(); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  document.getElementById("btnImport").onclick = ()=> importStudentsDialog(classId, cls.code, ()=>teacherClassView(classId));
  { const bt=document.getElementById("btnTeachers"); if(bt) bt.onclick=()=> classTeachersDialog(classId, cls); }
  document.querySelectorAll("[data-rmstu]").forEach(b=> b.onclick=async()=>{ if(!confirm(b.dataset.nm+" aus dieser Klasse entfernen? (Der Account bleibt bestehen.)")) return; try{ await api.removeMembership(classId, b.dataset.rmstu); toast("Entfernt","ok"); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.getElementById("btnNewAssign").onclick = ()=> assignmentEditorPage(classId, ()=>teacherClassView(classId));
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=>{ const a=assignments.find(x=>x.id===b.dataset.edit); assignmentEditorPage(classId, ()=>teacherClassView(classId), a); });
  document.querySelectorAll("[data-sample]").forEach(b=> b.onclick=()=>{ const a=assignments.find(x=>x.id===b.dataset.sample); sampleManager(a, classId); });
  document.querySelectorAll("[data-stats]").forEach(b=> b.onclick=()=>{ const a=assignments.find(x=>x.id===b.dataset.stats); assignmentStats(a, classId); });
  document.querySelectorAll("[data-up]").forEach(b=> b.onclick=async()=>{ await moveAssignment(assignments, b.dataset.up, -1); teacherClassView(classId); });
  document.querySelectorAll("[data-down]").forEach(b=> b.onclick=async()=>{ await moveAssignment(assignments, b.dataset.down, 1); teacherClassView(classId); });
  document.querySelectorAll("[data-pub]").forEach(b=> b.onclick=async()=>{ try{ await api.updateAssignment(b.dataset.pub, { published: b.dataset.on!=="1" }); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Aufgabe wirklich löschen?")) return; try{ await api.deleteAssignment(b.dataset.del); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  const nameOf=(sid)=>{ const stu=roster.find(r=>r.student_id===sid); return (stu&&stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?"; };
  const userOf=(sid)=>{ const stu=roster.find(r=>r.student_id===sid); return (stu&&stu.profiles&&stu.profiles.username)||""; };
  const openProfile=(sid)=> studentProfilePage(classId, sid, nameOf(sid), userOf(sid));
  const paintMatrixInto=(host, q, close)=>{ if(!host) return;
    host.innerHTML = (assignments.length&&roster.length) ? buildMatrix(roster, assignments, subs, q)
      : `<div class="empty"><span class="ic">📊</span>${!assignments.length?"Stelle Aufgaben – dann erscheint hier, wer was abgegeben hat.":"Noch keine Schüler:innen in der Klasse."}</div>`;
    host.querySelectorAll(".cell[data-aid]").forEach(c=> c.onclick=()=>{ const aid=c.dataset.aid, sid=c.dataset.sid; const a=assignments.find(x=>x.id===aid); const hist=subs.filter(x=>x.assignment_id===aid && x.student_id===sid); if(!a||!hist.length) return; if(close) close(); reviewSubmission(a, hist, nameOf(sid), classId); });
    host.querySelectorAll("[data-prof]").forEach(b=> b.onclick=()=>{ if(close) close(); openProfile(b.dataset.prof); });
  };
  paintMatrixInto(document.getElementById("matrixHost"), "", null);
  { const ms=document.getElementById("matrixSearch"); if(ms) ms.oninput=()=> paintMatrixInto(document.getElementById("matrixHost"), ms.value, null); }
  { const bx=document.getElementById("btnMatrixMax"); if(bx) bx.onclick=()=> openMatrixModal("📊 Abgabe-Matrix – "+cls.name, (host,q,close)=> paintMatrixInto(host,q,close)); }
  document.querySelectorAll(".chip[data-prof]").forEach(b=> b.onclick=()=> openProfile(b.dataset.prof));
  document.querySelectorAll("[data-stu]").forEach(b=> b.onclick=()=> resetStudentPw(b.dataset.stu, b.dataset.nm));
}
function buildMatrix(roster, assignments, subs, q){
  q=(q||"").trim().toLowerCase();
  const nmeOf=stu=>(stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?";
  const list = q ? roster.filter(stu=> nmeOfSafe(nmeOf(stu)).includes(q)) : roster;
  const head = assignments.map(a=>`<th title="${esc(a.title)}">${esc(a.title.length>14?a.title.slice(0,13)+"…":a.title)}</th>`).join("");
  if(!list.length) return `<div class="empty" style="padding:16px"><span class="ic">🔍</span>Keine Schüler:in gefunden.</div>`;
  const rows = list.map(stu=>{
    const nm=nmeOf(stu);
    const cells = assignments.map(a=>{
      const mine=subs.filter(x=>x.assignment_id===a.id && x.student_id===stu.student_id);
      const cur=mine.find(z=>z.is_current) || mine[0];
      if(!cur) return `<td><span class="cell none">·</span></td>`;
      const cl=cur.passed===true?"pass":"done"; const ic=cur.passed===true?"★":"✓";
      const cnt=mine.length>1?`<sup style="font-size:9px;font-weight:800">${mine.length}</sup>`:"";
      return `<td><span class="cell ${cl}" data-aid="${a.id}" data-sid="${stu.student_id}" title="${mine.length} Abgabe(n) – ansehen">${ic}${cnt}</span></td>`;
    }).join("");
    return `<tr><td class="stu clickable" data-prof="${stu.student_id}" title="Profil ansehen">${esc(nm)}</td>${cells}</tr>`;
  }).join("");
  return `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="stu">Schüler:in</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function nmeOfSafe(s){ return String(s||"").toLowerCase(); }

/* ---------- Lehrer: Aufgaben-Statistik / Dashboard ---------- */
async function assignmentStats(assignment, classId){
  shell(`<div class="center-load"><span class="spin"></span>Statistik…</div>`);
  let roster=[], subs=[];
  try{ roster = await api.classRoster(classId); subs = await api.classSubmissions([assignment.id]); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const goal = assignment.goal;
  const byStu = new Map();   // student_id -> Abgaben (neueste zuerst, wie classSubmissions liefert)
  for(const s of subs){ if(!byStu.has(s.student_id)) byStu.set(s.student_id, []); byStu.get(s.student_id).push(s); }
  const nameOf = sid=>{ const r=roster.find(x=>x.student_id===sid); return (r&&r.profiles&&(r.profiles.display_name||r.profiles.username))||"?"; };
  const N = roster.length;
  let bearbeitet=0, bestanden=0, totalAtt=0; const dist={a:0,b:0,c:0}; const perStu=[];
  for(const r of roster){
    const list = byStu.get(r.student_id)||[];
    const current = list.find(x=>x.is_current) || list[0] || null;
    const passed = current ? current.passed===true : false;
    if(list.length>0){ bearbeitet++; totalAtt+=list.length; if(passed) bestanden++; if(list.length===1)dist.a++; else if(list.length<=3)dist.b++; else dist.c++; }
    perStu.push({sid:r.student_id, name:nameOf(r.student_id), current, passed, attempts:list.length});
  }
  const offen = N - bearbeitet, nichtBestanden = bearbeitet - bestanden;
  const quote = N? Math.round(bestanden/N*100) : 0;
  const avg = bearbeitet? (totalAtt/bearbeitet) : 0;
  const hasGoal = !!(goal && goal.type);
  const seg=(n,color,title)=> n>0?`<div title="${title}: ${n}" style="flex:${n};background:${color}"></div>`:"";
  const barInner = hasGoal
    ? seg(bestanden,"var(--green)","bestanden")+seg(nichtBestanden,"var(--gold)","abgegeben, nicht bestanden")+seg(offen,"var(--line2)","nicht bearbeitet")
    : seg(bearbeitet,"var(--green)","abgegeben")+seg(offen,"var(--line2)","nicht bearbeitet");
  const barLegend = hasGoal
    ? `🟩 bestanden ${bestanden} · 🟨 nicht bestanden ${nichtBestanden} · ⬜ offen ${offen}`
    : `🟩 abgegeben ${bearbeitet} · ⬜ offen ${offen} · <span style="font-style:italic">kein Auto-Check für diese Aufgabe</span>`;
  const statBest = hasGoal ? `<div class="card"><div class="meta">✅ Bestanden</div><div style="font-weight:900;font-size:20px;margin-top:2px">${bestanden} / ${N} <span class="muted" style="font-size:13px">(${quote} %)</span></div></div>` : "";
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>📊 ${esc(assignment.title)}</h2></div>
    <div class="card" style="margin-bottom:14px;padding:11px 16px"><span class="muted" style="font-size:13px">🎯 Ziel: ${esc(goalLabel(goal))} · ${N} Schüler:in${N!==1?"nen":""}</span></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(175px,1fr));margin-bottom:14px">
      ${statBest}
      <div class="card"><div class="meta">📝 Bearbeitet</div><div style="font-weight:900;font-size:20px;margin-top:2px">${bearbeitet} / ${N}</div></div>
      <div class="card"><div class="meta">🔁 Ø Versuche</div><div style="font-weight:900;font-size:20px;margin-top:2px">${bearbeitet? avg.toFixed(1):"–"}</div></div>
      <div class="card"><div class="meta">📊 Versuche</div><div style="font-weight:800;margin-top:6px;font-size:13px">1×: ${dist.a} · 2–3×: ${dist.b} · 4+×: ${dist.c}</div></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;height:22px;border-radius:8px;overflow:hidden;box-shadow:0 0 0 1px var(--line) inset">${barInner}</div>
      <div class="muted" style="font-size:12px;margin-top:7px">${barLegend}</div>
    </div>
    <div class="page-head" style="margin:0 0 8px"><h3 style="margin:0">🔎 Häufigste Fehler</h3><div class="spacer"></div>
      <span class="acts"><button class="abtn on" id="stCur" title="jede letzte Abgabe – wo steht die Klasse jetzt">Aktueller Stand</button><button class="abtn" id="stAll" title="alle Abgaben – häufigste Stolpersteine insgesamt">Alle Versuche</button></span></div>
    <div class="card" style="margin-bottom:10px;padding:9px 14px"><span class="muted" style="font-size:12.5px">Die Engine spielt die Abgaben hier noch einmal durch und gruppiert, woran es scheitert. Klick auf einen Namen öffnet die Live-Korrektur.</span></div>
    <div id="statsErrors"></div>`;
  document.getElementById("back").onclick = ()=> teacherClassView(classId);
  let mode="current", runSeq=0;
  const renderErrors = async ()=>{
    const host=document.getElementById("statsErrors"); if(!host) return;
    const my=++runSeq;
    host.innerHTML=`<div class="center-load"><span class="spin"></span>analysiere Abgaben…</div>`;
    let items=[];
    if(mode==="current"){ for(const p of perStu){ if(p.current && p.passed!==true) items.push({sid:p.sid, sub:p.current}); } }
    else { for(const r of roster){ for(const s of (byStu.get(r.student_id)||[])) items.push({sid:r.student_id, sub:s}); } }
    const buckets=new Map();
    for(let i=0;i<items.length;i++){
      const it=items[i];
      const c=classifySubmission(it.sub.code, assignment.territory, goal);
      const cat=errorCategory(c);
      if(cat){
        if(!buckets.has(cat.key)) buckets.set(cat.key,{cat,count:0,students:new Map(),lines:new Map()});
        const b=buckets.get(cat.key); b.count++;
        if(!b.students.has(it.sid)) b.students.set(it.sid,nameOf(it.sid));
        if(c.line) b.lines.set(c.line,(b.lines.get(c.line)||0)+1);
      }
      if(i%6===5){ await new Promise(r=>setTimeout(r,0)); if(my!==runSeq) return; }
    }
    if(my!==runSeq) return;   // ein neuerer Lauf hat begonnen (Modus gewechselt)
    const sorted=[...buckets.values()].sort((a,b)=>b.count-a.count);
    if(!items.length){ host.innerHTML=`<div class="empty" style="padding:20px"><span class="ic">📭</span>${mode==="current"?"Alle bearbeiteten Abgaben sind bestanden – keine offenen Fehler. 🎉":"Noch keine Abgaben."}</div>`; return; }
    if(!sorted.length){ host.innerHTML=`<div class="empty" style="padding:20px"><span class="ic">🎉</span>Keine Fehler – alle analysierten Abgaben laufen ${goal&&goal.type?"und erreichen das Ziel":"fehlerfrei"}.</div>`; return; }
    host.innerHTML=`<div class="list">${sorted.map(b=>{
      const names=[...b.students.entries()];
      const topLine=[...b.lines.entries()].sort((x,y)=>y[1]-x[1])[0];
      const lineHint = topLine && topLine[1]>=2 ? ` <span class="badge gold">oft in Zeile ${topLine[0]}</span>` : "";
      return `<div class="row" style="align-items:flex-start"><span class="grow">
        <span class="t">${b.cat.icon} ${esc(b.cat.label)} <span class="badge gray">${b.count}×</span>${lineHint}</span>
        <span class="s" style="margin-top:5px;display:block">${names.map(([sid,nm])=>`<button class="btn btn-sm btn-ghost stOpen" data-sid="${sid}" style="margin:2px 5px 2px 0">${esc(nm)}</button>`).join("")}</span>
      </span></div>`;
    }).join("")}</div>`;
    host.querySelectorAll(".stOpen").forEach(btn=> btn.onclick=()=>{ const sid=btn.dataset.sid; const hist=byStu.get(sid)||[]; if(hist.length) reviewSubmission(assignment, hist, nameOf(sid), classId); });
  };
  document.getElementById("stCur").onclick=()=>{ if(mode==="current")return; mode="current"; document.getElementById("stCur").classList.add("on"); document.getElementById("stAll").classList.remove("on"); renderErrors(); };
  document.getElementById("stAll").onclick=()=>{ if(mode==="all")return; mode="all"; document.getElementById("stAll").classList.add("on"); document.getElementById("stCur").classList.remove("on"); renderErrors(); };
  renderErrors();
}

/* ---------- Lehrer: Schüler-Profil (Überblick, Aufgaben, Notizen) ---------- */
async function studentProfilePage(classId, studentId, studentName, username){
  shell(`<div class="center-load"><span class="spin"></span>Profil…</div>`);
  let assignments=[], subs=[], overview=null, note=null;
  try{
    assignments = await api.listAssignments(classId);
    subs = (await api.classSubmissions(assignments.map(a=>a.id))).filter(s=> s.student_id===studentId);
    try{ overview = await api.studentOverview(studentId); }catch(e){ overview=null; }
    try{ note = await api.getStudentNote(classId, studentId); }catch(e){ note=null; }
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const lastSub = overview && overview.last_submission ? new Date(overview.last_submission) : null;
  const lastSbx = overview && overview.last_sandbox ? new Date(overview.last_sandbox) : null;
  let activity="—";
  if(lastSbx && (!lastSub || lastSbx>lastSub)) activity = "🧪 Sandbox gespeichert · "+fmtDateTime(overview.last_sandbox);
  else if(lastSub) activity = "📤 Aufgabe abgegeben · "+fmtDateTime(overview.last_submission);
  const lastLogin = (overview && overview.last_login) ? fmtDateTime(overview.last_login) : "—";
  const doneCount = assignments.filter(a=> subs.some(s=>s.assignment_id===a.id)).length;
  const passCount = assignments.filter(a=>{ const mine=subs.filter(s=>s.assignment_id===a.id); const cur=mine.find(z=>z.is_current)||mine[0]; return cur&&cur.passed===true; }).length;
  const aRows = assignments.length ? assignments.map(a=>{
    const mine=subs.filter(s=>s.assignment_id===a.id); const cur=mine.find(z=>z.is_current)||mine[0];
    const badge = !cur ? `<span class="badge gray">offen</span>` : (cur.passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`);
    const cnt = mine.length>1?` <span class="muted" style="font-size:12px">(${mine.length} Abgaben)</span>`:"";
    const open = mine.length?`<button class="btn btn-sm btn-ghost" data-aopen="${a.id}">ansehen</button>`:"";
    return `<div class="row"><span class="grow"><span class="t">${esc(a.title)}${cnt}</span><span class="s">${a.goal?`🎯 ${esc(goalLabel(a.goal))}`:"kein Auto-Check"}</span></span>${badge}${open}</div>`;
  }).join("") : `<div class="muted" style="font-size:13px">Keine Aufgaben.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2><span class="chip" style="font-size:16px"><span class="av">${esc(initials(studentName))}</span>${esc(studentName)}</span></h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-bottom:14px">
      <div class="card"><div class="meta">🪪 Benutzername</div><div style="font-weight:900;margin-top:4px"><code>${esc(username||"—")}</code></div></div>
      <div class="card"><div class="meta">🕐 Zuletzt eingeloggt</div><div style="font-weight:900;margin-top:4px">${esc(lastLogin)}</div></div>
      <div class="card"><div class="meta">⚡ Letzte Aktivität</div><div style="font-weight:900;margin-top:4px">${esc(activity)}</div></div>
      <div class="card"><div class="meta">✅ Fortschritt</div><div style="font-weight:900;margin-top:4px">${passCount} bestanden · ${doneCount}/${assignments.length} bearbeitet</div></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px">📋 Aufgaben</h3>
      <div class="list">${aRows}</div></div>
    <div class="card">
      <h3 style="margin:0 0 8px">📝 Notizen zu ${esc(studentName)} <span class="muted" style="font-weight:600;font-size:12px">(privat – nur Lehrkräfte)</span></h3>
      <textarea class="input" id="snNote" style="min-height:90px" placeholder="Notizen zu ${esc(studentName)}…">${esc(note?note.body:"")}</textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px"><button class="btn btn-primary" id="snSave">Notiz speichern</button><span id="snMsg" class="muted" style="font-size:13px">${note&&note.updated_at?("zuletzt: "+esc(fmtDateTime(note.updated_at))):""}</span></div>
    </div>`;
  document.getElementById("back").onclick = ()=> teacherClassView(classId);
  document.querySelectorAll("[data-aopen]").forEach(b=> b.onclick=()=>{ const a=assignments.find(x=>x.id===b.dataset.aopen); const hist=subs.filter(s=>s.assignment_id===a.id); if(a&&hist.length) reviewSubmission(a, hist, studentName, classId); });
  document.getElementById("snSave").onclick=async()=>{ const body=document.getElementById("snNote").value; const btn=document.getElementById("snSave"); btn.disabled=true; btn.textContent="Speichere…"; try{ await api.saveStudentNote(classId, studentId, body); document.getElementById("snMsg").textContent="gespeichert ✓"; toast("Notiz gespeichert ✓","ok"); }catch(e){ toast(e.message||"Fehler","err"); } finally{ btn.disabled=false; btn.textContent="Notiz speichern"; } };
}
/* ---------- Lehrer: Schüler:innen per Liste importieren (Accounts + Passwörter) ---------- */
function parseStudents(text){
  // Pro Zeile: Vorname, Nachname [, Benutzername [, Passwort]]  (Komma oder Tab).
  return String(text||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{
    const hasDelim = line.indexOf(",")>=0 || /\t/.test(line);
    const parts = (hasDelim ? line.split(/[,\t]/) : line.split(/\s{2,}|\s/)).map(p=>p.trim());
    const first=parts[0]||"";
    const last     = hasDelim ? (parts[1]||"") : parts.slice(1).join(" ");
    const username = hasDelim ? (parts[2]||"") : "";
    const password = hasDelim ? (parts[3]||"") : "";
    return { first, last, name:(first+" "+last).trim(), username, password };
  }).filter(x=>x.first);
}
function slugUser(first,last){
  const m={'ä':'ae','ö':'oe','ü':'ue','ß':'ss','é':'e','è':'e','ê':'e','á':'a','à':'a','â':'a','ï':'i','î':'i','ô':'o','û':'u','ç':'c','ñ':'n'};
  const clean=s=>String(s||"").toLowerCase().replace(/[äöüßéèêáàâïîôûçñ]/g,c=>m[c]||"").replace(/[^a-z0-9]+/g,"");
  let u=clean(first); const l=clean(last); if(l) u+="."+l; u=u.replace(/^\.+|\.+$/g,"");
  if(u.length<3) u=(u+"abc").slice(0,3);
  return u.slice(0,18);
}
function genPass(){ const a="abcdefghijkmnpqrstuvwxyz23456789"; let s=""; const r=new Uint32Array(7); window.crypto.getRandomValues(r); for(let i=0;i<7;i++) s+=a[r[i]%a.length]; return s; }
function importStudentsDialog(classId, classCode, onDone){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>📥 Schüler:innen importieren</h3>
    <div class="field" style="border-bottom:1px solid var(--line2);padding-bottom:14px;margin-bottom:14px">
      <label>Vorhandene:n Schüler:in hinzufügen</label>
      <div style="display:flex;gap:8px"><input class="input" id="impExisting" placeholder="Benutzername" autocapitalize="none" spellcheck="false" style="flex:1;font-family:monospace"><button class="btn btn-primary" id="impAddExisting" style="flex:none">Hinzufügen</button></div>
      <div class="muted" style="font-size:12px;margin-top:6px">Fügt eine:n bereits registrierte:n Schüler:in per Benutzername zu dieser Klasse hinzu.</div>
    </div>
    <p class="muted" style="margin:2px 0 12px"><b>Oder neu anlegen:</b> Eine Person pro Zeile (Komma oder Tab, z. B. aus Excel):<br><b>Vorname, Nachname</b> – optional zusätzlich <b>Benutzername</b> und <b>Passwort</b>. Leer gelassene Felder werden automatisch erzeugt. Kein E-Mail-Versand.</p>
    <div class="field"><textarea class="input" id="impText" style="min-height:150px;font-family:monospace;font-size:13px" placeholder="Max, Mustermann&#10;Erika, Musterfrau, erika.m&#10;Tom, Klein, tom.k, geheim123"></textarea></div>
    <div id="impMsg" class="auth-msg" style="display:none"></div>
    <div style="display:flex;gap:10px"><button class="btn btn-ghost" id="impCancel" style="flex:none">Abbrechen</button><button class="btn btn-primary" id="impParse" style="flex:1">Weiter</button></div>
    <div id="impStage" style="margin-top:14px"></div>`, true);
  document.getElementById("impCancel").onclick = closeModal;
  { const be=document.getElementById("impAddExisting"); if(be) be.onclick=async()=>{ const inp=document.getElementById("impExisting"); const u=(inp.value||"").trim(); if(!u){ inp.focus(); return; } be.disabled=true; be.textContent="…"; try{ const nm=await api.enrollExistingStudent(classId, u); toast((nm||u)+" hinzugefügt ✓","ok"); inp.value=""; if(onDone) onDone(); }catch(e){ toast(e.message||"Fehler","err"); } finally{ be.disabled=false; be.textContent="Hinzufügen"; } }; }
  { const ie=document.getElementById("impExisting"); if(ie) ie.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); document.getElementById("impAddExisting").click(); } }); }
  document.getElementById("impText").focus();
  document.getElementById("impParse").onclick = ()=>{
    const list = parseStudents(document.getElementById("impText").value);
    const msg=document.getElementById("impMsg");
    if(!list.length){ msg.style.display="block"; msg.className="auth-msg err"; msg.textContent="Keine gültigen Zeilen erkannt."; return; }
    msg.style.display="none";
    document.getElementById("impStage").innerHTML = `
      <div class="card" style="margin-bottom:10px"><b>${list.length} Schüler:in${list.length>1?"nen":""} erkannt:</b><div class="muted" style="margin-top:4px;font-size:13px">${list.map(l=>esc(l.name)).join(" · ")}</div></div>
      <button class="btn btn-primary btn-lg" id="impCreate">${list.length} Account${list.length>1?"s":""} jetzt erstellen</button>`;
    document.getElementById("impCreate").onclick = ()=> doImport(list, classCode, classId, onDone);
  };
}
async function doImport(list, classCode, classId, onDone){
  const stage=document.getElementById("impStage");
  stage.innerHTML = `<div class="card" id="impProg">⏳ Erstelle Accounts… <b id="impCount">0</b> / ${list.length}</div>`;
  const imp = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });
  const used=new Set(), results=[];
  const setCount=n=>{ const c=document.getElementById("impCount"); if(c) c.textContent=String(n); };
  for(let i=0;i<list.length;i++){
    const stu=list[i];
    const provided=(stu.username||"").toLowerCase().replace(/[^a-z0-9_.\-]/g,"");
    let base=(provided.length>=3)?provided.slice(0,18):slugUser(stu.first,stu.last); let uname=base, k=1;
    while(used.has(uname)) uname=base+(++k);
    const pass=(stu.password && stu.password.length>=6)?stu.password:genPass(); let res=null, ok=false, lastErr="";
    for(let attempt=0; attempt<6 && !ok; attempt++){
      res = await imp.auth.signUp({ email:userEmail(uname), password:pass });
      if(!res.error){ ok=true; break; }
      lastErr=res.error.message;
      if(/already|exists|registered/i.test(lastErr)){ uname=base+(++k); continue; }
      break;
    }
    if(!ok){ results.push({name:stu.name, username:uname, password:"", status:"✗ "+lastErr}); setCount(i+1); continue; }
    const uid=res.data.user.id;
    const pe = await imp.from("profiles").insert({ id:uid, username:uname, role:"student", display_name:stu.name });
    if(pe.error){ results.push({name:stu.name, username:uname, password:pass, status:"✗ Profil: "+pe.error.message}); try{await imp.auth.signOut();}catch(e){} setCount(i+1); continue; }
    try{ await imp.auth.signOut(); }catch(e){}
    const je = await sb.rpc("teacher_enroll_student", { p_class:classId, p_student:uid });   // Lehrer (sb) trägt via definer-RPC ein; prüft is_class_teacher (kein offenes memberships-Insert mehr)
    used.add(uname);
    results.push({ name:stu.name, username:uname, password:pass, status: je.error? "⚠ Konto ok, Klasse: "+je.error.message : "✓" });
    setCount(i+1);
    await new Promise(r=>setTimeout(r,180));
  }
  renderImportResults(stage, results, onDone);
}
function renderImportResults(stage, results, onDone){
  const okN=results.filter(r=>r.status==="✓").length;
  const rows=results.map(r=>`<tr><td class="stu">${esc(r.name)}</td><td><code>${esc(r.username)}</code></td><td><code>${esc(r.password||"–")}</code></td><td>${esc(r.status)}</td></tr>`).join("");
  stage.innerHTML = `
    <div class="card" style="background:#eefdf3;border-color:#bfe7cd"><b>${okN} von ${results.length} Account${results.length>1?"s":""} angelegt.</b> Gib die Zugangsdaten weiter – Schüler:innen können ihr Passwort später unter „🔑 Passwort" selbst ändern.</div>
    <div style="overflow:auto;max-height:40vh;margin-top:10px"><table class="matrix" style="width:100%"><thead><tr><th class="stu">Name</th><th>Benutzername</th><th>Passwort</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-ghost" id="impCopy" style="flex:1">📋 Liste kopieren</button><button class="btn btn-primary" id="impDone" style="flex:1">Fertig</button></div>`;
  document.getElementById("impCopy").onclick=()=>{ const txt="Name\tBenutzername\tPasswort\n"+results.filter(r=>r.password).map(r=>r.name+"\t"+r.username+"\t"+r.password).join("\n"); if(navigator.clipboard) navigator.clipboard.writeText(txt); toast("Liste kopiert","ok"); };
  document.getElementById("impDone").onclick=()=>{ closeModal(); if(onDone) onDone(); };
}
/* ---------- Admin: Nutzer:innen importieren (ohne Klasse, Duplikate überspringen) ---------- */
function adminImportDialog(){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>📥 Nutzer:innen importieren</h3>
    <p class="muted" style="margin:2px 0 12px">Eine Person pro Zeile (Komma oder Tab, z. B. aus Excel):<br><b>Vorname, Nachname</b> – optional zusätzlich <b>Benutzername</b> und <b>Passwort</b>. Leere Felder werden automatisch erzeugt. Die Accounts sind <b>keiner Klasse</b> zugeordnet. Bereits vorhandene Benutzernamen werden übersprungen. Kein E-Mail-Versand.</p>
    <div class="field"><label>Rolle</label><select class="input" id="impRole"><option value="student">Schüler:innen</option><option value="teacher">Lehrkräfte</option></select></div>
    <div class="field"><textarea class="input" id="impText" style="min-height:150px;font-family:monospace;font-size:13px" placeholder="Max, Mustermann&#10;Erika, Musterfrau, erika.m&#10;Tom, Klein, tom.k, geheim123"></textarea></div>
    <div id="impMsg" class="auth-msg" style="display:none"></div>
    <div style="display:flex;gap:10px"><button class="btn btn-ghost" id="impCancel" style="flex:none">Abbrechen</button><button class="btn btn-primary" id="impParse" style="flex:1">Weiter</button></div>
    <div id="impStage" style="margin-top:14px"></div>`, true);
  document.getElementById("impCancel").onclick = closeModal;
  document.getElementById("impText").focus();
  document.getElementById("impParse").onclick = ()=>{
    const list = parseStudents(document.getElementById("impText").value);
    const role = document.getElementById("impRole").value==="teacher"?"teacher":"student";
    const msg=document.getElementById("impMsg");
    if(!list.length){ msg.style.display="block"; msg.className="auth-msg err"; msg.textContent="Keine gültigen Zeilen erkannt."; return; }
    msg.style.display="none";
    const rl = role==="teacher"?"Lehrkräfte":"Schüler:innen";
    document.getElementById("impStage").innerHTML = `
      <div class="card" style="margin-bottom:10px"><b>${list.length} ${rl} erkannt:</b><div class="muted" style="margin-top:4px;font-size:13px">${list.map(l=>esc(l.name)).join(" · ")}</div></div>
      <button class="btn btn-primary btn-lg" id="impCreate">${list.length} Account${list.length>1?"s":""} jetzt erstellen</button>`;
    document.getElementById("impCreate").onclick = ()=> doAdminImport(list, role);
  };
}
async function doAdminImport(list, role){
  const stage=document.getElementById("impStage");
  stage.innerHTML = `<div class="card" id="impProg">⏳ Erstelle Accounts… <b id="impCount">0</b> / ${list.length}</div>`;
  let existing=new Set();
  try{ const { data } = await sb.from("profiles").select("username"); (data||[]).forEach(p=> existing.add((p.username||"").toLowerCase())); }catch(e){}
  const imp = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });
  const used=new Set(), results=[];
  const setCount=n=>{ const c=document.getElementById("impCount"); if(c) c.textContent=String(n); };
  for(let i=0;i<list.length;i++){
    const stu=list[i];
    const provided=(stu.username||"").toLowerCase().replace(/[^a-z0-9_.\-]/g,"");
    let base=(provided.length>=3)?provided.slice(0,18):slugUser(stu.first,stu.last); let uname=base, k=1;
    if(provided.length>=3){
      if(existing.has(uname)||used.has(uname)){ results.push({name:stu.name, username:uname, password:"", status:"übersprungen (existiert)"}); setCount(i+1); continue; }
    } else { while(existing.has(uname)||used.has(uname)) uname=base+(++k); }
    const pass=(stu.password && stu.password.length>=6)?stu.password:genPass();
    let res=null, ok=false, lastErr="";
    for(let attempt=0; attempt<6 && !ok; attempt++){
      res = await imp.auth.signUp({ email:userEmail(uname), password:pass });
      if(!res.error){ ok=true; break; }
      lastErr=res.error.message;
      if(/already|exists|registered/i.test(lastErr)){ if(provided.length>=3){ lastErr="existiert"; break; } uname=base+(++k); continue; }
      break;
    }
    if(!ok){ const skipped=/existiert/i.test(lastErr); results.push({name:stu.name, username:uname, password:"", status: skipped?"übersprungen (existiert)":("✗ "+lastErr)}); setCount(i+1); continue; }
    const uid=res.data.user.id;
    const pe = await imp.from("profiles").insert({ id:uid, username:uname, role:"student", display_name:stu.name });
    if(pe.error){ results.push({name:stu.name, username:uname, password:pass, status:"✗ Profil: "+pe.error.message}); try{await imp.auth.signOut();}catch(e){} setCount(i+1); continue; }
    try{ await imp.auth.signOut(); }catch(e){}
    let status="✓";
    if(role==="teacher"){ try{ await api.adminSetRole(uid, "teacher"); }catch(e){ status="⚠ Konto ok, Rolle: "+(e.message||"Fehler"); } }
    used.add(uname); existing.add(uname);
    results.push({ name:stu.name, username:uname, password:pass, status });
    setCount(i+1);
    await new Promise(r=>setTimeout(r,180));
  }
  renderImportResults(stage, results, ()=> adminHome());
}
function renameClassDialog(classId, current, tool){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Klasse umbenennen</h3>
    <div class="field"><label>Klassenname</label><input class="input" id="rnName" maxlength="60"></div>
    <button class="btn btn-primary btn-lg" id="rnSave">Speichern</button>`);
  const inp=document.getElementById("rnName"); inp.value=current; inp.focus(); inp.select();
  const go=async()=>{ const name=inp.value.trim(); if(!name){inp.focus();return;}
    const btn=document.getElementById("rnSave"); btn.disabled=true; btn.textContent="Speichere…";
    const { error } = await sb.from("classes").update({ name }).eq("id", classId);
    if(error){ btn.disabled=false; btn.textContent="Speichern"; toast(error.message||"Fehler","err"); return; }
    closeModal(); toast("Umbenannt ✓","ok"); classViewFor(tool||ACTIVE_TOOL)(classId); };
  document.getElementById("rnSave").onclick=go;
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}

/* ---------- Admin: Lehrkräfte einer Klasse zuweisen ---------- */
async function classTeachersDialog(classId, cls){
  const canTransfer = (cls.teacher_id===ME.id || ME.is_admin);
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>👩‍🏫 Lehrkräfte – ${esc(cls.name)}</h3>
    <p class="muted" style="margin:2px 0 12px">Mehrere Lehrkräfte können dieselbe Klasse betreuen. Die Ersteller-Lehrkraft bleibt immer dabei.</p>
    <div id="ctList" class="list" style="margin-bottom:12px"><div class="center-load"><span class="spin"></span></div></div>
    <div class="field"><label>Lehrkraft hinzufügen</label>
      <div style="display:flex;gap:8px"><select class="input" id="ctSelect" style="flex:1"><option value="">– wählen –</option></select>
      <button class="btn btn-primary" id="ctAdd" style="flex:none">Hinzufügen</button></div></div>
    ${canTransfer?`<div class="field" style="border-top:1px solid var(--line2);padding-top:14px;margin-top:2px"><label>⚠️ Klasse übergeben</label>
      <p class="muted" style="font-size:12px;margin:0 0 8px">Die gewählte Lehrkraft wird neue:r Eigentümer:in (volle Rechte) – du wirst zur Co-Lehrkraft.</p>
      <div style="display:flex;gap:8px"><select class="input" id="ctTransferSel" style="flex:1"><option value="">– wählen –</option></select>
      <button class="btn btn-ghost" id="ctTransfer" style="flex:none;color:#e63a3a">Übergeben</button></div></div>`:""}`);
  async function refresh(){
    let named=[], assignable=[];
    try{ named=await api.classTeachersNamed(classId); assignable=await api.assignableTeachers(); }
    catch(e){ toast(e.message||"Fehler","err"); }
    const owner=named.find(t=>t.is_owner), cos=named.filter(t=>!t.is_owner);
    const assignedIds=new Set(named.map(t=>t.id));
    const ownerRow=`<div class="row"><span class="grow"><span class="t">${esc(owner?(owner.display_name||owner.username):"–")}</span><span class="s">Ersteller:in</span></span><span class="badge blue">Eigentümer</span></div>`;
    const coRows=cos.map(c=>`<div class="row"><span class="grow"><span class="t">${esc(c.display_name||c.username)}</span><span class="s">Co-Lehrkraft</span></span><button class="btn btn-sm btn-ghost" data-rmteacher="${c.id}" title="entfernen">🗑️</button></div>`).join("");
    const lst=document.getElementById("ctList"); if(lst) lst.innerHTML=ownerRow+coRows;
    const sel=document.getElementById("ctSelect");
    if(sel){ const avail=assignable.filter(t=> !assignedIds.has(t.id)); sel.innerHTML='<option value="">– wählen –</option>'+avail.map(t=>`<option value="${t.id}">${esc(t.display_name||t.username)}</option>`).join(""); }
    const tsel=document.getElementById("ctTransferSel");
    if(tsel){ const ownerId=owner?owner.id:null; const avail2=assignable.filter(t=> t.id!==ownerId); tsel.innerHTML='<option value="">– wählen –</option>'+avail2.map(t=>`<option value="${t.id}">${esc(t.display_name||t.username)}</option>`).join(""); }
    document.querySelectorAll("[data-rmteacher]").forEach(b=> b.onclick=async()=>{ try{ await api.removeClassTeacher(classId, b.dataset.rmteacher); toast("Entfernt","ok"); refresh(); }catch(e){ toast(e.message||"Fehler","err"); } });
  }
  document.getElementById("ctAdd").onclick=async()=>{ const sel=document.getElementById("ctSelect"); if(!sel.value) return; try{ await api.addClassTeacher(classId, sel.value); toast("Hinzugefügt ✓","ok"); refresh(); }catch(e){ toast(e.message||"Fehler","err"); } };
  { const tb=document.getElementById("ctTransfer"); if(tb) tb.onclick=async()=>{ const sel=document.getElementById("ctTransferSel"); if(!sel.value) return; const nm=(sel.options[sel.selectedIndex]||{}).text||"diese Lehrkraft"; if(!confirm(`Klasse „${cls.name}" wirklich an ${nm} übergeben? ${nm} wird Eigentümer:in mit allen Rechten, du wirst Co-Lehrkraft.`)) return; try{ await api.transferClass(classId, sel.value); closeModal(); toast("Klasse übergeben ✓","ok"); classViewFor((cls&&cls.tool)||ACTIVE_TOOL)(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  refresh();
}

/* ============================================================================
   SCHÜLER-ANSICHT
   ============================================================================ */
async function studentHome(){
  shell(`<div class="center-load"><span class="spin"></span>Wird geladen…</div>`);
  _classActivity=null;   // bei jedem Übersichts-Aufruf frisch laden (Aktivitäts-Sortierung)
  let classes=[];
  try{ classes = await api.myClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }

  if(!classes.length){
    document.getElementById("view").innerHTML = `
      <div class="page-head"><h2>Willkommen, ${esc(ME.display_name||ME.username)}! ${HAMSTER}</h2><div class="spacer"></div><button class="btn btn-ghost" id="btnSandbox">🧪 Sandbox</button></div>
      <div class="card" style="max-width:480px;margin:0 auto;text-align:center">
        <div style="font-size:46px">🔑</div>
        <h3 style="margin:6px 0">Tritt deiner Klasse bei</h3>
        <p class="muted" style="margin:0 0 16px">Gib den Code ein, den du von deiner Lehrkraft bekommen hast.</p>
        <div class="field"><input class="input" id="joinCode" placeholder="z. B. K7Q2MX" maxlength="8" style="text-align:center;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-size:22px"></div>
        <button class="btn btn-primary btn-lg" id="btnJoin">Beitreten</button>
      </div>`;
    wireJoin();
    { const sx=document.getElementById("btnSandbox"); if(sx) sx.onclick=()=> sandboxHome(null); }
    return;
  }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnSandbox">🧪 Sandbox</button>
      <button class="btn btn-ghost" id="btnJoinMore" style="margin-left:8px">+ Klasse beitreten</button></div>
    ${classes.length>1?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnSandbox").onclick = ()=> sandboxHome(null);
  document.getElementById("btnJoinMore").onclick = joinDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Aufgaben ansehen →</div></div>`, id=> studentClassView(id), "");
}
function wireJoin(){
  const inp=document.getElementById("joinCode"); inp.focus();
  const go=async()=>{ const code=inp.value.trim().toUpperCase(); if(!code){ inp.focus(); return; }
    const btn=document.getElementById("btnJoin"); btn.disabled=true; btn.textContent="Trete bei…";
    try{ const c=await api.joinClass(code); if(c&&c.tool) ACTIVE_TOOL=c.tool; toast('Du bist jetzt in "'+(c?c.name:"")+'" 🎉',"ok"); route(); }
    catch(e){ btn.disabled=false; btn.textContent="Beitreten"; toast(/nicht gefunden/i.test(e.message)?"Klassencode nicht gefunden.":(e.message||"Fehler"),"err"); } };
  document.getElementById("btnJoin").onclick=go;
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}
function joinDialog(){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Klasse beitreten</h3><p class="muted" style="margin:2px 0 16px">Gib den Klassencode deiner Lehrkraft ein.</p>
    <div class="field"><input class="input" id="joinCode" placeholder="K7Q2MX" maxlength="8" style="text-align:center;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-size:22px"></div>
    <button class="btn btn-primary btn-lg" id="btnJoin">Beitreten</button>`);
  const inp=document.getElementById("joinCode"); inp.focus();
  const go=async()=>{ const code=inp.value.trim().toUpperCase(); if(!code) return;
    try{ const c=await api.joinClass(code); if(c&&c.tool) ACTIVE_TOOL=c.tool; closeModal(); toast('Beigetreten: "'+(c?c.name:"")+'"',"ok"); route(); }
    catch(e){ toast(/nicht gefunden/i.test(e.message)?"Klassencode nicht gefunden.":(e.message||"Fehler"),"err"); } };
  document.getElementById("btnJoin").onclick=go;
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}
async function studentClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let cls, assignments=[], mySubs=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data;
    assignments = await api.listAssignments(classId);
    if(assignments.length){ const { data:s } = await sb.from("submissions").select("*").in("assignment_id",assignments.map(a=>a.id)).eq("student_id",ME.id).eq("is_current",true); mySubs=s||[]; }
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  let myComs=[]; try{ if(mySubs.length) myComs = await api.myComments(mySubs.map(x=>x.id)); }catch(e){}   // Rückmeldungen der aktuellen Abgaben
  const list = assignments.length ? `<div class="list">${assignments.map(a=>{
      const s=mySubs.find(x=>x.assignment_id===a.id);
      const com = s ? myComs.find(c=>c.submission_id===s.id && c.released) : null;
      const badge = s ? (s.passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`) : `<span class="badge gray">offen</span>`;
      return `<div class="row clickrow" data-id="${a.id}" style="cursor:pointer">
        <span class="grow"><span class="t">${esc(a.title)}</span>${a.description?`<span class="s">${esc(a.description.slice(0,70))}</span>`:""}${com?feedbackPreviewHtml(com.body):""}</span>
        ${badge}<span style="margin-left:8px;color:#7a8aa0">→</span></div>`;
    }).join("")}</div>`
    : `<div class="empty"><span class="ic">📝</span>Noch keine Aufgaben. Schau später wieder rein!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls?cls.name:"Klasse")}${CLASS_REFRESH_BTN}</h2></div>
    ${list}`;
  document.getElementById("back").onclick = studentHome;
  wireClassRefresh(()=> studentClassView(classId));
  /* Sandbox ist jetzt klassenunabhängig und steht in der Klassenübersicht */
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=()=> solveAssignment(r.dataset.id));
}

/* ============================================================================
   SQL-PLAYGROUND – Phase 1: Klassen anlegen/beitreten (Aufgaben folgen)
   ============================================================================ */
async function sqlTeacherHome(){
  shell(`<div class="center-load"><span class="spin"></span>Klassen werden geladen…</div>`);
  _classActivity=null;
  let classes=[];
  try{ classes = await api.myTeacherClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnSqlDatabases">🗄️ Datenbanken</button>
      <button class="btn btn-ghost" id="btnSqlTemplates" style="margin-left:8px">📋 Vorlagen</button>
      <button class="btn btn-ghost" id="btnSqlSandbox" style="margin-left:8px">🧪 Sandbox</button>
      <button class="btn btn-primary" id="btnNewClass" style="margin-left:8px">+ Neue Klasse</button></div>
    ${classes.length?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnSqlDatabases").onclick = ()=> sqlDatabasesPage({label:"← SQL · Meine Klassen", go:sqlTeacherHome});
  document.getElementById("btnSqlTemplates").onclick = ()=> sqlTemplatesPage({label:"← SQL · Meine Klassen", go:sqlTeacherHome});
  document.getElementById("btnSqlSandbox").onclick = ()=> sqlSandbox();
  document.getElementById("btnNewClass").onclick = newClassDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b></div></div>`,
    id=>{ viewFromAdmin=false; sqlTeacherClassView(id); },
    `<div class="empty"><span class="ic">🗄️</span>Noch keine SQL-Klassen. Erstelle deine erste Klasse!</div>`);
}
async function sqlStudentHome(){
  shell(`<div class="center-load"><span class="spin"></span>Wird geladen…</div>`);
  _classActivity=null;
  let classes=[];
  try{ classes = await api.myClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!classes.length){
    document.getElementById("view").innerHTML = `
      <div class="page-head"><h2>🗄️ SQL-Playground</h2><div class="spacer"></div><button class="btn btn-ghost" id="btnSqlSandbox">🧪 Sandbox</button></div>
      <div class="card" style="max-width:480px;margin:0 auto;text-align:center">
        <div style="font-size:46px">🔑</div>
        <h3 style="margin:6px 0">Tritt deiner Klasse bei</h3>
        <p class="muted" style="margin:0 0 16px">Gib den Code ein, den du von deiner Lehrkraft bekommen hast.</p>
        <div class="field"><input class="input" id="joinCode" placeholder="z. B. K7Q2MX" maxlength="8" style="text-align:center;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-size:22px"></div>
        <button class="btn btn-primary btn-lg" id="btnJoin">Beitreten</button>
      </div>`;
    wireJoin(); { const sx=document.getElementById("btnSqlSandbox"); if(sx) sx.onclick=()=> sqlSandbox(); } return;
  }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnSqlSandbox">🧪 Sandbox</button>
      <button class="btn btn-ghost" id="btnJoinMore" style="margin-left:8px">+ Klasse beitreten</button></div>
    ${classes.length?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnSqlSandbox").onclick = ()=> sqlSandbox();
  document.getElementById("btnJoinMore").onclick = joinDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Aufgaben ansehen →</div></div>`, id=> sqlStudentClassView(id), "");
}
const SQL_SOON = `<div class="card" style="text-align:center;padding:26px"><div style="font-size:40px">🚧</div><h3 style="margin:6px 0">SQL-Aufgaben kommen in Kürze</h3><p class="muted" style="margin:0">Datenbanken, Aufgaben mit Teilaufgaben und Abgaben folgen in den nächsten Updates. Die Klasse kann schon angelegt und der Code verteilt werden.</p></div>`;
async function sqlTeacherClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Klasse wird geladen…</div>`);
  let cls, roster=[], asgs=[], subs=[], subtaskRows=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data;
    roster = await api.classRoster(classId);
    roster.sort((a,b)=>{ const na=((a.profiles&&(a.profiles.display_name||a.profiles.username))||"").toLowerCase(), nb=((b.profiles&&(b.profiles.display_name||b.profiles.username))||"").toLowerCase(); return na.localeCompare(nb,"de"); });
    asgs = await api.sqlListAssignments(classId);
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!cls){ document.getElementById("view").innerHTML=errBox({message:"Klasse nicht gefunden."}); return; }
  // Abgabe-Matrix ist Zusatz -> eigener, nicht-fataler Block: ein Fehler hier reißt Aufgaben-/Schülerliste nicht herunter
  if(asgs.length){ const ids=asgs.map(a=>a.id); try{ subs = await api.sqlClassSubmissions(ids); subtaskRows = await api.sqlSubtaskIds(ids); }catch(e){ subs=[]; subtaskRows=[]; } }
  const canTeam=(cls.teacher_id===ME.id||ME.is_admin);
  let teachers=[]; try{ teachers=await api.classTeachersNamed(classId); }catch(e){ teachers=[]; }
  const iAmCoTeacher = !canTeam && teachers.some(t=>t.id===ME.id && !t.is_owner);
  const subtasksByAsg=new Map(); asgs.forEach(a=>subtasksByAsg.set(a.id,[])); subtaskRows.forEach(r=>{ const arr=subtasksByAsg.get(r.assignment_id); if(arr) arr.push(r.id); });
  const rosterHtml = roster.length ? `<div class="list">${roster.map(m=>{ const p=m.profiles||{}; const nm=p.display_name||p.username||"?"; return `<div class="row"><span class="chip clickable" data-prof="${m.student_id}" title="Profil ansehen" style="cursor:pointer"><span class="av">${esc(initials(nm))}</span>${esc(nm)}</span><div class="grow"></div><span class="muted" style="font-size:11.5px;margin-right:8px">${fmtDate(m.joined_at)}</span>${canTeam?`<button class="abtn" data-stu="${m.student_id}" data-nm="${esc(nm)}" title="Passwort zurücksetzen">🔑</button><button class="abtn" data-rmstu="${m.student_id}" data-nm="${esc(nm)}" title="aus Klasse entfernen">🗑️</button>`:""}</div>`; }).join("")}</div>`
    : `<div class="empty"><span class="ic">🎒</span>Noch keine Schüler:innen. Teile den Code <b>${esc(cls.code)}</b>!</div>`;
  const asgHtml = asgs.length ? `<div class="list">${asgs.map(a=>`
      <div class="row"><span class="grow"><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="t clickable" data-edit="${a.id}" title="Aufgabe bearbeiten">${esc(a.title)}</span>${a.published?"":'<span class="badge gold">Entwurf</span>'}${a.released?'<span class="badge" title="Musterlösungen für Schüler:innen sichtbar">🏆 Lösung frei</span>':''}</span><span class="s">${esc(fmtDateTime(a.created_at))}</span></span>
        <span class="acts">
          <button class="abtn" data-up="${a.id}" title="nach oben">↑</button>
          <button class="abtn" data-down="${a.id}" title="nach unten">↓</button>
          <button class="abtn" data-pub="${a.id}" data-on="${a.published?1:0}" title="${a.published?'verbergen (Entwurf)':'veröffentlichen'}">${a.published?'👁️':'🚀'}</button>
          <button class="abtn" data-rel="${a.id}" data-relon="${a.released?1:0}" title="${a.released?'Musterlösung wieder verbergen':'Musterlösung für Schüler:innen freigeben'}">${a.released?'🏆':'🔒'}</button>
          <button class="abtn" data-edit="${a.id}" title="bearbeiten">✏️</button>
          <button class="abtn" data-del="${a.id}" title="löschen">🗑️</button>
        </span></div>`).join("")}</div>`
    : `<div class="empty" style="padding:16px"><span class="ic">📝</span>Noch keine Aufgaben.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${viewFromAdmin?"← Admin-Bereich":"← Meine Klassen"}</button><div class="spacer"></div><button class="btn btn-ghost btn-sm" id="btnSqlDbs2">🗄️ Datenbanken</button><button class="btn btn-ghost btn-sm" id="btnSqlTpl2" style="margin-left:8px">📋 Vorlagen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls.name)}${canTeam?` <button class="btn btn-ghost btn-sm" id="btnRename" title="Klasse umbenennen" style="vertical-align:middle">✏️</button>`:""}${CLASS_REFRESH_BTN}</h2><div class="spacer"></div>
      <span class="codechip" title="Einlade-Code" style="${cls.join_open===false?'opacity:.55;':''}">🔑 ${esc(cls.code)}${cls.join_open===false?' <span class="badge gray" title="Beitritt mit diesem Code ist deaktiviert">aus</span>':''} <button class="btn btn-sm btn-ghost" id="copyCode" style="margin-left:4px">Kopieren</button></span>
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnCodeToggle" style="margin-left:8px" title="${cls.join_open===false?'Beitritt mit diesem Code wieder erlauben':'Beitritt mit diesem Code deaktivieren'}">${cls.join_open===false?'🔓 Aktivieren':'🚫 Code deaktivieren'}</button><button class="btn btn-ghost btn-sm" id="btnCodeNew" style="margin-left:6px" title="Neuen Code erzeugen – der alte wird ungültig">🔄 Neuer Code</button>`:''}
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnDeleteClass" style="margin-left:8px;color:var(--red-d)" title="Klasse löschen">🗑️ Löschen</button>`:(iAmCoTeacher?`<button class="btn btn-ghost btn-sm" id="btnLeaveClass" style="margin-left:8px;color:var(--red-d)" title="Klasse verlassen">🚪 Klasse verlassen</button>`:"")}</div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">📝 Aufgaben <span class="badge gray">${asgs.length}</span></h3><div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="btnSqlFromTpl">📋 aus Vorlage</button><button class="btn btn-blue btn-sm" id="btnNewSqlAssign" style="margin-left:8px">+ Aufgabe stellen</button></div>
      <div style="margin-top:12px">${asgHtml}</div></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">📊 Abgabe-Matrix</h3><div style="flex:1"></div>${(asgs.length&&roster.length)?'<button class="btn btn-ghost btn-sm" id="btnSqlMatrixMax" title="Matrix im Vollbild öffnen">⛶ Vergrößern</button>':''}</div>
      <div style="margin-top:12px">
        ${(asgs.length&&roster.length)?'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap"><span class="muted" style="font-size:12.5px">🟩 richtig · 🟧 bearbeitet · ⬜ offen · ★ = alles richtig</span><div style="flex:1"></div><input class="input" id="sqlMatrixSearch" placeholder="🔍 Schüler:in suchen" style="max-width:240px"></div>':''}
        <div id="sqlMatrixHost"></div>
      </div></div>
    <div class="card" style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">🎒 Schüler:innen <span class="badge gray">${roster.length}</span></h3><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnSqlImport">📥 Importieren</button>':''}</div><div style="margin-top:12px">${rosterHtml}</div></div>
    <div class="card" style="margin-bottom:16px"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">👩‍🏫 Lehrkräfte <span class="badge gray">${teachers.length}</span></h3><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnTeachers">+ verwalten</button>':''}</div>
      <div class="list" style="margin-top:12px">${teachers.length?teachers.map(t=>`<div class="row"><span class="chip"><span class="av">${esc(initials(t.display_name||t.username))}</span>${esc(t.display_name||t.username)}</span><div class="grow"></div>${t.is_owner?'<span class="badge blue">Ersteller:in</span>':'<span class="badge gray">Co-Lehrkraft</span>'}</div>`).join(""):'<div class="muted" style="font-size:13px">—</div>'}</div></div>`;
  document.getElementById("back").onclick = ()=> (viewFromAdmin?adminHome():sqlTeacherHome());
  document.getElementById("copyCode").onclick = ()=>{ if(navigator.clipboard) navigator.clipboard.writeText(cls.code); toast("Code kopiert: "+cls.code,"ok"); };
  { const bd=document.getElementById("btnDeleteClass"); if(bd) bd.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich löschen? Alle Aufgaben und Zuordnungen werden entfernt.`)) return; try{ await api.deleteClass(classId); toast("Klasse gelöscht","ok"); (viewFromAdmin?adminHome():sqlTeacherHome()); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const br=document.getElementById("btnRename"); if(br) br.onclick=()=> renameClassDialog(classId, cls.name, cls.tool); }
  wireClassRefresh(()=> sqlTeacherClassView(classId));
  { const bt=document.getElementById("btnCodeToggle"); if(bt) bt.onclick=async()=>{ const disabling=(cls.join_open!==false); if(disabling){ if(!confirm(`Beitritt für „${cls.name}" deaktivieren?\n\nMit dem Code ${cls.code} kann danach niemand mehr neu beitreten. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; } try{ await api.setClassJoinOpen(classId, !disabling); toast(disabling?"Beitritt deaktiviert 🚫":"Beitritt wieder aktiv 🔓","ok"); sqlTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bn=document.getElementById("btnCodeNew"); if(bn) bn.onclick=async()=>{ if(!confirm(`Neuen Einlade-Code für „${cls.name}" erzeugen?\n\nDer bisherige Code ${cls.code} wird sofort ungültig – verteile danach den neuen Code. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; try{ const nc=await api.regenerateClassCode(classId); toast("Neuer Code: "+nc,"ok"); sqlTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bl=document.getElementById("btnLeaveClass"); if(bl) bl.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich verlassen? Du bist danach keine Co-Lehrkraft mehr und siehst die Klasse nicht mehr.`)) return; try{ await api.removeClassTeacher(classId, ME.id); toast("Klasse verlassen","ok"); sqlTeacherHome(); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bt=document.getElementById("btnTeachers"); if(bt) bt.onclick=()=> classTeachersDialog(classId, cls); }
  document.getElementById("btnSqlDbs2").onclick = ()=> sqlDatabasesPage({label:"← zurück zur Klasse", go:()=> sqlTeacherClassView(classId)});
  document.getElementById("btnSqlTpl2").onclick = ()=> sqlTemplatesPage({label:"← zurück zur Klasse", go:()=> sqlTeacherClassView(classId)});
  { const bi=document.getElementById("btnSqlImport"); if(bi) bi.onclick=()=> importStudentsDialog(classId, cls.code, ()=>sqlTeacherClassView(classId)); }
  document.querySelectorAll(".chip[data-prof]").forEach(b=> b.onclick=()=>{ const m=roster.find(r=>r.student_id===b.dataset.prof); const p=(m&&m.profiles)||{}; sqlStudentProfilePage(classId, b.dataset.prof, p.display_name||p.username||"?", p.username||""); });
  document.querySelectorAll("[data-stu]").forEach(b=> b.onclick=()=> resetStudentPw(b.dataset.stu, b.dataset.nm));
  document.querySelectorAll("[data-rmstu]").forEach(b=> b.onclick=async()=>{ if(!confirm(b.dataset.nm+" aus dieser Klasse entfernen? (Der Account bleibt bestehen.)")) return; try{ await api.removeMembership(classId, b.dataset.rmstu); toast("Entfernt","ok"); sqlTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.getElementById("btnNewSqlAssign").onclick = ()=> sqlAssignmentEditorPage(classId, null);
  document.getElementById("btnSqlFromTpl").onclick = ()=> sqlPickTemplate(classId);
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=> sqlAssignmentEditorPage(classId, {id:b.dataset.edit}));
  document.querySelectorAll("[data-up]").forEach(b=> b.onclick=async()=>{ await moveSqlAssignment(asgs, b.dataset.up, -1); sqlTeacherClassView(classId); });
  document.querySelectorAll("[data-down]").forEach(b=> b.onclick=async()=>{ await moveSqlAssignment(asgs, b.dataset.down, 1); sqlTeacherClassView(classId); });
  document.querySelectorAll("[data-pub]").forEach(b=> b.onclick=async()=>{ try{ await api.sqlUpdateAssignment(b.dataset.pub,{published:b.dataset.on!=="1"}); sqlTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-rel]").forEach(b=> b.onclick=async()=>{ const on=b.dataset.relon==="1"; if(!on && !confirm("Musterlösungen dieser Aufgabe für ALLE Schüler:innen sichtbar machen?")) return; try{ await api.sqlUpdateAssignment(b.dataset.rel,{released:!on}); toast(on?"Musterlösung verborgen 🔒":"Musterlösung freigegeben 🏆","ok"); sqlTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Aufgabe wirklich löschen?")) return; try{ await api.sqlDeleteAssignment(b.dataset.del); sqlTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  const paintSqlMatrixInto=(host, q, close)=>{ if(!host) return;
    host.innerHTML = (asgs.length&&roster.length) ? buildSqlMatrix(roster, asgs, subs, subtasksByAsg, q)
      : `<div class="empty"><span class="ic">📊</span>${!asgs.length?"Stelle Aufgaben – dann erscheint hier, wer welche Teilaufgaben gelöst hat.":"Noch keine Schüler:innen in der Klasse."}</div>`;
    host.querySelectorAll(".sqcell[data-aid]").forEach(c=> c.onclick=()=>{ const stu=roster.find(r=>r.student_id===c.dataset.sid); const nm=(stu&&stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?"; if(close) close(); sqlReviewSubmission(c.dataset.aid, c.dataset.sid, nm, classId); });
  };
  paintSqlMatrixInto(document.getElementById("sqlMatrixHost"), "", null);
  { const ms=document.getElementById("sqlMatrixSearch"); if(ms) ms.oninput=()=> paintSqlMatrixInto(document.getElementById("sqlMatrixHost"), ms.value, null); }
  { const bx=document.getElementById("btnSqlMatrixMax"); if(bx) bx.onclick=()=> openMatrixModal("📊 Abgabe-Matrix – "+cls.name, (host,q,close)=> paintSqlMatrixInto(host,q,close)); }
}
function buildSqlMatrix(roster, asgs, subs, subtasksByAsg, q){
  q=(q||"").trim().toLowerCase();
  const nmeOf=stu=>(stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?";
  const list = q ? roster.filter(stu=> nmeOfSafe(nmeOf(stu)).includes(q)) : roster;
  if(!list.length) return `<div class="empty" style="padding:16px"><span class="ic">🔍</span>Keine Schüler:in gefunden.</div>`;
  const head = asgs.map(a=>`<th title="${esc(a.title)}">${esc(a.title.length>14?a.title.slice(0,13)+"…":a.title)}</th>`).join("");
  const seg=(n,color)=> n>0?`<div style="flex:${n};background:${color}"></div>`:"";
  const rows = list.map(stu=>{
    const cells = asgs.map(a=>{
      const ids = subtasksByAsg.get(a.id)||[]; const total = ids.length;
      if(!total) return `<td><span class="muted" style="font-size:13px" title="Aufgabe hat noch keine Teilaufgaben">—</span></td>`;
      const sub = subs.find(x=>x.assignment_id===a.id && x.student_id===stu.student_id);
      if(!sub) return `<td><span title="noch nicht bearbeitet (${total} Teilaufgaben)" style="color:var(--muted);font-weight:900">·</span></td>`;
      const res = sub.results||{};
      let g=0,y=0; for(const id of ids){ const st=res[id]; if(st==="correct") g++; else if(st==="wrong") y++; }   // "empty" (leer gespeichert) = offen/grau, konsistent mit sqlStatusIcon
      const grey=total-g-y, done=(g===total);
      const bar=`<div style="display:flex;height:7px;width:56px;border-radius:4px;overflow:hidden;margin:0 auto 3px;background:var(--line2)">${seg(g,"var(--green)")}${seg(y,"var(--gold)")}${seg(grey,"var(--line2)")}</div>`;
      const cap=`<span style="font-size:11.5px;font-weight:800;color:${done?'var(--green-d)':'var(--muted)'}">${g}/${total}${done?' ★':''}</span>`;
      const title=`✓ ${g} richtig · ~ ${y} bearbeitet · · ${grey} offen (von ${total})`;
      return `<td><span class="sqcell" data-aid="${a.id}" data-sid="${stu.student_id}" title="${esc(title)} – Abgabe ansehen" style="display:inline-block;min-width:60px;text-align:center;cursor:pointer">${bar}${cap}</span></td>`;
    }).join("");
    return `<tr><td class="stu">${esc(nmeOf(stu))}</td>${cells}</tr>`;
  }).join("");
  return `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="stu">Schüler:in</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
/* ---------- SQL-Playground: Aufgaben-Vorlagen ---------- */
async function sqlPickTemplate(classId){
  openModal(`<button class="x" id="tplPickX">×</button><h3 style="margin:0 0 12px">📋 Aufgabe aus Vorlage</h3><div id="tplPickHost"><div class="center-load"><span class="spin"></span>Vorlagen…</div></div>`);
  { const x=document.getElementById("tplPickX"); if(x) x.onclick=closeModal; }
  let list=[]; try{ list=await api.sqlListTemplates(); }catch(e){ const h=document.getElementById("tplPickHost"); if(h) h.innerHTML=errBox(e); return; }
  const host=document.getElementById("tplPickHost"); if(!host) return;   // Modal zwischenzeitlich geschlossen
  if(!list.length){ host.innerHTML=`<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Öffne eine Aufgabe und wähle „⭐ Als Vorlage", um eine anzulegen.</div>`; return; }
  host.innerHTML=`<div class="muted" style="font-size:12.5px;margin-bottom:8px">Wähle eine Vorlage – sie wird als neue Aufgabe in dieser Klasse geöffnet (du kannst sie vor dem Speichern anpassen).</div>
    <div class="list">${list.map(t=>`
      <div class="row clickrow" data-tpl="${t.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${t.subtask_count} Teilaufgabe(n) · von ${esc(t.owner_name)}${t.mine?" (du)":""}${t.shared?" · 🌍 geteilt":""}</span></span><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`;
  host.querySelectorAll(".clickrow[data-tpl]").forEach(r=> r.onclick=async()=>{ try{ const tpl=await api.sqlGetTemplate(r.dataset.tpl); closeModal(); sqlAssignmentEditorPage(classId, null, tpl); }catch(e){ toast(e.message||"Fehler","err"); } });
}
async function sqlTemplatesPage(back){
  const b = subBack(sqlTemplatesPage, back) || {label:"← SQL · Meine Klassen", go:sqlTeacherHome};
  shell(`<div class="center-load"><span class="spin"></span>Vorlagen…</div>`);
  let list=[]; try{ list=await api.sqlListTemplates(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const rows = list.length ? `<div class="list">${list.map(t=>`
      <div class="row"><span class="grow"><span class="t${(t.mine||ME.is_admin)?" clickable":""}"${(t.mine||ME.is_admin)?` data-edit="${t.id}" title="bearbeiten"`:""}>${esc(t.title)}</span><span class="s">${t.subtask_count} Teilaufgabe(n) · von ${esc(t.owner_name)}${t.mine?" (du)":""} · ${t.shared?"🌍 geteilt":"🔒 privat"} · ${esc(fmtDateTime(t.updated_at))}</span></span>
        ${(t.mine||ME.is_admin)?`<button class="abtn" data-edit="${t.id}" title="bearbeiten">✏️</button><button class="abtn" data-share="${t.id}" data-on="${t.shared?1:0}" title="${t.shared?'Freigabe zurücknehmen':'für andere Lehrkräfte freigeben'}">${t.shared?'🌍':'🔒'}</button><button class="abtn" data-del="${t.id}" data-nm="${esc(t.title)}" title="löschen">🗑️</button>`:""}
      </div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Lege eine über „+ Neue Vorlage" an – oder wähle in einer Aufgabe „⭐ Als Vorlage".</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>📋 Aufgaben-Vorlagen</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewTpl">+ Neue Vorlage</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Vorlagen sind wiederverwendbare Aufgaben (mit Datenbank + Teilaufgaben). In einer Klasse legst du über <b>📋 aus Vorlage</b> eine neue Aufgabe daraus an. <b>Geteilte</b> Vorlagen können auch andere Lehrkräfte verwenden.</span></div>
    ${rows}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewTpl").onclick = ()=> sqlTemplateEditorPage(null);
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=> sqlTemplateEditorPage({id:b.dataset.edit}));
  document.querySelectorAll("[data-share]").forEach(b=> b.onclick=async()=>{ const on=b.dataset.on==="1"; try{ await api.sqlUpdateTemplate(b.dataset.share,{shared:!on}); toast(on?"Freigabe zurückgenommen":"Vorlage freigegeben 🌍","ok"); sqlTemplatesPage(); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm(`Vorlage „${b.dataset.nm}" wirklich löschen?`)) return; try{ await api.sqlDeleteTemplate(b.dataset.del); toast("Vorlage gelöscht","ok"); sqlTemplatesPage(); }catch(e){ toast(e.message||"Fehler","err"); } });
}
/* ---------- SQL-Playground: Schüler-Profil (Lehrer-Ansicht) ---------- */
async function sqlStudentProfilePage(classId, studentId, studentName, username){
  shell(`<div class="center-load"><span class="spin"></span>Profil…</div>`);
  let asgs=[], subs=[], subIdsBy={}, note=null, overview=null;
  try{
    asgs = await api.sqlListAssignments(classId);
    if(asgs.length){ const ids=asgs.map(a=>a.id);
      subs = (await api.sqlClassSubmissions(ids)).filter(s=>s.student_id===studentId);
      const rows = await api.sqlSubtaskIds(ids); asgs.forEach(a=>subIdsBy[a.id]=[]); rows.forEach(r=>{ const arr=subIdsBy[r.assignment_id]; if(arr) arr.push(r.id); });
    }
    try{ note = await api.getStudentNote(classId, studentId); }catch(e){}
    try{ overview = await api.studentOverview(studentId); }catch(e){}
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const lastLogin = (overview&&overview.last_login)?fmtDateTime(overview.last_login):"—";
  const subByA = id=> subs.find(s=>s.assignment_id===id);
  const passCount = asgs.filter(a=>{ const s=subByA(a.id); return s&&s.passed===true; }).length;
  const doneCount = asgs.filter(a=> !!subByA(a.id)).length;
  const _ts = subs.map(s=>s.updated_at).filter(Boolean).sort(); const lastAct = _ts.length ? fmtDateTime(_ts[_ts.length-1]) : "—";
  const aRows = asgs.length ? asgs.map(a=>{
    const ids=subIdsBy[a.id]||[], total=ids.length, s=subByA(a.id), res=(s&&s.results)||{};
    let g=0; for(const id of ids){ if(res[id]==="correct") g++; }
    const badge = !s ? '<span class="badge gray">offen</span>' : (s.passed===true?'<span class="badge">bestanden ✓</span>':'<span class="badge gold">in Bearbeitung</span>');
    const quote = total?` <span class="muted" style="font-size:12px">${g}/${total}</span>`:"";
    const open = s?`<button class="btn btn-sm btn-ghost" data-aopen="${a.id}">ansehen</button>`:"";
    return `<div class="row"><span class="grow"><span class="t">${esc(a.title)}${quote}</span></span>${badge}${open}</div>`;
  }).join("") : `<div class="muted" style="font-size:13px">Keine Aufgaben.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2><span class="chip" style="font-size:16px"><span class="av">${esc(initials(studentName))}</span>${esc(studentName)}</span></h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-bottom:14px">
      <div class="card"><div class="meta">🪪 Benutzername</div><div style="font-weight:900;margin-top:4px"><code>${esc(username||"—")}</code></div></div>
      <div class="card"><div class="meta">🕐 Zuletzt eingeloggt</div><div style="font-weight:900;margin-top:4px">${esc(lastLogin)}</div></div>
      <div class="card"><div class="meta">⚡ Letzte SQL-Abgabe</div><div style="font-weight:900;margin-top:4px">${esc(lastAct)}</div></div>
      <div class="card"><div class="meta">✅ Fortschritt</div><div style="font-weight:900;margin-top:4px">${passCount} bestanden · ${doneCount}/${asgs.length} bearbeitet</div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 10px">📋 Aufgaben</h3><div class="list">${aRows}</div></div>
    <div class="card"><h3 style="margin:0 0 8px">📝 Notizen zu ${esc(studentName)} <span class="muted" style="font-weight:600;font-size:12px">(privat – nur Lehrkräfte)</span></h3>
      <textarea class="input" id="snNote" style="min-height:90px" placeholder="Notizen zu ${esc(studentName)}…">${esc(note?note.body:"")}</textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px"><button class="btn btn-primary" id="snSave">Notiz speichern</button><span id="snMsg" class="muted" style="font-size:13px">${note&&note.updated_at?("zuletzt: "+esc(fmtDateTime(note.updated_at))):""}</span></div></div>`;
  document.getElementById("back").onclick = ()=> sqlTeacherClassView(classId);
  document.querySelectorAll("[data-aopen]").forEach(b=> b.onclick=()=> sqlReviewSubmission(b.dataset.aopen, studentId, studentName, classId));
  document.getElementById("snSave").onclick=async()=>{ const body=document.getElementById("snNote").value; const btn=document.getElementById("snSave"); btn.disabled=true; btn.textContent="Speichere…"; try{ await api.saveStudentNote(classId, studentId, body); document.getElementById("snMsg").textContent="gespeichert ✓"; toast("Notiz gespeichert ✓","ok"); }catch(e){ toast(e.message||"Fehler","err"); } finally{ btn.disabled=false; btn.textContent="Notiz speichern"; } };
}
/* ---------- SQL-Playground: Lehrer-Einsicht in eine Schüler-Abgabe (read-only) ---------- */
let sqlReviewState=null;
async function sqlReviewSubmission(assignmentId, studentId, studentName, classId){
  shell(`<div class="center-load"><span class="spin"></span>Abgabe wird geladen…</div>`);
  let a, subtasks=[], submission=null;
  try{ a=await api.sqlGetAssignment(assignmentId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!a){ document.getElementById("view").innerHTML=errBox({message:"Aufgabe nicht gefunden."}); return; }
  try{ subtasks=await api.sqlListSubtasks(assignmentId); }catch(e){ subtasks=[]; }
  try{ submission=await api.sqlGetSubmission(assignmentId, studentId); }catch(e){}
  let comment=null; if(submission){ try{ comment=await api.sqlGetComment(submission.id); }catch(e){} }
  sqlReviewState = {
    assignmentId, classId, studentId, studentName,
    dbText:a.db_snapshot||"", title:a.title, description:a.description||"", released:!!a.released,
    subtasks, answers:(submission&&submission.answers)||{}, results:(submission&&submission.results)||{},
    passed: submission?submission.passed:null, updatedAt: submission?submission.updated_at:null,
    submissionId: submission?submission.id:null, comment,
    selected:0, view:null
  };
  try{ SqlEngine.ensureStyles(); }catch(e){}
  renderSqlReview();
}
function renderSqlReview(){
  const s=sqlReviewState;
  const subList = s.subtasks.map((st,i)=>`
      <div class="row sqst" data-i="${i}" style="cursor:pointer;border-radius:10px;${i===s.selected?'background:var(--green-l);box-shadow:inset 0 0 0 1.5px var(--green)':''}">
        <span class="sicon" style="width:18px;text-align:center">${sqlStatusIcon(s.results[st.id])}</span>
        <span class="grow"><span class="t">Teilaufgabe ${i+1}</span></span></div>`).join("");
  const statusBadge = s.passed===true?'<span class="badge">bestanden ✓</span>':(s.updatedAt?'<span class="badge gold">in Bearbeitung</span>':'<span class="badge gray">keine Abgabe</span>');
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>Abgabe von ${esc(s.studentName)}</h2><div class="spacer"></div>${statusBadge}${s.updatedAt?`<span class="muted" style="font-size:12px;margin-left:8px">${esc(fmtDateTime(s.updatedAt))}</span>`:''}</div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><b>Aufgabe:</b> ${esc(s.title)}${s.description?` – <span class="muted">${esc(s.description)}</span>`:''}
      <span class="muted" style="font-size:12px;display:block;margin-top:4px">👀 Einsicht: Du siehst die Abgabe der/des Schüler:in. Mit ▶ kannst du ihre/seine Abfrage gegen die Aufgaben-Datenbank laufen lassen (nur Ansicht, nichts wird gespeichert).</span></div>
    <div class="grid" style="grid-template-columns:230px 1fr;gap:14px;align-items:start">
      <div class="card"><h3 style="margin:0 0 10px">Teilaufgaben</h3><div class="list" id="revSubList">${subList||'<div class="muted" style="font-size:13px">Keine Teilaufgaben.</div>'}</div></div>
      <div class="card" id="revRight"></div>
    </div>
    ${s.submissionId?`<div class="card" style="margin-top:14px">
      <h3 style="margin:0 0 8px">💬 Rückmeldung an ${esc(s.studentName)}</h3>
      <textarea class="input" id="sqlRevComment" style="min-height:70px" placeholder="Kommentar zu dieser Abgabe…">${esc((s.comment&&s.comment.body)||"")}</textarea>
      <div style="display:flex;gap:12px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <label style="display:flex;gap:8px;align-items:center;font-weight:800;cursor:pointer"><input type="checkbox" id="sqlRevRelease" style="width:18px;height:18px" ${s.comment&&s.comment.released?'checked':''}> Für Schüler:in sichtbar</label>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" id="sqlRevDelete" style="${s.comment?'':'display:none'}">Löschen</button>
        <button class="btn btn-primary" id="sqlRevSave">Kommentar speichern</button>
      </div>
      <span id="sqlRevMsg" class="muted" style="display:block;margin-top:6px">${s.comment?(s.comment.released?'Für Schüler:in sichtbar ✓':'Gespeichert (noch nicht freigegeben)'):''}</span>
    </div>`:''}`;
  document.getElementById("back").onclick = ()=> sqlTeacherClassView(s.classId);
  document.querySelectorAll("#revSubList .sqst").forEach(row=> row.onclick=()=>{ s.selected=+row.dataset.i; document.querySelectorAll("#revSubList .sqst").forEach(r=>{ const on=(+r.dataset.i===s.selected); r.style.background=on?'var(--line2)':''; r.style.borderRadius=on?'10px':''; }); renderSqlReviewRight(); });
  { const sv=document.getElementById("sqlRevSave"); if(sv) sv.onclick=saveSqlReviewComment; }
  { const dl=document.getElementById("sqlRevDelete"); if(dl) dl.onclick=deleteSqlReviewComment; }
  renderSqlReviewRight();
}
function renderSqlReviewRight(){
  const s=sqlReviewState, st=s.subtasks[s.selected], right=document.getElementById("revRight");
  if(!right) return;
  if(!st){ right.innerHTML='<div class="empty"><span class="ic">📝</span>Diese Aufgabe hat keine Teilaufgaben.</div>'; return; }
  const status=s.results[st.id], answer=s.answers[st.id]||"";
  right.innerHTML = `
    <div class="field"><label>Teilaufgabe ${s.selected+1} ${sqlSolveMsg(status)}</label><div style="font-weight:700;white-space:pre-wrap">${esc(st.prompt)||'<span class="muted">(kein Text)</span>'}</div></div>
    ${st.solution_sql?`<details class="sqv-schema" style="margin-bottom:10px"><summary>🏆 Musterlösung ${s.released?'<span class="badge" style="margin-left:4px">freigegeben</span>':'<span class="muted" style="font-weight:700">(nur für dich)</span>'}</summary><pre style="margin:0;padding:10px 14px;font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;white-space:pre-wrap;overflow:auto">${esc(st.solution_sql)}</pre></details>`:''}
    <label class="muted" style="font-size:12.5px;font-weight:800;display:block;margin-bottom:6px">Abgabe der/des Schüler:in${answer?'':' – (leer)'}</label>
    <div id="revSqlHost"></div>`;
  if(s.view){ try{ s.view.destroy(); }catch(e){} }
  s.view = new SqlView("#revSqlHost", { dbText:s.dbText, query:answer, readonly:true, autofill:false });
  pageView=s.view;
}
async function saveSqlReviewComment(){
  const s=sqlReviewState; if(!s||!s.submissionId) return;
  const ta=document.getElementById("sqlRevComment"), rel=document.getElementById("sqlRevRelease");
  const body=(ta?ta.value:"").trim(), released=!!(rel&&rel.checked);
  if(!body){ toast("Bitte einen Kommentar eingeben.","err"); return; }
  const btn=document.getElementById("sqlRevSave"); if(btn){ btn.disabled=true; btn.textContent="Speichere…"; }
  try{ s.comment=await api.sqlSaveComment(s.submissionId, body, released);
    const del=document.getElementById("sqlRevDelete"); if(del) del.style.display="";
    const msg=document.getElementById("sqlRevMsg"); if(msg) msg.textContent=released?"Für Schüler:in sichtbar ✓":"Gespeichert (noch nicht freigegeben)";
    toast("Kommentar gespeichert ✓","ok");
  }catch(e){ toast(e.message||"Fehler","err"); }
  finally{ if(btn){ btn.disabled=false; btn.textContent="Kommentar speichern"; } }
}
async function deleteSqlReviewComment(){
  const s=sqlReviewState; if(!s||!s.submissionId||!s.comment) return;
  if(!confirm("Kommentar löschen?")) return;
  try{ await api.sqlDeleteComment(s.submissionId); s.comment=null;
    const ta=document.getElementById("sqlRevComment"); if(ta) ta.value="";
    const rel=document.getElementById("sqlRevRelease"); if(rel) rel.checked=false;
    const del=document.getElementById("sqlRevDelete"); if(del) del.style.display="none";
    const msg=document.getElementById("sqlRevMsg"); if(msg) msg.textContent="Kommentar gelöscht.";
    toast("Gelöscht","ok");
  }catch(e){ toast(e.message||"Fehler","err"); }
}
async function sqlStudentClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let cls, asgs=[], subs=[], subIdsBy={};
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data;
    asgs = await api.sqlStudentAssignments(classId);
    subs = await api.sqlMySubmissions(asgs.map(a=>a.id));
    if(asgs.length){ const arr=await Promise.all(asgs.map(a=> api.sqlSubtasksForStudent(a.id).then(r=>(r||[]).map(x=>x.id)).catch(()=>[]))); asgs.forEach((a,i)=>{ subIdsBy[a.id]=arr[i]; }); }
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  let coms=[]; try{ if(subs.length) coms = await api.sqlClassComments(subs.map(x=>x.id)); }catch(e){}   // freigegebene Rückmeldungen
  const feedback=(a)=>{ const s=subs.find(x=>x.assignment_id===a.id); const c=s?coms.find(x=>x.submission_id===s.id&&x.released):null; return c?feedbackPreviewHtml(c.body):""; };
  const badge=(a)=>{ const s=subs.find(x=>x.assignment_id===a.id); if(!s) return '<span class="badge gray">offen</span>'; if(s.passed===true) return '<span class="badge">bestanden ✓</span>'; return '<span class="badge gold">in Bearbeitung</span>'; };
  const progress=(a)=>{ const ids=subIdsBy[a.id]||[], total=ids.length; if(!total) return ""; const sub=subs.find(x=>x.assignment_id===a.id), res=(sub&&sub.results)||{}; let g=0,y=0; for(const id of ids){ const st=res[id]; if(st==="correct")g++; else if(st==="wrong")y++; } const grey=total-g-y; const seg=(n,c)=> n>0?`<div style="flex:${n};background:${c}"></div>`:""; return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px"><div style="display:flex;height:7px;flex:1;max-width:170px;border-radius:4px;overflow:hidden;background:var(--line2)">${seg(g,"var(--green)")}${seg(y,"var(--gold)")}${seg(grey,"var(--line2)")}</div><span class="muted" style="font-size:11.5px;font-weight:800">${g}/${total}</span></div>`; };
  const list = asgs.length ? `<div class="list">${asgs.map(a=>`
      <div class="row clickrow" data-id="${a.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(a.title)}</span>${a.description?`<span class="s">${esc(a.description.slice(0,70))}</span>`:""}${feedback(a)}${progress(a)}</span>${badge(a)}<span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📝</span>Noch keine Aufgaben. Schau später wieder rein!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls?cls.name:"Klasse")}${CLASS_REFRESH_BTN}</h2></div>
    ${list}`;
  document.getElementById("back").onclick = sqlStudentHome;
  wireClassRefresh(()=> sqlStudentClassView(classId));
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=()=> sqlSolveAssignment(r.dataset.id));
}

/* ---------- SQL-Playground: Aufgabe lösen (Schüler:innen) + Benotung ---------- */
let sqlSolveState=null;
function sqlStatusIcon(st){ return st==="correct"?'<b style="color:var(--green-d)">✓</b>':st==="wrong"?'<b style="color:var(--gold-d)">~</b>':'<span style="color:var(--muted);font-size:22px;line-height:0;vertical-align:middle">•</span>'; }
async function sqlSolveAssignment(assignmentId){
  shell(`<div class="center-load"><span class="spin"></span>Aufgabe wird geladen…</div>`);
  let a, subtasks=[], submission=null;
  try{ a=await api.sqlGetAssignment(assignmentId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!a){ document.getElementById("view").innerHTML=errBox({message:"Aufgabe nicht gefunden."}); return; }
  try{ subtasks=await api.sqlSubtasksForStudent(assignmentId); }catch(e){ subtasks=[]; }
  try{ submission=await api.sqlGetMySubmission(assignmentId); }catch(e){}
  let comment=null; if(submission){ try{ comment=await api.sqlGetComment(submission.id); }catch(e){} }   // RLS: nur freigegebene eigene
  sqlSolveState = {
    assignmentId, classId:a.class_id, dbText:a.db_snapshot||"", released:!!a.released,
    title:a.title, description:a.description||"", subtasks:subtasks,
    answers:(submission&&submission.answers)||{}, results:(submission&&submission.results)||{},
    teacherComment:(comment&&comment.body)||"",
    schemaOpen:true,
    selected:0, view:null
  };
  try{ SqlEngine.ensureStyles(); }catch(e){}
  renderSqlSolve();
}
function renderSqlSolve(){
  const s=sqlSolveState;
  const subList = s.subtasks.map((st,i)=>`
      <div class="row sqst" data-i="${i}" style="cursor:pointer;border-radius:10px;${i===s.selected?'background:var(--green-l);box-shadow:inset 0 0 0 1.5px var(--green)':''}">
        <span class="sicon" style="width:18px;text-align:center">${sqlStatusIcon(s.results[st.id])}</span>
        <span class="grow"><span class="t">Teilaufgabe ${i+1}</span></span></div>`).join("");
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(s.title)}</h2></div>
    ${s.description?`<div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13.5px;white-space:pre-wrap">${esc(s.description)}</span></div>`:""}
    ${s.teacherComment?`<div class="card" style="margin-bottom:12px;padding:12px 16px;border-left:4px solid var(--gold)"><b>💬 Rückmeldung deiner Lehrkraft:</b><div style="margin-top:4px;white-space:pre-wrap">${esc(s.teacherComment)}</div></div>`:""}
    <div class="grid" style="grid-template-columns:230px 1fr;gap:14px;align-items:start">
      <div class="card"><h3 style="margin:0 0 10px">Teilaufgaben</h3><div class="list" id="solveSubList">${subList||'<div class="muted" style="font-size:13px">Keine Teilaufgaben.</div>'}</div></div>
      <div class="card" id="solveRight"></div>
    </div>`;
  document.getElementById("back").onclick = ()=>{ syncSolve(); sqlStudentClassView(s.classId); };
  document.querySelectorAll("#solveSubList .sqst").forEach(row=> row.onclick=()=>{ syncSolve(); s.selected=+row.dataset.i; renderSqlSolve(); });
  window.scrollTo(0,0);   // beim Öffnen/Wechsel einer Teilaufgabe nach oben scrollen
  renderSqlSolveRight();
}
function renderSqlSolveRight(){
  const s=sqlSolveState, st=s.subtasks[s.selected], right=document.getElementById("solveRight");
  if(!right) return;
  if(!st){ right.innerHTML='<div class="empty"><span class="ic">📝</span>Diese Aufgabe hat noch keine Teilaufgaben.</div>'; return; }
  const status=s.results[st.id];
  right.innerHTML = `
    <div class="field"><label>Teilaufgabe ${s.selected+1}</label><div style="font-weight:700;white-space:pre-wrap">${esc(st.prompt)||'<span class="muted">(kein Text)</span>'}</div></div>
    ${(s.released && st.solution_sql)?`<details class="sqv-schema" style="margin-bottom:10px"><summary>🏆 Musterlösung anzeigen</summary><pre style="margin:0;padding:10px 14px;font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;white-space:pre-wrap;overflow:auto">${esc(st.solution_sql)}</pre></details>`:""}
    <div id="solveSqlHost"></div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px"><button class="btn btn-primary btn-sm" id="solveSave">💾 Lösung speichern</button><span id="solveMsg">${sqlSolveMsg(status)}</span></div>`;
  if(s.view){ try{ s.view.destroy(); }catch(e){} }
  s.view = new SqlView("#solveSqlHost", { dbText:s.dbText, query: s.answers[st.id]||"", autofill:false, schemaOpen:s.schemaOpen, onSchemaToggle:(o)=>{ s.schemaOpen=o; }, autorun:true });
  pageView=s.view;
  document.getElementById("solveSave").onclick = saveSqlAnswer;
}
function sqlSolveMsg(status){ return status==="correct"?'<span style="color:var(--green-d);font-weight:800">✓ Richtig!</span>' : status==="wrong"?'<span style="color:var(--gold-d);font-weight:800">Noch nicht richtig – versuch es nochmal.</span>' : ''; }
function syncSolve(){ const s=sqlSolveState; if(!s) return; const st=s.subtasks[s.selected]; if(st&&s.view) s.answers[st.id]=s.view.getQuery(); }
async function saveSqlAnswer(){
  const s=sqlSolveState, st=s.subtasks[s.selected]; if(!st) return;
  syncSolve();
  const q=(s.answers[st.id]||"").trim();
  const btn=document.getElementById("solveSave"), msg=document.getElementById("solveMsg");
  btn.disabled=true; btn.textContent="Speichere…";
  let status="empty";
  if(q){
    let db=null; try{ db=await SqlEngine.run(s.dbText); }catch(e){ db=null; }
    if(!db){ status="wrong"; }
    else { let out=null, ok=true; try{ out=db.exec(q); }catch(e){ ok=false; }
      if(!ok){ try{db.close();}catch(_){}; status="wrong"; }
      else if(!st.compare){ try{db.close();}catch(_){}; status="correct"; }
      else { const sig=SqlEngine.normalize(out, st.ordered); try{db.close();}catch(_){}; try{ status=await api.sqlGradeSubtask(st.id, sig); }catch(e){ status="wrong"; } }
    }
  }
  s.results[st.id]=status;
  const passed = s.subtasks.length>0 && s.subtasks.every(x=> s.results[x.id]==="correct");
  try{ await api.sqlSaveSubmission(s.assignmentId, s.answers, s.results, passed); }
  catch(e){ btn.disabled=false; btn.textContent="💾 Lösung speichern"; toast(e.message||"Fehler","err"); return; }
  btn.disabled=false; btn.textContent="💾 Lösung speichern";
  const cells=document.querySelectorAll("#solveSubList .sicon"); s.subtasks.forEach((x,i)=>{ if(cells[i]) cells[i].innerHTML=sqlStatusIcon(s.results[x.id]); });
  if(msg) msg.innerHTML=sqlSolveMsg(status);
  toast(status==="correct"?"Richtig! ✓":status==="empty"?"Leer gespeichert":"Gespeichert – noch nicht richtig","ok");
}

/* ---------- SQL-Sandbox: private Projekte (frei ausprobieren + speichern) ---------- */
async function sqlSandbox(back){
  const b = subBack(sqlSandbox, back) || {label:"← Zurück", go:()=> (ME.role==="teacher"?sqlTeacherHome():sqlStudentHome())};
  shell(`<div class="center-load"><span class="spin"></span>Sandbox…</div>`);
  let projects=[]; try{ projects=await api.listSqlSandboxProjects(); }catch(e){}
  const list = projects.length ? `<div class="list">${projects.map(p=>`
      <div class="row clickrow" data-id="${p.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(fmtDateTime(p.updated_at))}</span></span>
        <button class="btn btn-sm btn-ghost" data-del="${p.id}" title="löschen">🗑️</button><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🧪</span>Noch keine Projekte. Leg dein erstes an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>🧪 SQL-Sandbox</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewSbx">+ Neues Projekt</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Probiere SQL frei aus – Datenbank wählen, Abfragen schreiben, ausführen – und speichere deine eigenen Projekte.</span></div>
    ${list}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewSbx").onclick = ()=> sqlSandboxProject(null);
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=(e)=>{ if(e.target.closest("[data-del]")) return; sqlSandboxProject(r.dataset.id); });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async(e)=>{ e.stopPropagation(); if(!confirm("Projekt löschen?")) return; try{ await api.deleteSqlSandboxProject(b.dataset.del); sqlSandbox(); }catch(err){ toast(err.message||"Fehler","err"); } });
}
let sqlSandboxState=null;
async function sqlSandboxProject(projectId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let proj=null; if(projectId){ try{ proj=await api.getSqlSandboxProject(projectId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  let dbs=[]; try{ dbs=await api.sandboxSqlDatabases(); }catch(e){}
  sqlSandboxState = {
    projectId: proj?proj.id:null,
    title: proj?(proj.title||"Mein SQL-Projekt"):"Mein SQL-Projekt",
    dbText: proj?(proj.db_text||""):(dbs[0]?(dbs[0].sql_text||""):""),
    query: proj?(proj.query||""):"",
    databaseId: proj?null:(dbs[0]?dbs[0].id:"__empty"),
    dbs, view:null
  };
  try{ SqlEngine.ensureStyles(); }catch(e){}
  renderSqlSandboxProject();
}
function renderSqlSandboxProject(){
  const s=sqlSandboxState;
  const inList = s.databaseId && s.databaseId!=="__empty" && s.dbs.some(d=>d.id===s.databaseId);
  const dbOpts = `${(!inList && s.databaseId!=="__empty")?`<option value="" selected>${s.dbText?"— gespeicherte Datenbank —":"— bitte wählen —"}</option>`:""}`
    + s.dbs.map(d=>`<option value="${esc(d.id)}" ${d.id===s.databaseId?"selected":""}>${esc(d.name)}${d.mine?"":" (von "+esc(d.owner_name)+")"}</option>`).join("")
    + `<option value="__empty" ${s.databaseId==="__empty"?"selected":""}>(leere Datenbank)</option>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Zur Sandbox</button></div>
    <div class="page-head" style="margin-top:0">
      <input class="input" id="sbxTitle" style="max-width:260px;font-weight:800" maxlength="80">
      <label class="muted" style="font-size:13px;font-weight:800;align-self:center;margin-left:8px">Datenbank:</label>
      <select class="input" id="sbxDb" style="max-width:210px;margin-left:8px;width:auto">${dbOpts}</select>
      <div class="spacer"></div>
      <input type="file" id="sbxFile" accept=".sql,.txt" style="display:none">
      <button class="btn btn-ghost btn-sm" id="sbxOpen" title="SQL aus .sql-Datei laden">📂</button>
      <button class="btn btn-ghost btn-sm" id="sbxDl" style="margin-left:6px" title="SQL als .sql herunterladen">⬇️</button>
      <button class="btn btn-primary btn-sm" id="sbxSave" style="margin-left:8px">💾 Speichern</button></div>
    <div id="sbxHost"><div class="center-load"><span class="spin"></span>SQL-Engine wird geladen…</div></div>`;
  document.getElementById("sbxTitle").value = s.title;
  document.getElementById("back").onclick = ()=>{ syncSqlSandbox(); sqlSandbox(); };
  document.getElementById("sbxTitle").oninput = (e)=>{ s.title=e.target.value; };
  document.getElementById("sbxDb").onchange = (e)=>{ syncSqlSandbox(); const v=e.target.value; if(v==="__empty"||!v){ s.databaseId=(v==="__empty"?"__empty":null); s.dbText=""; } else { s.databaseId=v; const d=s.dbs.find(x=>x.id===v); s.dbText=d?(d.sql_text||""):""; } buildSqlSandboxView(); };
  document.getElementById("sbxDl").onclick = ()=>{ const txt=(s.view?s.view.getQuery():s.query)||""; const nm=((s.title||"sandbox").trim().replace(/[^\w.\- ]+/g,"_")||"sandbox")+".sql"; const blob=new Blob([txt],{type:"text/plain;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=nm; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); };
  { const fo=document.getElementById("sbxOpen"), fi=document.getElementById("sbxFile"); fo.onclick=()=>fi.click(); fi.onchange=(e)=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ const t=String(rd.result||""); s.query=t; if(s.view) s.view.setQuery(t); toast("Datei geladen ✓","ok"); }; rd.readAsText(f); }; }
  document.getElementById("sbxSave").onclick = saveSqlSandboxProject;
  buildSqlSandboxView();
}
function buildSqlSandboxView(){
  const s=sqlSandboxState; if(!s) return;
  if(s.view){ try{ s.view.destroy(); }catch(e){} }
  s.view = new SqlView("#sbxHost", { dbText:s.dbText, query:s.query, schemaOpen:true });
  pageView = s.view;
}
function syncSqlSandbox(){ const s=sqlSandboxState; if(!s) return; if(s.view) s.query=s.view.getQuery(); const t=document.getElementById("sbxTitle"); if(t) s.title=t.value.trim()||"Mein SQL-Projekt"; }
async function saveSqlSandboxProject(){
  const s=sqlSandboxState; syncSqlSandbox();
  const btn=document.getElementById("sbxSave"); if(btn){ btn.disabled=true; btn.textContent="Speichere…"; }
  const payload={ title:(s.title||"Mein SQL-Projekt"), db_text:s.dbText||"", query:s.query||"" };
  try{ if(s.projectId){ await api.updateSqlSandboxProject(s.projectId, payload); } else { const p=await api.createSqlSandboxProject(payload); s.projectId=p.id; } toast("Projekt gespeichert ✓","ok"); }
  catch(e){ toast(e.message||"Fehler","err"); }
  finally{ if(btn){ btn.disabled=false; btn.textContent="💾 Speichern"; } }
}

/* ---------- SQL-Playground: Datenbank-Bibliothek (Lehrkräfte) ---------- */
async function sqlDatabasesPage(back){
  const b = subBack(sqlDatabasesPage, back) || {label:"← SQL · Meine Klassen", go:sqlTeacherHome};
  shell(`<div class="center-load"><span class="spin"></span>Datenbanken…</div>`);
  let list=[]; try{ list=await api.sqlListDatabases(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const rows = list.length ? `<div class="list">${list.map(d=>`
      <div class="row clickrow" data-open="${d.id}" style="cursor:pointer">
        <span class="grow"><span class="t">${esc(d.name)}</span><span class="s">von ${esc(d.owner_name)}${d.mine?" (du)":""} · ${d.shared?"🌍 geteilt":"🔒 privat"} · ${esc(fmtDateTime(d.updated_at))}</span></span>
        ${(d.mine||ME.is_admin)?`<button class="btn btn-sm btn-ghost" data-del="${d.id}" data-nm="${esc(d.name)}" title="löschen">🗑️</button>`:""}
        <span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🗄️</span>Noch keine Datenbanken. Lege deine erste an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>🗄️ Datenbanken</h2><div class="spacer"></div>
      <button class="btn btn-primary" id="btnNewDb">+ Neue Datenbank</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Datenbanken für SQL-Aufgaben. <b>Geteilte</b> Datenbanken können andere Lehrkräfte verwenden und stehen <b>allen in der 🧪 Sandbox</b> zur Verfügung; <b>private</b> nur dir (auch in deiner Sandbox). Schüler:innen sehen in der Sandbox zusätzlich alle DBs, zu denen sie eine Aufgabe haben.</span></div>
    ${rows}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewDb").onclick = ()=> sqlDatabaseEditorPage(null);
  document.querySelectorAll(".clickrow[data-open]").forEach(r=> r.onclick=(e)=>{ if(e.target.closest("[data-del]")) return; const d=list.find(x=>x.id===r.dataset.open); sqlDatabaseEditorPage(d); });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async(e)=>{ e.stopPropagation(); if(!confirm(`Datenbank „${b.dataset.nm}" wirklich löschen?`)) return; try{ await api.sqlDeleteDatabase(b.dataset.del); toast("Datenbank gelöscht","ok"); sqlDatabasesPage(); }catch(err){ toast(err.message||"Fehler","err"); } });
}
async function sqlDatabaseEditorPage(meta){
  const isNew=!meta, canEdit=isNew||!!meta.mine||ME.is_admin;
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let sqlText="", name="", shared=false;
  if(!isNew){
    try{ const d=await api.sqlGetDatabase(meta.id); sqlText=d.sql_text||""; name=d.name||""; shared=!!d.shared; }
    catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  }
  try{ SqlEngine.ensureStyles(); }catch(e){}
  const title = isNew?"Neue Datenbank":(canEdit?"Datenbank bearbeiten":esc(name));
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Datenbanken</button></div>
    <div class="page-head" style="margin-top:0"><h2>🗄️ ${title}</h2>${(!canEdit&&meta)?`<span class="badge gray" style="margin-left:8px;align-self:center">von ${esc(meta.owner_name)} · nur ansehen</span>`:""}</div>
    <div class="card" style="margin-bottom:14px">
      <div class="field" style="margin-bottom:${canEdit?"14px":"0"}"><label>Name</label><input class="input" id="dbName" maxlength="80" value="${esc(name)}" ${canEdit?"":"disabled"}></div>
      ${canEdit?`<label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;cursor:pointer"><input type="checkbox" id="dbShared" ${shared?"checked":""}> 🌍 Freigeben – andere Lehrkräfte können sie nutzen und sie steht allen in der 🧪 Sandbox zur Verfügung</label>`:""}
    </div>
    <div class="page-head" style="margin:0 0 8px"><h3 style="margin:0">SQL-Code (erstellt die Datenbank)</h3><div class="spacer"></div>
      ${canEdit?`<input type="file" id="dbFile" accept=".sql,.txt" style="display:none"><button class="btn btn-ghost btn-sm" id="dbOpen" title="SQL-Datei öffnen">📂 Datei öffnen</button>`:""}
      <button class="btn btn-ghost btn-sm" id="dbDownload" style="margin-left:8px" title="als .sql herunterladen">⬇️ Download</button>
      <button class="btn btn-blue btn-sm" id="dbRun" style="margin-left:8px">▶ Ausführen</button></div>
    <textarea class="sqv-input" id="dbSql" style="min-height:220px" spellcheck="false" placeholder="CREATE TABLE …;  INSERT INTO … ;" ${canEdit?"":"readonly"}></textarea>
    <div class="page-head" style="margin:14px 0 8px"><h3 style="margin:0">Datenbank-Schema</h3></div>
    <div id="dbSchema"><div class="sqv-note" style="color:var(--muted);font-size:13px;padding:8px 2px">Führe den SQL-Code mit ▶ aus, um das Schema zu sehen.</div></div>
    ${canEdit?`<div style="margin-top:16px"><button class="btn btn-primary btn-lg" id="dbSave">💾 Datenbank speichern</button></div>`:""}`;
  document.getElementById("dbSql").value = sqlText;
  document.getElementById("back").onclick = ()=> sqlDatabasesPage();   // Pfeil-Wrapper: Klick-Event darf NICHT als back-Parameter durchrutschen
  const runDb = async ()=>{
    const txt=document.getElementById("dbSql").value, out=document.getElementById("dbSchema");
    out.innerHTML='<div class="center-load"><span class="spin"></span>Wird ausgeführt…</div>';
    let db=null;
    try{ db=await SqlEngine.run(txt); }
    catch(e){ out.innerHTML=`<div class="sqv-err">Fehler beim Ausführen: ${esc(e.message||e)}</div>`; return false; }
    const sch=SqlEngine.schema(db);
    out.innerHTML = (sch.length?`<div style="color:var(--green-d);font-weight:800;margin-bottom:8px">✓ Erfolgreich aufgebaut – ${sch.length} Tabelle(n)</div>`:'<div class="sqv-note" style="color:var(--muted);font-size:13px">Lief fehlerfrei, aber es wurden keine Tabellen erstellt.</div>') + SqlEngine.schemaHtml(db);
    try{ db.close(); }catch(e){}
    return true;
  };
  document.getElementById("dbRun").onclick = runDb;
  document.getElementById("dbDownload").onclick = ()=>{ const txt=document.getElementById("dbSql").value; const nm=((document.getElementById("dbName").value||"").trim()||"datenbank").replace(/[^\w.\- ]+/g,"_")+".sql"; const blob=new Blob([txt],{type:"text/plain;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=nm; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); };
  { const fo=document.getElementById("dbOpen"); if(fo){ const fi=document.getElementById("dbFile");
      fo.onclick=()=> fi.click();
      fi.onchange=(e)=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ document.getElementById("dbSql").value=String(rd.result||""); toast("Datei geladen ✓","ok"); }; rd.readAsText(f); }; } }
  { const sv=document.getElementById("dbSave"); if(sv) sv.onclick=async()=>{
      const nm=(document.getElementById("dbName").value||"").trim();
      const txt=document.getElementById("dbSql").value;
      const sh=!!(document.getElementById("dbShared")&&document.getElementById("dbShared").checked);
      if(!nm){ toast("Bitte einen Namen eingeben.","err"); return; }
      if(!txt.trim()){ toast("Bitte SQL-Code eingeben.","err"); return; }
      sv.disabled=true; sv.textContent="Prüfe…";
      let db=null; try{ db=await SqlEngine.run(txt); try{ db.close(); }catch(e){} }
      catch(e){ sv.disabled=false; sv.textContent="💾 Datenbank speichern"; toast("SQL-Fehler – bitte korrigieren.","err"); document.getElementById("dbSchema").innerHTML=`<div class="sqv-err">Fehler: ${esc(e.message||e)}</div>`; return; }
      sv.textContent="Speichere…";
      try{ if(isNew) await api.sqlCreateDatabase({name:nm, sql_text:txt, shared:sh}); else await api.sqlUpdateDatabase(meta.id,{name:nm, sql_text:txt, shared:sh}); toast("Datenbank gespeichert ✓","ok"); sqlDatabasesPage(); }
      catch(e){ sv.disabled=false; sv.textContent="💾 Datenbank speichern"; toast(e.message||"Fehler","err"); }
  }; }
}

/* ---------- SQL-Playground: Aufgaben-Editor (Lehrkräfte) ---------- */
let sqlAssignState=null;
async function sqlAssignmentEditorPage(classId, existing, prefill){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let dbs=[]; try{ dbs=await api.sqlListDatabases(); }catch(e){ dbs=[]; }
  let a=null, subs=[];
  if(existing && existing.id){ try{ a=await api.sqlGetAssignment(existing.id); subs=await api.sqlListSubtasks(existing.id); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  if(prefill){   // neue Aufgabe aus Vorlage: Inhalt übernehmen, als NEUE Aufgabe (id=null) in dieser Klasse
    sqlAssignState = {
      classId, id:null,
      title: prefill.title||"", description: prefill.description||"", published:false,
      databaseId: null, dbText: prefill.db_snapshot||"", dbs,
      subtasks: (prefill.subtasks&&prefill.subtasks.length)
        ? prefill.subtasks.map(st=>({ prompt:st.prompt||"", solution_sql:st.solution_sql||"", compare:!!st.compare, ordered:!!st.ordered, expected:st.expected||null }))
        : [{ prompt:"", solution_sql:"", compare:true, ordered:false }],
      selected:0, deletedIds:[], view:null
    };
    try{ SqlEngine.ensureStyles(); }catch(e){}
    renderSqlAssignEditor(); return;
  }
  sqlAssignState = {
    classId, id: a?a.id:null,
    title: a?(a.title||""):"", description: a?(a.description||""):"", published: a?!!a.published:false,
    databaseId: a?a.database_id:(dbs[0]?dbs[0].id:null),
    dbText: a?(a.db_snapshot||""):"",
    dbs,
    subtasks: subs.length ? subs.map(s=>({ id:s.id, prompt:s.prompt||"", solution_sql:s.solution_sql||"", compare:!!s.compare, ordered:!!s.ordered }))
                          : [{ prompt:"", solution_sql:"", compare:true, ordered:false }],
    selected: 0, deletedIds: [], view: null
  };
  // Für eine neue Aufgabe: SQL-Text der vorgewählten Bibliotheks-DB laden (einfrieren beim Speichern)
  if(!sqlAssignState.dbText && sqlAssignState.databaseId){ try{ const d=await api.sqlGetDatabase(sqlAssignState.databaseId); sqlAssignState.dbText=d.sql_text||""; }catch(e){} }
  try{ SqlEngine.ensureStyles(); }catch(e){}
  renderSqlAssignEditor();
}
function renderSqlAssignEditor(){
  const s=sqlAssignState;
  const inList = s.databaseId && s.dbs.some(d=>d.id===s.databaseId);
  const dbOpts = `${!inList?`<option value="" selected>${s.dbText?"— gespeicherte Datenbank —":(s.dbs.length?"— bitte wählen —":"— erst eine Datenbank anlegen —")}</option>`:""}`
    + s.dbs.map(d=>`<option value="${esc(d.id)}" ${d.id===s.databaseId?"selected":""}>${esc(d.name)}${d.mine?"":" (von "+esc(d.owner_name)+")"}</option>`).join("");
  const subList = s.subtasks.map((st,i)=>{ const txt=(st.prompt||"").trim(); return `
      <div class="sqedit${i===s.selected?' sel':''}" data-i="${i}">
        <div class="sqedit-row">
          <span class="sqedit-no">${i+1}</span>
          <span class="sqedit-t${txt?"":" empty"}" title="${esc(txt)}">${txt?esc(txt.slice(0,200)):"(noch kein Aufgabentext)"}</span>
          <div class="sqedit-acts"><button class="abtn" data-up="${i}" title="nach oben">↑</button><button class="abtn" data-down="${i}" title="nach unten">↓</button><button class="abtn" data-delsub="${i}" title="löschen">🗑️</button></div>
        </div>
      </div>`; }).join("");
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${s.isTemplate?"← Vorlagen":"← Zur Klasse"}</button></div>
    <div class="card" style="margin-bottom:14px">
      <div class="page-head" style="margin:0 0 12px"><h2 style="margin:0">${s.isTemplate?(s.templateId?"Vorlage bearbeiten":"Neue Vorlage"):(s.id?"SQL-Aufgabe bearbeiten":"Neue SQL-Aufgabe")}</h2><div class="spacer"></div>
        <label class="muted" style="font-size:13px;font-weight:800;align-self:center">Datenbank:</label>
        <select class="input" id="saDb" style="max-width:260px;margin-left:8px;width:auto">${dbOpts}</select>
        ${s.isTemplate?"":`<button class="btn btn-ghost btn-sm" id="saTpl" style="margin-left:8px" title="Diese Aufgabe als wiederverwendbare Vorlage speichern">⭐ Als Vorlage</button>`}
        <button class="btn btn-primary" id="saSave" style="margin-left:8px">${s.isTemplate?"💾 Vorlage speichern":"💾 Aufgabe speichern"}</button></div>
      <div class="field"><label>${s.isTemplate?"Titel der Vorlage":"Titel der Aufgabe"}</label><input class="input" id="saTitle" maxlength="120" value="${esc(s.title)}"></div>
      <div class="field" style="margin-bottom:${s.isTemplate?"0":"10px"}"><label>Beschreibung (optional)</label><textarea class="input" id="saDesc" style="min-height:54px">${esc(s.description)}</textarea></div>
      ${s.isTemplate?"":`<label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;cursor:pointer"><input type="checkbox" id="saPub" ${s.published?"checked":""}> 🚀 Veröffentlicht (für Schüler:innen sichtbar)</label>`}
    </div>
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px">Teilaufgaben</h3>
      <div id="saSubList">${subList}</div>
      <button class="btn btn-ghost btn-sm" id="saAddSub" style="margin-top:4px;width:100%">+ Teilaufgabe</button>
    </div>
    <div class="card" id="saRight"></div>`;
  document.getElementById("back").onclick = ()=>{ syncSqlSubtask(); s.isTemplate?sqlTemplatesPage():sqlTeacherClassView(s.classId); };
  document.getElementById("saTitle").oninput = (e)=>{ s.title=e.target.value; };
  document.getElementById("saDesc").oninput = (e)=>{ s.description=e.target.value; };
  { const pb=document.getElementById("saPub"); if(pb) pb.onchange=(e)=>{ s.published=e.target.checked; }; }
  document.getElementById("saDb").onchange = async (e)=>{ syncSqlSubtask(); const v=e.target.value; if(!v){ s.databaseId=null; renderSqlSubtaskPane(); return; } s.databaseId=v; try{ const d=await api.sqlGetDatabase(v); s.dbText=d.sql_text||""; }catch(err){} renderSqlSubtaskPane(); };
  document.getElementById("saSave").onclick = s.isTemplate?saveSqlTemplateFromEditor:saveSqlAssignment;
  { const tb=document.getElementById("saTpl"); if(tb) tb.onclick=saveSqlTemplate; }
  document.getElementById("saAddSub").onclick = ()=>{ syncSqlSubtask(); s.subtasks.push({ prompt:"", solution_sql:"", compare:true, ordered:false }); s.selected=s.subtasks.length-1; renderSqlAssignEditor(); };
  document.querySelectorAll("#saSubList .sqedit").forEach(row=> row.onclick=(e)=>{ if(e.target.closest("[data-up],[data-down],[data-delsub]")) return; selectSqlSubtask(+row.dataset.i); });
  document.querySelectorAll("#saSubList [data-up]").forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); const i=+b.dataset.up; if(i<=0) return; syncSqlSubtask(); const a=s.subtasks; [a[i-1],a[i]]=[a[i],a[i-1]]; s.selected=i-1; renderSqlAssignEditor(); });
  document.querySelectorAll("#saSubList [data-down]").forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); const i=+b.dataset.down; if(i>=s.subtasks.length-1) return; syncSqlSubtask(); const a=s.subtasks; [a[i+1],a[i]]=[a[i],a[i+1]]; s.selected=i+1; renderSqlAssignEditor(); });
  document.querySelectorAll("#saSubList [data-delsub]").forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); const i=+b.dataset.delsub; if(s.subtasks.length<=1){ toast("Mindestens eine Teilaufgabe ist nötig.","err"); return; } if(!confirm("Teilaufgabe "+(i+1)+" löschen?")) return; syncSqlSubtask(); const rem=s.subtasks[i]; if(rem.id) s.deletedIds.push(rem.id); s.subtasks.splice(i,1); if(i<s.selected) s.selected--; if(s.selected>=s.subtasks.length) s.selected=s.subtasks.length-1; if(s.selected<0) s.selected=0; renderSqlAssignEditor(); });
  renderSqlSubtaskPane();
}
function renderSqlSubtaskPane(){
  const s=sqlAssignState, st=s.subtasks[s.selected], right=document.getElementById("saRight");
  if(!right) return;
  if(!st){ right.innerHTML='<div class="empty">Füge links eine Teilaufgabe hinzu.</div>'; return; }
  right.innerHTML = `
    <div class="field"><label>Aufgabentext – Teilaufgabe ${s.selected+1}</label><textarea class="input" id="stPrompt" style="min-height:70px" placeholder="z. B. Gib die Namen aller Bewohner aus, die Bäcker sind.">${esc(st.prompt)}</textarea></div>
    <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:6px"><input type="checkbox" id="stCompare" ${st.compare?"checked":""}> Ergebnis mit Musterlösung vergleichen</label>
    <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:12px;${st.compare?'':'opacity:.45'}"><input type="checkbox" id="stOrdered" ${st.ordered?"checked":""} ${st.compare?'':'disabled'}> Zeilen-Reihenfolge muss stimmen (bei <code>ORDER BY</code>)</label>
    <div class="muted" style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Musterlösung (SQL)</div>
    <div id="stSqlHost"></div>`;
  document.getElementById("stPrompt").oninput = (e)=>{ st.prompt=e.target.value; const li=document.querySelector(`#saSubList .sqedit[data-i="${s.selected}"] .sqedit-t`); if(li){ const v=(st.prompt||"").trim(); li.textContent=v?v.slice(0,200):"(noch kein Aufgabentext)"; li.title=v; li.classList.toggle("empty",!v); } };
  document.getElementById("stCompare").onchange = (e)=>{ syncSqlSubtask(); st.compare=e.target.checked; renderSqlSubtaskPane(); };
  document.getElementById("stOrdered").onchange = (e)=>{ st.ordered=e.target.checked; };
  if(s.view){ try{ s.view.destroy(); }catch(e){} }
  s.view = new SqlView("#stSqlHost", { dbText:s.dbText, query: st.solution_sql||"", autofill:false, schemaOpen:true });
  pageView = s.view;
}
function syncSqlSubtask(){
  const s=sqlAssignState; if(!s) return; const st=s.subtasks[s.selected]; if(!st) return;
  const p=document.getElementById("stPrompt"); if(p) st.prompt=p.value;
  const c=document.getElementById("stCompare"); if(c) st.compare=c.checked;
  const o=document.getElementById("stOrdered"); if(o) st.ordered=o.checked;
  if(s.view) st.solution_sql=s.view.getQuery();
}
function selectSqlSubtask(i){ syncSqlSubtask(); sqlAssignState.selected=i; renderSqlAssignEditor(); const r=document.getElementById("saRight"); if(r) r.scrollIntoView({behavior:"smooth",block:"start"}); }
// Validiert Teilaufgaben (Aufgabentext + Musterlösung) und füllt st.expected; wirft bei Fehler.
async function computeSqlExpected(s){
  for(let i=0;i<s.subtasks.length;i++){ const st=s.subtasks[i];
    if(!(st.prompt||"").trim()) throw new Error("Teilaufgabe "+(i+1)+": Aufgabentext fehlt.");
    if(st.compare){
      if(!(st.solution_sql||"").trim()) throw new Error("Teilaufgabe "+(i+1)+": Musterlösung fehlt (für den Ergebnisvergleich nötig).");
      let db=null; try{ db=await SqlEngine.run(s.dbText); }catch(e){ throw new Error("Die Datenbank ist fehlerhaft: "+(e.message||e)); }
      let out; try{ out=db.exec(st.solution_sql); }catch(e){ try{db.close();}catch(_){} throw new Error("Teilaufgabe "+(i+1)+": Musterlösung fehlerhaft – "+(e.message||e)); }
      st.expected=SqlEngine.normalize(out, st.ordered); try{ db.close(); }catch(e){}
    } else st.expected=null;
  }
}
async function saveSqlTemplate(){
  const s=sqlAssignState; syncSqlSubtask();
  const title=(s.title||"").trim();
  if(!title){ toast("Bitte zuerst einen Titel eingeben.","err"); return; }
  if(!s.dbText){ toast("Bitte eine Datenbank wählen.","err"); return; }
  if(!s.subtasks.length){ toast("Bitte mindestens eine Teilaufgabe anlegen.","err"); return; }
  const name=prompt("Name der Vorlage:", title); if(name===null) return;
  const btn=document.getElementById("saTpl"); if(btn){ btn.disabled=true; btn.textContent="Prüfe…"; }
  try{ await computeSqlExpected(s); }
  catch(e){ if(btn){ btn.disabled=false; btn.textContent="⭐ Als Vorlage"; } toast(e.message||"Fehler","err"); return; }
  const subtasks=s.subtasks.map(st=>({ prompt:(st.prompt||"").trim(), solution_sql:st.solution_sql||"", compare:!!st.compare, ordered:!!st.ordered, expected:st.expected||null }));
  try{ await api.sqlCreateTemplate({ title:(name.trim()||title), description:(s.description||"").trim()||null, db_snapshot:s.dbText, subtasks });
    toast("Als Vorlage gespeichert ⭐","ok");
  }catch(e){ toast(e.message||"Fehler","err"); }
  finally{ if(btn){ btn.disabled=false; btn.textContent="⭐ Als Vorlage"; } }
}
async function saveSqlTemplateFromEditor(){
  const s=sqlAssignState; syncSqlSubtask();
  const title=(s.title||"").trim();
  if(!title){ toast("Bitte einen Titel eingeben.","err"); return; }
  if(!s.dbText){ toast("Bitte eine Datenbank wählen.","err"); return; }
  if(!s.subtasks.length){ toast("Bitte mindestens eine Teilaufgabe anlegen.","err"); return; }
  const btn=document.getElementById("saSave"); if(btn){ btn.disabled=true; btn.textContent="Prüfe…"; }
  try{ await computeSqlExpected(s); }
  catch(e){ if(btn){ btn.disabled=false; btn.textContent="💾 Vorlage speichern"; } toast(e.message||"Fehler","err"); return; }
  if(btn) btn.textContent="Speichere…";
  const subtasks=s.subtasks.map(st=>({ prompt:(st.prompt||"").trim(), solution_sql:st.solution_sql||"", compare:!!st.compare, ordered:!!st.ordered, expected:st.expected||null }));
  const payload={ title, description:(s.description||"").trim()||null, db_snapshot:s.dbText, subtasks };
  try{ if(s.templateId){ await api.sqlUpdateTemplate(s.templateId, payload); } else { const t=await api.sqlCreateTemplate(payload); s.templateId=t.id; }
    toast("Vorlage gespeichert ⭐","ok"); sqlTemplatesPage();
  }catch(e){ if(btn){ btn.disabled=false; btn.textContent="💾 Vorlage speichern"; } toast(e.message||"Fehler","err"); }
}
async function sqlTemplateEditorPage(existing){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let dbs=[]; try{ dbs=await api.sqlListDatabases(); }catch(e){ dbs=[]; }
  let tpl=null;
  if(existing && existing.id){ try{ tpl=await api.sqlGetTemplate(existing.id); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  sqlAssignState = {
    classId:null, id:null, isTemplate:true, templateId: tpl?tpl.id:null,
    title: tpl?(tpl.title||""):"", description: tpl?(tpl.description||""):"", published:false,
    databaseId:null, dbText: tpl?(tpl.db_snapshot||""):"", dbs,
    subtasks: (tpl&&tpl.subtasks&&tpl.subtasks.length)
      ? tpl.subtasks.map(st=>({ prompt:st.prompt||"", solution_sql:st.solution_sql||"", compare:!!st.compare, ordered:!!st.ordered, expected:st.expected||null }))
      : [{ prompt:"", solution_sql:"", compare:true, ordered:false }],
    selected:0, deletedIds:[], view:null
  };
  try{ SqlEngine.ensureStyles(); }catch(e){}
  renderSqlAssignEditor();
}
async function saveSqlAssignment(){
  const s=sqlAssignState; syncSqlSubtask();
  const title=(s.title||"").trim();
  if(!title){ toast("Bitte einen Titel eingeben.","err"); return; }
  if(!s.dbText){ toast("Bitte eine Datenbank wählen (ggf. erst eine in 🗄️ Datenbanken anlegen).","err"); return; }
  if(!s.subtasks.length){ toast("Bitte mindestens eine Teilaufgabe anlegen.","err"); return; }
  const btn=document.getElementById("saSave"); btn.disabled=true; btn.textContent="Prüfe…";
  // Musterlösungen prüfen + Ergebnis-Snapshot (expected) berechnen
  try{ await computeSqlExpected(s); }
  catch(e){ btn.disabled=false; btn.textContent="💾 Aufgabe speichern"; toast(e.message||"Fehler","err"); return; }
  btn.textContent="Speichere…";
  try{
    let aid=s.id;
    const payload={ class_id:s.classId, title, description:(s.description||"").trim()||null, published:s.published, database_id:s.databaseId, db_snapshot:s.dbText };
    if(aid){ await api.sqlUpdateAssignment(aid, payload); } else { const a=await api.sqlCreateAssignment(payload); aid=a.id; s.id=aid; }
    for(let i=0;i<s.subtasks.length;i++){ const st=s.subtasks[i];
      const sp={ assignment_id:aid, position:i, prompt:(st.prompt||"").trim(), solution_sql:st.solution_sql||"", compare:st.compare, ordered:st.ordered, expected:st.expected||null };
      if(st.id){ await api.sqlUpdateSubtask(st.id, sp); } else { const ins=await api.sqlInsertSubtask(sp); st.id=ins.id; } }
    for(const did of (s.deletedIds||[])){ try{ await api.sqlDeleteSubtask(did); }catch(e){} }
    s.deletedIds=[];
    toast("Aufgabe gespeichert ✓","ok"); sqlTeacherClassView(s.classId);
  }catch(e){ btn.disabled=false; btn.textContent="💾 Aufgabe speichern"; toast(e.message||"Fehler","err"); }
}

/* ============================================================================
   FILIUS – Netzwerksimulator: Klassen, Aufgaben (mit Prüfungen), Abgaben,
   Einsicht, Netzwerk-Bibliothek, Vorlagen, Sandbox. Spiegelt den SQL-Playground.
   ============================================================================ */
function chkId(){ return "c"+Math.random().toString(36).slice(2,8); }
function filiusNetData(v){ return (v && v.getData) ? v.getData() : (v||{nodes:[],links:[]}); }
/* Abgabe IMMER authoritativ gegen die AKTUELLEN Prüfungen auswerten (konsistent in Matrix, Fortschritt, Profil, Einsicht) */
function filiusEvalSub(sub, checks){ if(sub && sub.data && typeof sub.data==="object"){ try{ return FiliusEngine.evalChecks(sub.data, checks||[]); }catch(e){} } return (sub&&sub.results)||{}; }
function filiusPassed(res, checks){ return (checks||[]).length>0 && (checks||[]).every(c=> res[c.id]==="correct"); }

async function filiusTeacherHome(){
  shell(`<div class="center-load"><span class="spin"></span>Klassen werden geladen…</div>`);
  _classActivity=null;
  let classes=[];
  try{ classes = await api.myTeacherClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnFilNets">🌐 Netzwerke</button>
      <button class="btn btn-ghost" id="btnFilTpl" style="margin-left:8px">📋 Vorlagen</button>
      <button class="btn btn-ghost" id="btnFilSbx" style="margin-left:8px">🧪 Sandbox</button>
      <button class="btn btn-primary" id="btnNewClass" style="margin-left:8px">+ Neue Klasse</button></div>
    ${classes.length?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnFilNets").onclick = ()=> filiusNetworksPage({label:"← Netzwerke · Meine Klassen", go:filiusTeacherHome});
  document.getElementById("btnFilTpl").onclick = ()=> filiusTemplatesPage({label:"← Netzwerke · Meine Klassen", go:filiusTeacherHome});
  document.getElementById("btnFilSbx").onclick = ()=> filiusSandbox();
  document.getElementById("btnNewClass").onclick = newClassDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b></div></div>`,
    id=>{ viewFromAdmin=false; filiusTeacherClassView(id); },
    `<div class="empty"><span class="ic">🌐</span>Noch keine Netzwerk-Klassen. Erstelle deine erste Klasse!</div>`);
}
async function filiusStudentHome(){
  shell(`<div class="center-load"><span class="spin"></span>Wird geladen…</div>`);
  _classActivity=null;
  let classes=[];
  try{ classes = await api.myClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!classes.length){
    document.getElementById("view").innerHTML = `
      <div class="page-head"><h2>🌐 Netzwerke</h2><div class="spacer"></div><button class="btn btn-ghost" id="btnFilSbx">🧪 Sandbox</button></div>
      <div class="card" style="max-width:480px;margin:0 auto;text-align:center">
        <div style="font-size:46px">🔑</div>
        <h3 style="margin:6px 0">Tritt deiner Klasse bei</h3>
        <p class="muted" style="margin:0 0 16px">Gib den Code ein, den du von deiner Lehrkraft bekommen hast.</p>
        <div class="field"><input class="input" id="joinCode" placeholder="z. B. K7Q2MX" maxlength="8" style="text-align:center;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-size:22px"></div>
        <button class="btn btn-primary btn-lg" id="btnJoin">Beitreten</button>
      </div>`;
    wireJoin(); { const sx=document.getElementById("btnFilSbx"); if(sx) sx.onclick=()=> filiusSandbox(); } return;
  }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnFilSbx">🧪 Sandbox</button>
      <button class="btn btn-ghost" id="btnJoinMore" style="margin-left:8px">+ Klasse beitreten</button></div>
    ${classes.length?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnFilSbx").onclick = ()=> filiusSandbox();
  document.getElementById("btnJoinMore").onclick = joinDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Aufgaben ansehen →</div></div>`, id=> filiusStudentClassView(id), "");
}

async function filiusTeacherClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Klasse wird geladen…</div>`);
  let cls, roster=[], asgs=[], subs=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data;
    roster = await api.classRoster(classId);
    roster.sort((a,b)=>{ const na=((a.profiles&&(a.profiles.display_name||a.profiles.username))||"").toLowerCase(), nb=((b.profiles&&(b.profiles.display_name||b.profiles.username))||"").toLowerCase(); return na.localeCompare(nb,"de"); });
    asgs = await api.filiusListAssignments(classId);
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!cls){ document.getElementById("view").innerHTML=errBox({message:"Klasse nicht gefunden."}); return; }
  if(asgs.length){ try{ subs = await api.filiusClassSubmissions(asgs.map(a=>a.id)); }catch(e){ subs=[]; } }
  const canTeam=(cls.teacher_id===ME.id||ME.is_admin);
  let teachers=[]; try{ teachers=await api.classTeachersNamed(classId); }catch(e){ teachers=[]; }
  const iAmCoTeacher = !canTeam && teachers.some(t=>t.id===ME.id && !t.is_owner);
  const rosterHtml = roster.length ? `<div class="list">${roster.map(m=>{ const p=m.profiles||{}; const nm=p.display_name||p.username||"?"; return `<div class="row"><span class="chip clickable" data-prof="${m.student_id}" title="Profil ansehen" style="cursor:pointer"><span class="av">${esc(initials(nm))}</span>${esc(nm)}</span><div class="grow"></div><span class="muted" style="font-size:11.5px;margin-right:8px">${fmtDate(m.joined_at)}</span>${canTeam?`<button class="abtn" data-stu="${m.student_id}" data-nm="${esc(nm)}" title="Passwort zurücksetzen">🔑</button><button class="abtn" data-rmstu="${m.student_id}" data-nm="${esc(nm)}" title="aus Klasse entfernen">🗑️</button>`:""}</div>`; }).join("")}</div>`
    : `<div class="empty"><span class="ic">🎒</span>Noch keine Schüler:innen. Teile den Code <b>${esc(cls.code)}</b>!</div>`;
  const asgHtml = asgs.length ? `<div class="list">${asgs.map(a=>`
      <div class="row"><span class="grow"><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="t clickable" data-edit="${a.id}" title="Aufgabe bearbeiten">${esc(a.title)}</span>${a.published?"":'<span class="badge gold">Entwurf</span>'}${a.released?'<span class="badge" title="Muster-Netzwerk für Schüler:innen sichtbar">🏆 Lösung frei</span>':''}</span><span class="s">${(a.checks||[]).length} Prüfung(en) · ${esc(fmtDateTime(a.created_at))}</span></span>
        <span class="acts">
          <button class="abtn" data-up="${a.id}" title="nach oben">↑</button>
          <button class="abtn" data-down="${a.id}" title="nach unten">↓</button>
          <button class="abtn" data-pub="${a.id}" data-on="${a.published?1:0}" title="${a.published?'verbergen (Entwurf)':'veröffentlichen'}">${a.published?'👁️':'🚀'}</button>
          <button class="abtn" data-rel="${a.id}" data-relon="${a.released?1:0}" title="${a.released?'Muster-Netzwerk wieder verbergen':'Muster-Netzwerk für Schüler:innen freigeben'}">${a.released?'🏆':'🔒'}</button>
          <button class="abtn" data-edit="${a.id}" title="bearbeiten">✏️</button>
          <button class="abtn" data-del="${a.id}" title="löschen">🗑️</button>
        </span></div>`).join("")}</div>`
    : `<div class="empty" style="padding:16px"><span class="ic">📝</span>Noch keine Aufgaben.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${viewFromAdmin?"← Admin-Bereich":"← Meine Klassen"}</button><div class="spacer"></div><button class="btn btn-ghost btn-sm" id="btnFilNets2">🌐 Netzwerke</button><button class="btn btn-ghost btn-sm" id="btnFilTpl2" style="margin-left:8px">📋 Vorlagen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls.name)}${canTeam?` <button class="btn btn-ghost btn-sm" id="btnRename" title="Klasse umbenennen" style="vertical-align:middle">✏️</button>`:""}${CLASS_REFRESH_BTN}</h2><div class="spacer"></div>
      <span class="codechip" title="Einlade-Code" style="${cls.join_open===false?'opacity:.55;':''}">🔑 ${esc(cls.code)}${cls.join_open===false?' <span class="badge gray" title="Beitritt mit diesem Code ist deaktiviert">aus</span>':''} <button class="btn btn-sm btn-ghost" id="copyCode" style="margin-left:4px">Kopieren</button></span>
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnCodeToggle" style="margin-left:8px" title="${cls.join_open===false?'Beitritt mit diesem Code wieder erlauben':'Beitritt mit diesem Code deaktivieren'}">${cls.join_open===false?'🔓 Aktivieren':'🚫 Code deaktivieren'}</button><button class="btn btn-ghost btn-sm" id="btnCodeNew" style="margin-left:6px" title="Neuen Code erzeugen – der alte wird ungültig">🔄 Neuer Code</button>`:''}
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnDeleteClass" style="margin-left:8px;color:var(--red-d)" title="Klasse löschen">🗑️ Löschen</button>`:(iAmCoTeacher?`<button class="btn btn-ghost btn-sm" id="btnLeaveClass" style="margin-left:8px;color:var(--red-d)" title="Klasse verlassen">🚪 Klasse verlassen</button>`:"")}</div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">📝 Aufgaben <span class="badge gray">${asgs.length}</span></h3><div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="btnFilFromTpl">📋 aus Vorlage</button><button class="btn btn-blue btn-sm" id="btnNewFilAssign" style="margin-left:8px">+ Aufgabe stellen</button></div>
      <div style="margin-top:12px">${asgHtml}</div></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">📊 Abgabe-Matrix</h3><div style="flex:1"></div>${(asgs.length&&roster.length)?'<button class="btn btn-ghost btn-sm" id="btnFilMatrixMax" title="Matrix im Vollbild öffnen">⛶ Vergrößern</button>':''}</div>
      <div style="margin-top:12px">
        ${(asgs.length&&roster.length)?'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap"><span class="muted" style="font-size:12.5px">🟩 richtig · 🟧 falsch · ⬜ offen · ★ = alle Prüfungen bestanden</span><div style="flex:1"></div><input class="input" id="filMatrixSearch" placeholder="🔍 Schüler:in suchen" style="max-width:240px"></div>':''}
        <div id="filMatrixHost"></div>
      </div></div>
    <div class="card" style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">🎒 Schüler:innen <span class="badge gray">${roster.length}</span></h3><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnFilImport">📥 Importieren</button>':''}</div><div style="margin-top:12px">${rosterHtml}</div></div>
    <div class="card" style="margin-bottom:16px"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">👩‍🏫 Lehrkräfte <span class="badge gray">${teachers.length}</span></h3><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnTeachers">+ verwalten</button>':''}</div>
      <div class="list" style="margin-top:12px">${teachers.length?teachers.map(t=>`<div class="row"><span class="chip"><span class="av">${esc(initials(t.display_name||t.username))}</span>${esc(t.display_name||t.username)}</span><div class="grow"></div>${t.is_owner?'<span class="badge blue">Ersteller:in</span>':'<span class="badge gray">Co-Lehrkraft</span>'}</div>`).join(""):'<div class="muted" style="font-size:13px">—</div>'}</div></div>`;
  document.getElementById("back").onclick = ()=> (viewFromAdmin?adminHome():filiusTeacherHome());
  document.getElementById("copyCode").onclick = ()=>{ if(navigator.clipboard) navigator.clipboard.writeText(cls.code); toast("Code kopiert: "+cls.code,"ok"); };
  { const bd=document.getElementById("btnDeleteClass"); if(bd) bd.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich löschen? Alle Aufgaben und Zuordnungen werden entfernt.`)) return; try{ await api.deleteClass(classId); toast("Klasse gelöscht","ok"); (viewFromAdmin?adminHome():filiusTeacherHome()); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const br=document.getElementById("btnRename"); if(br) br.onclick=()=> renameClassDialog(classId, cls.name, cls.tool); }
  wireClassRefresh(()=> filiusTeacherClassView(classId));
  { const bt=document.getElementById("btnCodeToggle"); if(bt) bt.onclick=async()=>{ const disabling=(cls.join_open!==false); if(disabling){ if(!confirm(`Beitritt für „${cls.name}" deaktivieren?\n\nMit dem Code ${cls.code} kann danach niemand mehr neu beitreten. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; } try{ await api.setClassJoinOpen(classId, !disabling); toast(disabling?"Beitritt deaktiviert 🚫":"Beitritt wieder aktiv 🔓","ok"); filiusTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bn=document.getElementById("btnCodeNew"); if(bn) bn.onclick=async()=>{ if(!confirm(`Neuen Einlade-Code für „${cls.name}" erzeugen?\n\nDer bisherige Code ${cls.code} wird sofort ungültig – verteile danach den neuen Code. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; try{ const nc=await api.regenerateClassCode(classId); toast("Neuer Code: "+nc,"ok"); filiusTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bl=document.getElementById("btnLeaveClass"); if(bl) bl.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich verlassen? Du bist danach keine Co-Lehrkraft mehr und siehst die Klasse nicht mehr.`)) return; try{ await api.removeClassTeacher(classId, ME.id); toast("Klasse verlassen","ok"); filiusTeacherHome(); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bt=document.getElementById("btnTeachers"); if(bt) bt.onclick=()=> classTeachersDialog(classId, cls); }
  document.getElementById("btnFilNets2").onclick = ()=> filiusNetworksPage({label:"← zurück zur Klasse", go:()=> filiusTeacherClassView(classId)});
  document.getElementById("btnFilTpl2").onclick = ()=> filiusTemplatesPage({label:"← zurück zur Klasse", go:()=> filiusTeacherClassView(classId)});
  { const bi=document.getElementById("btnFilImport"); if(bi) bi.onclick=()=> importStudentsDialog(classId, cls.code, ()=>filiusTeacherClassView(classId)); }
  document.querySelectorAll(".chip[data-prof]").forEach(b=> b.onclick=()=>{ const m=roster.find(r=>r.student_id===b.dataset.prof); const p=(m&&m.profiles)||{}; filiusStudentProfilePage(classId, b.dataset.prof, p.display_name||p.username||"?", p.username||""); });
  document.querySelectorAll("[data-stu]").forEach(b=> b.onclick=()=> resetStudentPw(b.dataset.stu, b.dataset.nm));
  document.querySelectorAll("[data-rmstu]").forEach(b=> b.onclick=async()=>{ if(!confirm(b.dataset.nm+" aus dieser Klasse entfernen? (Der Account bleibt bestehen.)")) return; try{ await api.removeMembership(classId, b.dataset.rmstu); toast("Entfernt","ok"); filiusTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.getElementById("btnNewFilAssign").onclick = ()=> filiusAssignmentEditorPage(classId, null);
  document.getElementById("btnFilFromTpl").onclick = ()=> filiusPickTemplate(classId);
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=> filiusAssignmentEditorPage(classId, {id:b.dataset.edit}));
  document.querySelectorAll("[data-up]").forEach(b=> b.onclick=async()=>{ await moveFiliusAssignment(asgs, b.dataset.up, -1); filiusTeacherClassView(classId); });
  document.querySelectorAll("[data-down]").forEach(b=> b.onclick=async()=>{ await moveFiliusAssignment(asgs, b.dataset.down, 1); filiusTeacherClassView(classId); });
  document.querySelectorAll("[data-pub]").forEach(b=> b.onclick=async()=>{ try{ await api.filiusUpdateAssignment(b.dataset.pub,{published:b.dataset.on!=="1"}); filiusTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-rel]").forEach(b=> b.onclick=async()=>{ const on=b.dataset.relon==="1"; if(!on && !confirm("Muster-Netzwerk dieser Aufgabe für ALLE Schüler:innen sichtbar machen?")) return; try{ await api.filiusUpdateAssignment(b.dataset.rel,{released:!on}); toast(on?"Muster-Netzwerk verborgen 🔒":"Muster-Netzwerk freigegeben 🏆","ok"); filiusTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Aufgabe wirklich löschen?")) return; try{ await api.filiusDeleteAssignment(b.dataset.del); filiusTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  const paintFilMatrixInto=(host, q, close)=>{ if(!host) return;
    host.innerHTML = (asgs.length&&roster.length) ? buildFiliusMatrix(roster, asgs, subs, q)
      : `<div class="empty"><span class="ic">📊</span>${!asgs.length?"Stelle Aufgaben – dann erscheint hier, wer welche Prüfungen bestanden hat.":"Noch keine Schüler:innen in der Klasse."}</div>`;
    host.querySelectorAll(".sqcell[data-aid]").forEach(c=> c.onclick=()=>{ const stu=roster.find(r=>r.student_id===c.dataset.sid); const nm=(stu&&stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?"; if(close) close(); filiusReviewSubmission(c.dataset.aid, c.dataset.sid, nm, classId); });
  };
  paintFilMatrixInto(document.getElementById("filMatrixHost"), "", null);
  { const ms=document.getElementById("filMatrixSearch"); if(ms) ms.oninput=()=> paintFilMatrixInto(document.getElementById("filMatrixHost"), ms.value, null); }
  { const bx=document.getElementById("btnFilMatrixMax"); if(bx) bx.onclick=()=> openMatrixModal("📊 Abgabe-Matrix – "+cls.name, (host,q,close)=> paintFilMatrixInto(host,q,close)); }
}
function buildFiliusMatrix(roster, asgs, subs, q){
  q=(q||"").trim().toLowerCase();
  const nmeOf=stu=>(stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?";
  const list = q ? roster.filter(stu=> nmeOfSafe(nmeOf(stu)).includes(q)) : roster;
  if(!list.length) return `<div class="empty" style="padding:16px"><span class="ic">🔍</span>Keine Schüler:in gefunden.</div>`;
  const head = asgs.map(a=>`<th title="${esc(a.title)}">${esc(a.title.length>14?a.title.slice(0,13)+"…":a.title)}</th>`).join("");
  const seg=(n,color)=> n>0?`<div style="flex:${n};background:${color}"></div>`:"";
  const rows = list.map(stu=>{
    const cells = asgs.map(a=>{
      const ids=(a.checks||[]).map(c=>c.id); const total=ids.length;
      if(!total) return `<td><span class="muted" style="font-size:13px" title="Aufgabe hat noch keine Prüfungen">—</span></td>`;
      const sub = subs.find(x=>x.assignment_id===a.id && x.student_id===stu.student_id);
      if(!sub) return `<td><span title="noch nicht bearbeitet (${total} Prüfungen)" style="color:var(--muted);font-weight:900">·</span></td>`;
      const res=filiusEvalSub(sub, a.checks); let g=0,y=0; for(const id of ids){ const st=res[id]; if(st==="correct") g++; else if(st==="wrong") y++; }
      const grey=total-g-y, done=(g===total);
      const bar=`<div style="display:flex;height:7px;width:56px;border-radius:4px;overflow:hidden;margin:0 auto 3px;background:var(--line2)">${seg(g,"var(--green)")}${seg(y,"var(--gold)")}${seg(grey,"var(--line2)")}</div>`;
      const cap=`<span style="font-size:11.5px;font-weight:800;color:${done?'var(--green-d)':'var(--muted)'}">${g}/${total}${done?' ★':''}</span>`;
      const title=`✓ ${g} richtig · ✗ ${y} falsch · · ${grey} offen (von ${total})`;
      return `<td><span class="sqcell" data-aid="${a.id}" data-sid="${stu.student_id}" title="${esc(title)} – Abgabe ansehen" style="display:inline-block;min-width:60px;text-align:center;cursor:pointer">${bar}${cap}</span></td>`;
    }).join("");
    return `<tr><td class="stu">${esc(nmeOf(stu))}</td>${cells}</tr>`;
  }).join("");
  return `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="stu">Schüler:in</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function filiusStudentClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let cls, asgs=[], subs=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data;
    asgs = await api.filiusStudentAssignments(classId);
    subs = await api.filiusMySubmissions(asgs.map(a=>a.id));
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  let coms=[]; try{ if(subs.length) coms = await api.filiusClassComments(subs.map(x=>x.id)); }catch(e){}   // freigegebene Rückmeldungen
  const feedback=(a)=>{ const s=subs.find(x=>x.assignment_id===a.id); const c=s?coms.find(x=>x.submission_id===s.id&&x.released):null; return c?feedbackPreviewHtml(c.body):""; };
  const badge=(a)=>{ const s=subs.find(x=>x.assignment_id===a.id); if(!s) return '<span class="badge gray">offen</span>'; return filiusPassed(filiusEvalSub(s,a.checks), a.checks)?'<span class="badge">bestanden ✓</span>':'<span class="badge gold">in Bearbeitung</span>'; };
  const progress=(a)=>{ const ids=(a.checks||[]).map(c=>c.id), total=ids.length; if(!total) return ""; const sub=subs.find(x=>x.assignment_id===a.id), res=sub?filiusEvalSub(sub,a.checks):{}; let g=0,y=0; for(const id of ids){ const st=res[id]; if(st==="correct")g++; else if(st==="wrong")y++; } const grey=total-g-y; const seg=(n,c)=> n>0?`<div style="flex:${n};background:${c}"></div>`:""; return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px"><div style="display:flex;height:7px;flex:1;max-width:170px;border-radius:4px;overflow:hidden;background:var(--line2)">${seg(g,"var(--green)")}${seg(y,"var(--gold)")}${seg(grey,"var(--line2)")}</div><span class="muted" style="font-size:11.5px;font-weight:800">${g}/${total}</span></div>`; };
  const list = asgs.length ? `<div class="list">${asgs.map(a=>`
      <div class="row clickrow" data-id="${a.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(a.title)}</span>${a.description?`<span class="s">${esc(a.description.slice(0,70))}</span>`:""}${feedback(a)}${progress(a)}</span>${badge(a)}<span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📝</span>Noch keine Aufgaben. Schau später wieder rein!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls?cls.name:"Klasse")}${CLASS_REFRESH_BTN}</h2></div>
    ${list}`;
  document.getElementById("back").onclick = filiusStudentHome;
  wireClassRefresh(()=> filiusStudentClassView(classId));
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=()=> filiusSolveAssignment(r.dataset.id));
}

/* ---------- FILIUS: Aufgabe lösen (Schüler:innen) ---------- */
let filiusSolveState=null;
async function filiusSolveAssignment(assignmentId){
  shell(`<div class="center-load"><span class="spin"></span>Aufgabe wird geladen…</div>`);
  let a, submission=null;
  try{ a=await api.filiusGetAssignment(assignmentId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!a){ document.getElementById("view").innerHTML=errBox({message:"Aufgabe nicht gefunden."}); return; }
  try{ submission=await api.filiusGetMySubmission(assignmentId); }catch(e){}
  let comment=null; if(submission){ try{ comment=await api.filiusGetComment(submission.id); }catch(e){} }
  filiusSolveState={
    a, checks:a.checks||[], classId:a.class_id,
    data: (submission&&submission.data&&(submission.data.nodes||[]).length!==undefined && (submission.data.nodes||submission.data.links)) ? submission.data : (a.net_snapshot||{nodes:[],links:[]}),
    results:(submission&&submission.results)||{},
    teacherComment:(comment&&comment.body)||"", released:!!a.released, view:null
  };
  try{ FiliusView.ensureStyles(); }catch(e){}
  renderFiliusSolve();
}
function filiusChecksListHtml(checks, results){
  if(!checks.length) return '<div class="muted" style="font-size:13px">Diese Aufgabe hat keine Prüfungen – bau das Netzwerk laut Aufgabenstellung.</div>';
  return `<div class="list">${checks.map(c=>`<div class="row" style="padding:9px 12px"><span class="sicon" data-chk="${c.id}" style="width:18px;text-align:center">${sqlStatusIcon(results[c.id])}</span><span class="grow"><span class="t" style="font-weight:700;font-size:13.5px">${esc(FiliusEngine.checkLabel(c))}</span></span></div>`).join("")}</div>`;
}
function renderFiliusSolve(){
  const s=filiusSolveState;
  const passed = s.checks.length>0 && s.checks.every(c=> s.results[c.id]==="correct");
  const statusHtml = Object.keys(s.results).length? (passed?'<span class="badge">bestanden ✓</span>':'<span class="badge gold">in Bearbeitung</span>') : '<span class="badge gray">offen</span>';
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Zur Klasse</button><div class="spacer"></div><span id="filSolveStatus">${statusHtml}</span></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(s.a.title)}</h2></div>
    ${s.a.description?`<div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13.5px;white-space:pre-wrap">${esc(s.a.description)}</span></div>`:""}
    ${s.teacherComment?`<div class="card" style="margin-bottom:12px;padding:12px 16px;border-left:4px solid var(--gold)"><b>💬 Rückmeldung deiner Lehrkraft:</b><div style="margin-top:4px;white-space:pre-wrap">${esc(s.teacherComment)}</div></div>`:""}
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0">✅ Prüfungen</h3><div style="flex:1"></div>
        ${(s.released)?`<button class="btn btn-ghost btn-sm" id="filShowSol">🏆 Muster-Netzwerk</button>`:""}
        <button class="btn btn-primary btn-sm" id="filCheck">🔍 Netzwerk prüfen &amp; speichern</button></div>
      <div id="filChkList" style="margin-top:10px">${filiusChecksListHtml(s.checks, s.results)}</div>
      <span id="filSolveMsg" class="muted" style="display:block;margin-top:8px;font-size:13px"></span>
    </div>
    <div id="filSolveHost"></div>`;
  document.getElementById("back").onclick = ()=> filiusStudentClassView(s.classId);
  if(s.view){ try{ s.view.destroy(); }catch(e){} }
  s.view = new FiliusView("#filSolveHost", { data:s.data, height:"58vh" });
  pageView=s.view;
  document.getElementById("filCheck").onclick = filiusRunChecksAndSave;
  { const bs=document.getElementById("filShowSol"); if(bs) bs.onclick=filiusShowSolution; }
}
async function filiusRunChecksAndSave(){
  const s=filiusSolveState; const net=s.view.getData();
  const btn=document.getElementById("filCheck"); btn.disabled=true; btn.textContent="Prüfe…";
  let results={}; try{ results=FiliusEngine.evalChecks(net, s.checks); }catch(e){ results={}; }
  s.results=results; s.data=net;
  const passed = s.checks.length>0 && s.checks.every(c=> results[c.id]==="correct");
  try{ await api.filiusSaveSubmission(s.a.id, net, results, passed); }
  catch(e){ btn.disabled=false; btn.textContent="🔍 Netzwerk prüfen & speichern"; toast(e.message||"Fehler","err"); return; }
  btn.disabled=false; btn.textContent="🔍 Netzwerk prüfen & speichern";
  document.querySelectorAll("#filChkList .sicon").forEach(el=>{ const id=el.dataset.chk; el.innerHTML=sqlStatusIcon(results[id]); });
  const okN=s.checks.filter(c=>results[c.id]==="correct").length;
  document.getElementById("filSolveStatus").innerHTML = passed?'<span class="badge">bestanden ✓</span>':'<span class="badge gold">in Bearbeitung</span>';
  const msg=document.getElementById("filSolveMsg"); if(msg) msg.textContent = passed?`Super – alle ${s.checks.length} Prüfungen bestanden! 🎉` : `${okN} von ${s.checks.length} Prüfungen bestanden – gespeichert.`;
  toast(passed?"Alles richtig! ✓":"Gespeichert","ok");
}
async function filiusShowSolution(){
  const s=filiusSolveState; let data=null;
  try{ data=await api.filiusSolutionForStudent(s.a.id); }catch(e){}
  if(!data){ toast("Kein Muster-Netzwerk verfügbar.","err"); return; }
  const bg=openModal(`<button class="x" onclick="closeModal()">✕</button><h3>🏆 Muster-Netzwerk</h3><p class="muted" style="font-size:12px;margin:0 0 8px">So könnte das Netzwerk aussehen – du kannst es ansehen und im Simulationsmodus testen.</p><div id="filSolHost"></div>`, true);
  modalView = new FiliusView("#filSolHost", { data:data, readonly:true, height:"56vh" });
}

/* ---------- FILIUS: Lehrer-Einsicht in eine Abgabe ---------- */
let filiusReviewState=null;
async function filiusReviewSubmission(assignmentId, studentId, studentName, classId){
  shell(`<div class="center-load"><span class="spin"></span>Abgabe wird geladen…</div>`);
  let a, submission=null;
  try{ a=await api.filiusGetAssignment(assignmentId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!a){ document.getElementById("view").innerHTML=errBox({message:"Aufgabe nicht gefunden."}); return; }
  try{ submission=await api.filiusGetSubmission(assignmentId, studentId); }catch(e){}
  let comment=null; if(submission){ try{ comment=await api.filiusGetComment(submission.id); }catch(e){} }
  const net = (submission&&submission.data)||{nodes:[],links:[]};
  const checks=a.checks||[];
  const results = submission ? FiliusEngine.evalChecks(net, checks) : {};   // authoritativ neu auswerten
  filiusReviewState={ assignmentId, classId, studentId, studentName, checks, net, results,
    passed: submission? filiusPassed(results, checks) : null, updatedAt: submission?submission.updated_at:null,
    submissionId: submission?submission.id:null, comment, title:a.title, description:a.description||"", view:null };
  try{ FiliusView.ensureStyles(); }catch(e){}
  renderFiliusReview();
}
function renderFiliusReview(){
  const s=filiusReviewState;
  const statusBadge = s.passed===true?'<span class="badge">bestanden ✓</span>':(s.updatedAt?'<span class="badge gold">in Bearbeitung</span>':'<span class="badge gray">keine Abgabe</span>');
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Zur Klasse</button><div class="spacer"></div>${statusBadge}${s.updatedAt?`<span class="muted" style="font-size:12px;margin-left:8px">${esc(fmtDateTime(s.updatedAt))}</span>`:''}</div>
    <div class="page-head" style="margin-top:0"><h2>Abgabe von ${esc(s.studentName)}</h2></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><b>Aufgabe:</b> ${esc(s.title)}${s.description?` – <span class="muted">${esc(s.description)}</span>`:''}
      <span class="muted" style="font-size:12px;display:block;margin-top:4px">👀 Einsicht: Du siehst das gebaute Netzwerk der/des Schüler:in. Wechsle in den ▶ Simulationsmodus, um selbst zu pingen. Die Prüfungen werden hier verlässlich neu ausgewertet.</span></div>
    <div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 10px">✅ Prüfungen</h3>${filiusChecksListHtml(s.checks, s.results)}</div>
    <div id="filRevHost"></div>
    ${s.submissionId?`<div class="card" style="margin-top:14px">
      <h3 style="margin:0 0 8px">💬 Rückmeldung an ${esc(s.studentName)}</h3>
      <textarea class="input" id="filRevComment" style="min-height:70px" placeholder="Kommentar zu dieser Abgabe…">${esc((s.comment&&s.comment.body)||"")}</textarea>
      <div style="display:flex;gap:12px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <label style="display:flex;gap:8px;align-items:center;font-weight:800;cursor:pointer"><input type="checkbox" id="filRevRelease" style="width:18px;height:18px" ${s.comment&&s.comment.released?'checked':''}> Für Schüler:in sichtbar</label>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" id="filRevDelete" style="${s.comment?'':'display:none'}">Löschen</button>
        <button class="btn btn-primary" id="filRevSave">Kommentar speichern</button>
      </div>
      <span id="filRevMsg" class="muted" style="display:block;margin-top:6px">${s.comment?(s.comment.released?'Für Schüler:in sichtbar ✓':'Gespeichert (noch nicht freigegeben)'):''}</span>
    </div>`:''}`;
  document.getElementById("back").onclick = ()=> filiusTeacherClassView(s.classId);
  if(s.view){ try{ s.view.destroy(); }catch(e){} }
  s.view = new FiliusView("#filRevHost", { data:s.net, readonly:true, height:"56vh" });
  pageView=s.view;
  { const sv=document.getElementById("filRevSave"); if(sv) sv.onclick=async()=>{ const body=(document.getElementById("filRevComment").value||"").trim(); const released=document.getElementById("filRevRelease").checked; if(!body){ toast("Bitte einen Kommentar eingeben.","err"); return; } sv.disabled=true; sv.textContent="Speichere…"; try{ s.comment=await api.filiusSaveComment(s.submissionId, body, released); document.getElementById("filRevDelete").style.display=""; document.getElementById("filRevMsg").textContent=released?"Für Schüler:in sichtbar ✓":"Gespeichert (noch nicht freigegeben)"; toast("Kommentar gespeichert ✓","ok"); }catch(e){ toast(e.message||"Fehler","err"); } finally{ sv.disabled=false; sv.textContent="Kommentar speichern"; } }; }
  { const dl=document.getElementById("filRevDelete"); if(dl) dl.onclick=async()=>{ if(!s.submissionId||!s.comment) return; if(!confirm("Kommentar löschen?")) return; try{ await api.filiusDeleteComment(s.submissionId); s.comment=null; document.getElementById("filRevComment").value=""; document.getElementById("filRevRelease").checked=false; dl.style.display="none"; document.getElementById("filRevMsg").textContent="Kommentar gelöscht."; toast("Gelöscht","ok"); }catch(e){ toast(e.message||"Fehler","err"); } }; }
}

/* ---------- FILIUS: Schüler-Profil (Lehrer-Ansicht) ---------- */
async function filiusStudentProfilePage(classId, studentId, studentName, username){
  shell(`<div class="center-load"><span class="spin"></span>Profil…</div>`);
  let asgs=[], subs=[], note=null, overview=null;
  try{
    asgs = await api.filiusListAssignments(classId);
    if(asgs.length){ subs = (await api.filiusClassSubmissions(asgs.map(a=>a.id))).filter(s=>s.student_id===studentId); }
    try{ note = await api.getStudentNote(classId, studentId); }catch(e){}
    try{ overview = await api.studentOverview(studentId); }catch(e){}
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const lastLogin = (overview&&overview.last_login)?fmtDateTime(overview.last_login):"—";
  const subByA = id=> subs.find(s=>s.assignment_id===id);
  const passCount = asgs.filter(a=>{ const s=subByA(a.id); return s && filiusPassed(filiusEvalSub(s,a.checks), a.checks); }).length;
  const doneCount = asgs.filter(a=> !!subByA(a.id)).length;
  const _ts = subs.map(s=>s.updated_at).filter(Boolean).sort(); const lastAct=_ts.length?fmtDateTime(_ts[_ts.length-1]):"—";
  const aRows = asgs.length ? asgs.map(a=>{
    const ids=(a.checks||[]).map(c=>c.id), total=ids.length, s=subByA(a.id), res=s?filiusEvalSub(s,a.checks):{};
    let g=0; for(const id of ids){ if(res[id]==="correct") g++; }
    const badge = !s ? '<span class="badge gray">offen</span>' : (filiusPassed(res,a.checks)?'<span class="badge">bestanden ✓</span>':'<span class="badge gold">in Bearbeitung</span>');
    const quote = total?` <span class="muted" style="font-size:12px">${g}/${total}</span>`:"";
    const open = s?`<button class="btn btn-sm btn-ghost" data-aopen="${a.id}">ansehen</button>`:"";
    return `<div class="row"><span class="grow"><span class="t">${esc(a.title)}${quote}</span></span>${badge}${open}</div>`;
  }).join("") : `<div class="muted" style="font-size:13px">Keine Aufgaben.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2><span class="chip" style="font-size:16px"><span class="av">${esc(initials(studentName))}</span>${esc(studentName)}</span></h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));margin-bottom:14px">
      <div class="card"><div class="meta">🪪 Benutzername</div><div style="font-weight:900;margin-top:4px"><code>${esc(username||"—")}</code></div></div>
      <div class="card"><div class="meta">🕐 Zuletzt eingeloggt</div><div style="font-weight:900;margin-top:4px">${esc(lastLogin)}</div></div>
      <div class="card"><div class="meta">⚡ Letzte Netzwerk-Abgabe</div><div style="font-weight:900;margin-top:4px">${esc(lastAct)}</div></div>
      <div class="card"><div class="meta">✅ Fortschritt</div><div style="font-weight:900;margin-top:4px">${passCount} bestanden · ${doneCount}/${asgs.length} bearbeitet</div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 10px">📋 Aufgaben</h3><div class="list">${aRows}</div></div>
    <div class="card"><h3 style="margin:0 0 8px">📝 Notizen zu ${esc(studentName)} <span class="muted" style="font-weight:600;font-size:12px">(privat – nur Lehrkräfte)</span></h3>
      <textarea class="input" id="snNote" style="min-height:90px" placeholder="Notizen zu ${esc(studentName)}…">${esc(note?note.body:"")}</textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px"><button class="btn btn-primary" id="snSave">Notiz speichern</button><span id="snMsg" class="muted" style="font-size:13px">${note&&note.updated_at?("zuletzt: "+esc(fmtDateTime(note.updated_at))):""}</span></div></div>`;
  document.getElementById("back").onclick = ()=> filiusTeacherClassView(classId);
  document.querySelectorAll("[data-aopen]").forEach(b=> b.onclick=()=> filiusReviewSubmission(b.dataset.aopen, studentId, studentName, classId));
  document.getElementById("snSave").onclick=async()=>{ const body=document.getElementById("snNote").value; const btn=document.getElementById("snSave"); btn.disabled=true; btn.textContent="Speichere…"; try{ await api.saveStudentNote(classId, studentId, body); document.getElementById("snMsg").textContent="gespeichert ✓"; toast("Notiz gespeichert ✓","ok"); }catch(e){ toast(e.message||"Fehler","err"); } finally{ btn.disabled=false; btn.textContent="Notiz speichern"; } };
}

/* ---------- FILIUS: Netzwerk-Bibliothek ---------- */
async function filiusNetworksPage(back){
  const b = subBack(filiusNetworksPage, back) || {label:"← Netzwerke · Meine Klassen", go:filiusTeacherHome};
  shell(`<div class="center-load"><span class="spin"></span>Netzwerke…</div>`);
  let list=[]; try{ list=await api.filiusListNetworks(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const rows = list.length ? `<div class="list">${list.map(d=>`
      <div class="row clickrow" data-open="${d.id}" style="cursor:pointer">
        <span class="grow"><span class="t">${esc(d.name)}</span><span class="s">von ${esc(d.owner_name)}${d.mine?" (du)":""} · ${d.shared?"🌍 geteilt":"🔒 privat"} · ${esc(fmtDateTime(d.updated_at))}</span></span>
        ${(d.mine||ME.is_admin)?`<button class="btn btn-sm btn-ghost" data-del="${d.id}" data-nm="${esc(d.name)}" title="löschen">🗑️</button>`:""}
        <span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🌐</span>Noch keine Netzwerke. Lege dein erstes an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>🌐 Netzwerke</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewNet">+ Neues Netzwerk</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Wiederverwendbare Start-Netzwerke für Aufgaben. <b>Geteilte</b> Netzwerke können andere Lehrkräfte nutzen und stehen <b>allen in der 🧪 Sandbox</b> zur Verfügung; <b>private</b> nur dir.</span></div>
    ${rows}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewNet").onclick = ()=> filiusNetworkEditorPage(null);
  document.querySelectorAll(".clickrow[data-open]").forEach(r=> r.onclick=(e)=>{ if(e.target.closest("[data-del]")) return; const d=list.find(x=>x.id===r.dataset.open); filiusNetworkEditorPage(d); });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async(e)=>{ e.stopPropagation(); if(!confirm(`Netzwerk „${b.dataset.nm}" wirklich löschen?`)) return; try{ await api.filiusDeleteNetwork(b.dataset.del); toast("Netzwerk gelöscht","ok"); filiusNetworksPage(); }catch(err){ toast(err.message||"Fehler","err"); } });
}
async function filiusNetworkEditorPage(meta){
  const isNew=!meta, canEdit=isNew||!!meta.mine||ME.is_admin;
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let data={nodes:[],links:[]}, name="", shared=false;
  if(!isNew){ try{ const d=await api.filiusGetNetwork(meta.id); data=d.data||{nodes:[],links:[]}; name=d.name||""; shared=!!d.shared; }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  try{ FiliusView.ensureStyles(); }catch(e){}
  const title=isNew?"Neues Netzwerk":(canEdit?"Netzwerk bearbeiten":esc(name));
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Netzwerke</button><div class="spacer"></div>
      <input type="file" id="netFile" accept=".json,.fnet" style="display:none">
      ${canEdit?`<button class="btn btn-ghost btn-sm" id="netOpen" title="Netzwerk aus Datei laden">📂</button>`:""}
      <button class="btn btn-ghost btn-sm" id="netDl" style="margin-left:6px" title="als .json herunterladen">⬇️</button></div>
    <div class="page-head" style="margin-top:0"><h2>🌐 ${title}</h2>${(!canEdit&&meta)?`<span class="badge gray" style="margin-left:8px;align-self:center">von ${esc(meta.owner_name)} · nur ansehen</span>`:""}</div>
    <div class="card" style="margin-bottom:14px">
      <div class="field" style="margin-bottom:${canEdit?"12px":"0"}"><label>Name</label><input class="input" id="netName" maxlength="80" value="${esc(name)}" ${canEdit?"":"disabled"}></div>
      ${canEdit?`<label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;cursor:pointer"><input type="checkbox" id="netShared" ${shared?"checked":""}> 🌍 Freigeben – andere Lehrkräfte können es nutzen und es steht allen in der 🧪 Sandbox zur Verfügung</label>`:""}
    </div>
    <div id="netHost"></div>
    ${canEdit?`<div style="margin-top:14px"><button class="btn btn-primary btn-lg" id="netSave" style="max-width:280px">💾 Netzwerk speichern</button></div>`:""}`;
  document.getElementById("back").onclick = ()=> filiusNetworksPage();   // Pfeil-Wrapper: Klick-Event darf NICHT als back-Parameter durchrutschen
  pageView = new FiliusView("#netHost", { data:data, readonly:!canEdit, height:"60vh" });
  document.getElementById("netDl").onclick = ()=>{ const nm=((document.getElementById("netName").value||"").trim()||"netzwerk").replace(/[^\w.\- ]+/g,"_")+".json"; const blob=new Blob([JSON.stringify(pageView.getData())],{type:"application/json;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=nm; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); };
  { const fo=document.getElementById("netOpen"); if(fo){ const fi=document.getElementById("netFile"); fo.onclick=()=>fi.click(); fi.onchange=(e)=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result); pageView.setData(d); toast("Datei geladen ✓","ok"); }catch(err){ toast("Ungültige Datei","err"); } }; rd.readAsText(f); }; } }
  { const sv=document.getElementById("netSave"); if(sv) sv.onclick=async()=>{ const nm=(document.getElementById("netName").value||"").trim(); if(!nm){ toast("Bitte einen Namen eingeben.","err"); return; } const sh=!!(document.getElementById("netShared")&&document.getElementById("netShared").checked); sv.disabled=true; sv.textContent="Speichere…"; try{ if(isNew) await api.filiusCreateNetwork({name:nm, data:pageView.getData(), shared:sh}); else await api.filiusUpdateNetwork(meta.id,{name:nm, data:pageView.getData(), shared:sh}); toast("Netzwerk gespeichert ✓","ok"); filiusNetworksPage(); }catch(e){ sv.disabled=false; sv.textContent="💾 Netzwerk speichern"; toast(e.message||"Fehler","err"); } }; }
}

/* ---------- FILIUS: Vorlagen ---------- */
async function filiusPickTemplate(classId){
  openModal(`<button class="x" id="tplPickX">×</button><h3 style="margin:0 0 12px">📋 Aufgabe aus Vorlage</h3><div id="tplPickHost"><div class="center-load"><span class="spin"></span>Vorlagen…</div></div>`);
  { const x=document.getElementById("tplPickX"); if(x) x.onclick=closeModal; }
  let list=[]; try{ list=await api.filiusListTemplates(); }catch(e){ const h=document.getElementById("tplPickHost"); if(h) h.innerHTML=errBox(e); return; }
  const host=document.getElementById("tplPickHost"); if(!host) return;
  if(!list.length){ host.innerHTML=`<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Öffne eine Aufgabe und wähle „⭐ Als Vorlage".</div>`; return; }
  host.innerHTML=`<div class="muted" style="font-size:12.5px;margin-bottom:8px">Wähle eine Vorlage – sie wird als neue Aufgabe in dieser Klasse geöffnet.</div>
    <div class="list">${list.map(t=>`<div class="row clickrow" data-tpl="${t.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${t.check_count} Prüfung(en) · von ${esc(t.owner_name)}${t.mine?" (du)":""}${t.shared?" · 🌍 geteilt":""}</span></span><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`;
  host.querySelectorAll(".clickrow[data-tpl]").forEach(r=> r.onclick=async()=>{ try{ const tpl=await api.filiusGetTemplate(r.dataset.tpl); closeModal(); filiusAssignmentEditorPage(classId, null, tpl); }catch(e){ toast(e.message||"Fehler","err"); } });
}
async function filiusTemplatesPage(back){
  const b = subBack(filiusTemplatesPage, back) || {label:"← Netzwerke · Meine Klassen", go:filiusTeacherHome};
  shell(`<div class="center-load"><span class="spin"></span>Vorlagen…</div>`);
  let list=[]; try{ list=await api.filiusListTemplates(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const rows = list.length ? `<div class="list">${list.map(t=>`
      <div class="row"><span class="grow"><span class="t${(t.mine||ME.is_admin)?" clickable":""}"${(t.mine||ME.is_admin)?` data-edit="${t.id}" title="bearbeiten"`:""}>${esc(t.title)}</span><span class="s">${t.check_count} Prüfung(en) · von ${esc(t.owner_name)}${t.mine?" (du)":""} · ${t.shared?"🌍 geteilt":"🔒 privat"} · ${esc(fmtDateTime(t.updated_at))}</span></span>
        ${(t.mine||ME.is_admin)?`<button class="abtn" data-edit="${t.id}" title="bearbeiten">✏️</button><button class="abtn" data-share="${t.id}" data-on="${t.shared?1:0}" title="${t.shared?'Freigabe zurücknehmen':'für andere Lehrkräfte freigeben'}">${t.shared?'🌍':'🔒'}</button><button class="abtn" data-del="${t.id}" data-nm="${esc(t.title)}" title="löschen">🗑️</button>`:""}
      </div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Lege eine über „+ Neue Vorlage" an – oder wähle in einer Aufgabe „⭐ Als Vorlage".</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>📋 Aufgaben-Vorlagen</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewTpl">+ Neue Vorlage</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Vorlagen sind wiederverwendbare Aufgaben (Start-Netzwerk + Prüfungen). In einer Klasse legst du über <b>📋 aus Vorlage</b> eine neue Aufgabe daraus an. <b>Geteilte</b> Vorlagen können auch andere Lehrkräfte verwenden.</span></div>
    ${rows}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewTpl").onclick = ()=> filiusTemplateEditorPage(null);
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=> filiusTemplateEditorPage({id:b.dataset.edit}));
  document.querySelectorAll("[data-share]").forEach(b=> b.onclick=async()=>{ const on=b.dataset.on==="1"; try{ await api.filiusUpdateTemplate(b.dataset.share,{shared:!on}); toast(on?"Freigabe zurückgenommen":"Vorlage freigegeben 🌍","ok"); filiusTemplatesPage(); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm(`Vorlage „${b.dataset.nm}" wirklich löschen?`)) return; try{ await api.filiusDeleteTemplate(b.dataset.del); toast("Vorlage gelöscht","ok"); filiusTemplatesPage(); }catch(e){ toast(e.message||"Fehler","err"); } });
}

/* ---------- FILIUS: Aufgaben-Editor (Lehrkräfte) ---------- */
let filiusAssignState=null;
async function filiusAssignmentEditorPage(classId, existing, prefill){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let nets=[]; try{ nets=await api.filiusListNetworks(); }catch(e){ nets=[]; }
  let a=null, sol=null;
  if(existing && existing.id){ try{ a=await api.filiusGetAssignment(existing.id); sol=await api.filiusGetSolution(existing.id); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  if(prefill){
    filiusAssignState={ classId, id:null, isTemplate:false, title:prefill.title||"", description:prefill.description||"", published:false, networkId:null,
      starter:prefill.net_snapshot||{nodes:[],links:[]}, solution:(prefill.solution_net&&(prefill.solution_net.nodes||prefill.solution_net.links))?prefill.solution_net:null,
      checks:(prefill.checks||[]).map(c=>({id:c.id||chkId(), type:c.type, params:Object.assign({},c.params||{})})),
      editing:"starter", nets, view:null };
  } else {
    filiusAssignState={ classId, id:a?a.id:null, isTemplate:false, title:a?(a.title||""):"", description:a?(a.description||""):"", published:a?!!a.published:false, networkId:a?a.network_id:null,
      starter:a?(a.net_snapshot||{nodes:[],links:[]}):{nodes:[],links:[]}, solution:(sol&&sol.data&&(sol.data.nodes||sol.data.links))?sol.data:null,
      checks:(a?(a.checks||[]):[]).map(c=>({id:c.id||chkId(), type:c.type, params:Object.assign({},c.params||{})})),
      editing:"starter", nets, view:null };
    if(!filiusAssignState.checks.length && !a) filiusAssignState.checks=[{id:chkId(), type:"ping", params:{}}];
  }
  try{ FiliusView.ensureStyles(); }catch(e){}
  renderFiliusAssignEditor();
}
async function filiusTemplateEditorPage(existing){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let nets=[]; try{ nets=await api.filiusListNetworks(); }catch(e){ nets=[]; }
  let tpl=null;
  if(existing && existing.id){ try{ tpl=await api.filiusGetTemplate(existing.id); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  filiusAssignState={ classId:null, id:null, isTemplate:true, templateId:tpl?tpl.id:null, title:tpl?(tpl.title||""):"", description:tpl?(tpl.description||""):"", published:false, networkId:null,
    starter:tpl?(tpl.net_snapshot||{nodes:[],links:[]}):{nodes:[],links:[]}, solution:(tpl&&tpl.solution_net&&(tpl.solution_net.nodes||tpl.solution_net.links))?tpl.solution_net:null,
    checks:(tpl?(tpl.checks||[]):[]).map(c=>({id:c.id||chkId(), type:c.type, params:Object.assign({},c.params||{})})),
    editing:"starter", nets, view:null };
  if(!filiusAssignState.checks.length) filiusAssignState.checks=[{id:chkId(), type:"ping", params:{}}];
  try{ FiliusView.ensureStyles(); }catch(e){}
  renderFiliusAssignEditor();
}
function filiusSyncEditing(){ const s=filiusAssignState; if(!s||!s.view) return; s[s.editing]=s.view.getData(); }
function renderFiliusAssignEditor(){
  const s=filiusAssignState;
  const netOpts = `<option value="">— leer / selbst bauen —</option>`+ s.nets.map(d=>`<option value="${esc(d.id)}" ${d.id===s.networkId?"selected":""}>${esc(d.name)}${d.mine?"":" (von "+esc(d.owner_name)+")"}</option>`).join("");
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${s.isTemplate?"← Vorlagen":"← Zur Klasse"}</button></div>
    <div class="card" style="margin-bottom:14px">
      <div class="page-head" style="margin:0 0 12px"><h2 style="margin:0">${s.isTemplate?(s.templateId?"Vorlage bearbeiten":"Neue Vorlage"):(s.id?"Netzwerk-Aufgabe bearbeiten":"Neue Netzwerk-Aufgabe")}</h2><div class="spacer"></div>
        ${s.isTemplate?"":`<button class="btn btn-ghost btn-sm" id="faTpl" title="Diese Aufgabe als wiederverwendbare Vorlage speichern">⭐ Als Vorlage</button>`}
        <button class="btn btn-primary" id="faSave" style="margin-left:8px">${s.isTemplate?"💾 Vorlage speichern":"💾 Aufgabe speichern"}</button></div>
      <div class="field"><label>${s.isTemplate?"Titel der Vorlage":"Titel der Aufgabe"}</label><input class="input" id="faTitle" maxlength="120" value="${esc(s.title)}"></div>
      <div class="field"><label>Aufgabenstellung (optional)</label><textarea class="input" id="faDesc" style="min-height:54px" placeholder="Was sollen die Schüler:innen bauen? Nenne Rechnernamen/IP-Adressen, die die Prüfungen erwarten.">${esc(s.description)}</textarea></div>
      ${s.isTemplate?"":`<label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;cursor:pointer"><input type="checkbox" id="faPub" ${s.published?"checked":""}> 🚀 Veröffentlicht (für Schüler:innen sichtbar)</label>`}
    </div>
    <div class="card" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px">✅ Prüfungen <span class="muted" style="font-weight:600;font-size:12px">(werden automatisch gegen das Schüler-Netz ausgewertet)</span></h3>
      <div id="faChkList"></div>
      <button class="btn btn-ghost btn-sm" id="faAddChk" style="margin-top:4px;width:100%">+ Prüfung</button>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="fv-modeseg" style="background:var(--line2);border-radius:11px;padding:3px"><button id="faTabStart" class="on" style="border:none;background:var(--card);font-family:inherit;font-weight:800;font-size:13px;color:var(--ink);padding:6px 12px;border-radius:9px;cursor:pointer">🔧 Start-Netzwerk</button><button id="faTabSol" style="border:none;background:transparent;font-family:inherit;font-weight:800;font-size:13px;color:var(--muted);padding:6px 12px;border-radius:9px;cursor:pointer">🏆 Muster-Netzwerk</button></div>
        <label class="muted" style="font-size:13px;font-weight:800;align-self:center;margin-left:6px">aus Bibliothek:</label>
        <select class="input" id="faNet" style="max-width:230px;width:auto">${netOpts}</select>
        <div style="flex:1"></div>
        <label id="faSolWrap" style="display:none;align-items:center;gap:7px;font-weight:700;font-size:13px;cursor:pointer"><input type="checkbox" id="faSolOn" ${s.solution?"checked":""}> Muster-Netzwerk hinterlegen</label>
      </div>
      <p class="fv-hint" id="faHint" style="margin:8px 2px 0">🔧 Baue das <b>Start-Netzwerk</b>, mit dem die Schüler:innen beginnen (kann auch leer bleiben – dann bauen sie von Grund auf).</p>
    </div>
    <div id="faNetHost"></div>`;
  document.getElementById("back").onclick = ()=>{ filiusSyncEditing(); s.isTemplate?filiusTemplatesPage():filiusTeacherClassView(s.classId); };
  document.getElementById("faTitle").oninput=(e)=>{ s.title=e.target.value; };
  document.getElementById("faDesc").oninput=(e)=>{ s.description=e.target.value; };
  { const pb=document.getElementById("faPub"); if(pb) pb.onchange=(e)=>{ s.published=e.target.checked; }; }
  document.getElementById("faSave").onclick = s.isTemplate?filiusSaveTemplateFromEditor:filiusSaveAssignment;
  { const tb=document.getElementById("faTpl"); if(tb) tb.onclick=filiusSaveAsTemplate; }
  document.getElementById("faAddChk").onclick = ()=>{ s.checks.push({id:chkId(), type:"ping", params:{}}); renderFiliusChecks(); };
  document.getElementById("faNet").onchange = async (e)=>{ const v=e.target.value; s.networkId=v||null; if(s.editing!=="starter"){ filiusSetEditing("starter"); } if(!v){ return; } try{ const d=await api.filiusGetNetwork(v); s.starter=d.data||{nodes:[],links:[]}; if(s.view) s.view.setData(s.starter); }catch(err){ toast(err.message||"Fehler","err"); } };
  document.getElementById("faTabStart").onclick = ()=> filiusSetEditing("starter");
  document.getElementById("faTabSol").onclick = ()=> filiusSetEditing("solution");
  { const so=document.getElementById("faSolOn"); if(so) so.onchange=(e)=>{ if(e.target.checked){ if(!s.solution) s.solution={nodes:[],links:[]}; } else { if(confirm("Muster-Netzwerk verwerfen?")){ s.solution=null; if(s.editing==="solution") filiusSetEditing("starter"); } else { e.target.checked=true; } } }; }
  renderFiliusChecks();
  s.view = new FiliusView("#faNetHost", { data:s.editing==="solution"?(s.solution||{nodes:[],links:[]}):s.starter, height:"56vh" });
  pageView = s.view;
  filiusUpdateEditTabs();
}
function filiusSetEditing(which){
  const s=filiusAssignState; if(s.editing===which) return;
  filiusSyncEditing();
  if(which==="solution" && !s.solution) s.solution={nodes:[],links:[]};
  s.editing=which;
  if(s.view) s.view.setData(which==="solution"?(s.solution||{nodes:[],links:[]}):s.starter);
  filiusUpdateEditTabs();
}
function filiusUpdateEditTabs(){
  const s=filiusAssignState;
  const ts=document.getElementById("faTabStart"), tsol=document.getElementById("faTabSol"), wrap=document.getElementById("faSolWrap"), hint=document.getElementById("faHint");
  if(wrap) wrap.style.display="flex";
  if(ts&&tsol){ const on=s.editing==="starter"; ts.style.background=on?"var(--card)":"transparent"; ts.style.color=on?"var(--ink)":"var(--muted)"; tsol.style.background=!on?"var(--card)":"transparent"; tsol.style.color=!on?"var(--ink)":"var(--muted)"; }
  if(hint) hint.innerHTML = s.editing==="solution" ? '🏆 Baue das <b>Muster-Netzwerk</b> – bei Freigabe können Schüler:innen es ansehen.' : '🔧 Baue das <b>Start-Netzwerk</b>, mit dem die Schüler:innen beginnen (kann auch leer bleiben).';
  const so=document.getElementById("faSolOn"); if(so) so.checked=!!s.solution;
}
function filiusCheckParamHtml(check){
  const t=FiliusEngine.CHECK_TYPES[check.type]; if(!t) return ""; const p=check.params||{};
  return t.fields.map(f=>{
    const val=esc(p[f.k]!=null?p[f.k]:"");
    if(f.type==="select"){ return `<div class="field" style="margin:0"><label>${esc(f.label)}</label><select class="input filcp" data-k="${f.k}">${f.opts.map(o=>`<option value="${o[0]}" ${p[f.k]===o[0]?"selected":""}>${esc(o[1])}</option>`).join("")}</select></div>`; }
    return `<div class="field" style="margin:0"><label>${esc(f.label)}</label><input class="input filcp" data-k="${f.k}" type="${f.type==="number"?"number":"text"}" placeholder="${esc(f.ph||"")}" value="${val}"></div>`;
  }).join("");
}
function renderFiliusChecks(){
  const s=filiusAssignState; const host=document.getElementById("faChkList"); if(!host) return;
  const typeOpts = Object.keys(FiliusEngine.CHECK_TYPES).map(k=>({k, label:FiliusEngine.CHECK_TYPES[k].label}));
  if(!s.checks.length){ host.innerHTML='<div class="muted" style="font-size:13px;padding:6px 2px">Noch keine Prüfung – füge unten eine hinzu.</div>'; return; }
  host.innerHTML = s.checks.map((c,i)=>`
    <div class="card" style="padding:12px 14px;margin-bottom:8px;box-shadow:none;border:1.5px solid var(--line)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="sqedit-no" style="flex:none">${i+1}</span>
        <select class="input" data-ctype="${i}" style="max-width:230px;width:auto">${typeOpts.map(o=>`<option value="${o.k}" ${o.k===c.type?"selected":""}>${esc(o.label)}</option>`).join("")}</select>
        <div style="flex:1"></div>
        <button class="abtn" data-cup="${i}" title="nach oben">↑</button><button class="abtn" data-cdown="${i}" title="nach unten">↓</button><button class="abtn" data-cdel="${i}" title="löschen">🗑️</button>
      </div>
      <div class="fv-row2" data-cp="${i}">${filiusCheckParamHtml(c)}</div>
    </div>`).join("");
  host.querySelectorAll("[data-ctype]").forEach(sel=> sel.onchange=(e)=>{ const i=+sel.dataset.ctype; s.checks[i].type=e.target.value; s.checks[i].params={}; const box=host.querySelector(`[data-cp="${i}"]`); if(box){ box.innerHTML=filiusCheckParamHtml(s.checks[i]); wireCheckParams(box, s.checks[i]); } });
  host.querySelectorAll("[data-cp]").forEach(box=>{ const i=+box.dataset.cp; wireCheckParams(box, s.checks[i]); });
  host.querySelectorAll("[data-cup]").forEach(b=> b.onclick=()=>{ const i=+b.dataset.cup; if(i<=0) return; const a=s.checks; [a[i-1],a[i]]=[a[i],a[i-1]]; renderFiliusChecks(); });
  host.querySelectorAll("[data-cdown]").forEach(b=> b.onclick=()=>{ const i=+b.dataset.cdown; if(i>=s.checks.length-1) return; const a=s.checks; [a[i+1],a[i]]=[a[i],a[i+1]]; renderFiliusChecks(); });
  host.querySelectorAll("[data-cdel]").forEach(b=> b.onclick=()=>{ const i=+b.dataset.cdel; s.checks.splice(i,1); renderFiliusChecks(); });
}
function wireCheckParams(box, check){ box.querySelectorAll(".filcp").forEach(inp=>{ inp.oninput=()=>{ check.params=check.params||{}; check.params[inp.dataset.k]=inp.value; }; inp.onchange=()=>{ check.params=check.params||{}; check.params[inp.dataset.k]=inp.value; }; }); }
function filiusValidateChecks(checks){ for(let i=0;i<checks.length;i++){ const c=checks[i], t=FiliusEngine.CHECK_TYPES[c.type]; if(!t) continue; for(const f of t.fields){ const v=(c.params||{})[f.k]; if(v==null||String(v).trim()===""){ if(c.type==="count"&&f.k==="min"){ continue; } throw new Error("Prüfung "+(i+1)+" ("+t.label+"): Feld „"+f.label+"“ fehlt."); } } if(c.type==="count" && !(+((c.params||{}).min)>0)) c.params.min=1; } }
async function filiusSaveAssignment(){
  const s=filiusAssignState; filiusSyncEditing();
  const title=(s.title||"").trim();
  if(!title){ toast("Bitte einen Titel eingeben.","err"); return; }
  if(!s.checks.length){ toast("Bitte mindestens eine Prüfung anlegen.","err"); return; }
  try{ filiusValidateChecks(s.checks); }catch(e){ toast(e.message,"err"); return; }
  const btn=document.getElementById("faSave"); btn.disabled=true; btn.textContent="Speichere…";
  try{
    const payload={ class_id:s.classId, title, description:(s.description||"").trim()||null, published:s.published, network_id:s.networkId||null, net_snapshot:s.starter||{nodes:[],links:[]}, checks:s.checks };
    let aid=s.id;
    if(aid){ await api.filiusUpdateAssignment(aid, payload); } else { const a=await api.filiusCreateAssignment(payload); aid=a.id; s.id=aid; }
    if(s.solution && ((s.solution.nodes||[]).length || (s.solution.links||[]).length)) await api.filiusSaveSolution(aid, s.solution);
    else { try{ await api.filiusDeleteSolution(aid); }catch(_){} }
    toast("Aufgabe gespeichert ✓","ok"); filiusTeacherClassView(s.classId);
  }catch(e){ btn.disabled=false; btn.textContent="💾 Aufgabe speichern"; toast(e.message||"Fehler","err"); }
}
async function filiusSaveAsTemplate(){
  const s=filiusAssignState; filiusSyncEditing();
  const title=(s.title||"").trim(); if(!title){ toast("Bitte zuerst einen Titel eingeben.","err"); return; }
  if(!s.checks.length){ toast("Bitte mindestens eine Prüfung anlegen.","err"); return; }
  try{ filiusValidateChecks(s.checks); }catch(e){ toast(e.message,"err"); return; }
  const name=prompt("Name der Vorlage:", title); if(name===null) return;
  try{ await api.filiusCreateTemplate({ title:(name.trim()||title), description:(s.description||"").trim()||null, net_snapshot:s.starter||{nodes:[],links:[]}, checks:s.checks, solution_net:s.solution||{} }); toast("Als Vorlage gespeichert ⭐","ok"); }
  catch(e){ toast(e.message||"Fehler","err"); }
}
async function filiusSaveTemplateFromEditor(){
  const s=filiusAssignState; filiusSyncEditing();
  const title=(s.title||"").trim(); if(!title){ toast("Bitte einen Titel eingeben.","err"); return; }
  if(!s.checks.length){ toast("Bitte mindestens eine Prüfung anlegen.","err"); return; }
  try{ filiusValidateChecks(s.checks); }catch(e){ toast(e.message,"err"); return; }
  const btn=document.getElementById("faSave"); btn.disabled=true; btn.textContent="Speichere…";
  const payload={ title, description:(s.description||"").trim()||null, net_snapshot:s.starter||{nodes:[],links:[]}, checks:s.checks, solution_net:s.solution||{} };
  try{ if(s.templateId){ await api.filiusUpdateTemplate(s.templateId, payload); } else { const t=await api.filiusCreateTemplate(payload); s.templateId=t.id; } toast("Vorlage gespeichert ⭐","ok"); filiusTemplatesPage(); }
  catch(e){ btn.disabled=false; btn.textContent="💾 Vorlage speichern"; toast(e.message||"Fehler","err"); }
}

/* ---------- FILIUS: Sandbox (private Projekte) ---------- */
async function filiusSandbox(back){
  const b = subBack(filiusSandbox, back) || {label:"← Zurück", go:()=> (ME.role==="teacher"?filiusTeacherHome():filiusStudentHome())};
  shell(`<div class="center-load"><span class="spin"></span>Sandbox…</div>`);
  let projects=[]; try{ projects=await api.filiusListSandboxProjects(); }catch(e){}
  const list = projects.length ? `<div class="list">${projects.map(p=>`
      <div class="row clickrow" data-id="${p.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(fmtDateTime(p.updated_at))}</span></span>
        <button class="btn btn-sm btn-ghost" data-del="${p.id}" title="löschen">🗑️</button><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🧪</span>Noch keine Projekte. Leg dein erstes an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>🧪 Netzwerk-Sandbox</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewSbx">+ Neues Projekt</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Baue frei ein Netzwerk, teste im Simulationsmodus mit ping &amp; Co. – und speichere deine eigenen Projekte.</span></div>
    ${list}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewSbx").onclick = ()=> filiusSandboxProject(null);
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=(e)=>{ if(e.target.closest("[data-del]")) return; filiusSandboxProject(r.dataset.id); });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async(e)=>{ e.stopPropagation(); if(!confirm("Projekt löschen?")) return; try{ await api.filiusDeleteSandboxProject(b.dataset.del); filiusSandbox(); }catch(err){ toast(err.message||"Fehler","err"); } });
}
let filiusSandboxStateObj=null;
async function filiusSandboxProject(projectId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let proj=null; if(projectId){ try{ proj=await api.filiusGetSandboxProject(projectId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  let libs=[]; try{ libs=await api.sandboxFiliusNetworks(); }catch(e){}
  filiusSandboxStateObj={ projectId:proj?proj.id:null, title:proj?(proj.title||"Mein Netzwerk"):"Mein Netzwerk", data:proj?(proj.data||{nodes:[],links:[]}):{nodes:[],links:[]}, libs, view:null };
  try{ FiliusView.ensureStyles(); }catch(e){}
  const s=filiusSandboxStateObj;
  const libOpts = `<option value="">— Vorlage laden —</option>`+ s.libs.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}${d.mine?"":" (von "+esc(d.owner_name)+")"}</option>`).join("");
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Zur Sandbox</button></div>
    <div class="page-head" style="margin-top:0">
      <input class="input" id="fsbTitle" style="max-width:260px;font-weight:800" maxlength="80">
      ${s.libs.length?`<select class="input" id="fsbLib" style="max-width:210px;margin-left:8px;width:auto">${libOpts}</select>`:""}
      <div class="spacer"></div>
      <input type="file" id="fsbFile" accept=".json,.fnet" style="display:none">
      <button class="btn btn-ghost btn-sm" id="fsbOpen" title="Netzwerk aus Datei laden">📂</button>
      <button class="btn btn-ghost btn-sm" id="fsbDl" style="margin-left:6px" title="als .json herunterladen">⬇️</button>
      <button class="btn btn-primary btn-sm" id="fsbSave" style="margin-left:8px">💾 Speichern</button></div>
    <div id="fsbHost"></div>`;
  document.getElementById("fsbTitle").value = s.title;
  document.getElementById("back").onclick = ()=>{ s.title=(document.getElementById("fsbTitle").value||"").trim()||s.title; filiusSandbox(); };
  document.getElementById("fsbTitle").oninput=(e)=>{ s.title=e.target.value; };
  s.view = new FiliusView("#fsbHost", { data:s.data, height:"62vh" });
  pageView=s.view;
  { const lib=document.getElementById("fsbLib"); if(lib) lib.onchange=(e)=>{ const v=e.target.value; if(!v) return; const d=s.libs.find(x=>x.id===v); if(d && d.data){ s.view.setData(d.data); toast("Vorlage geladen ✓","ok"); } e.target.value=""; }; }
  document.getElementById("fsbDl").onclick = ()=>{ const nm=((s.title||"netzwerk").trim().replace(/[^\w.\- ]+/g,"_")||"netzwerk")+".json"; const blob=new Blob([JSON.stringify(s.view.getData())],{type:"application/json;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=nm; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); };
  { const fo=document.getElementById("fsbOpen"), fi=document.getElementById("fsbFile"); fo.onclick=()=>fi.click(); fi.onchange=(e)=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ s.view.setData(JSON.parse(rd.result)); toast("Datei geladen ✓","ok"); }catch(err){ toast("Ungültige Datei","err"); } }; rd.readAsText(f); }; }
  document.getElementById("fsbSave").onclick = async ()=>{ s.title=(document.getElementById("fsbTitle").value||"").trim()||"Mein Netzwerk"; const btn=document.getElementById("fsbSave"); btn.disabled=true; btn.textContent="Speichere…"; const payload={ title:s.title, data:s.view.getData() }; try{ if(s.projectId){ await api.filiusUpdateSandboxProject(s.projectId, payload); } else { const p=await api.filiusCreateSandboxProject(payload); s.projectId=p.id; } toast("Projekt gespeichert ✓","ok"); }catch(e){ toast(e.message||"Fehler","err"); } finally{ btn.disabled=false; btn.textContent="💾 Speichern"; } };
}

/* ============================================================================
   SANDBOX (freier Modus) – Schüler:innen bauen Welt + Code, speicherbar
   ============================================================================ */
async function sandboxHome(classId, back){
  const b = subBack(sandboxHome, back) || {label:"← zurück", go:()=> (classId==null ? (ME.role==="teacher"?teacherHome():studentHome()) : studentClassView(classId))};
  shell(`<div class="center-load"><span class="spin"></span>Sandbox…</div>`);
  let cls, projects=[];
  try{ if(classId!=null){ const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data; } projects=await api.listSandboxProjects(classId); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const list = projects.length ? `<div class="list">${projects.map(p=>`
      <div class="row clickrow" data-id="${p.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(fmtDateTime(p.updated_at))}</span></span>
        <button class="btn btn-sm btn-ghost" data-del="${p.id}" title="löschen">🗑️</button><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🧪</span>Noch keine Projekte. Leg dein erstes an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>${classId==null?"🧪 Meine Sandbox":("🧪 Sandbox – "+esc(cls?cls.name:""))}</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNew">+ Neues Projekt</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Hier kannst du frei eine Welt bauen und programmieren – ganz ohne Aufgabe. Deine Projekte werden gespeichert.</span></div>
    ${list}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNew").onclick = ()=> sandboxProject(classId, null);
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=(e)=>{ if(e.target.closest("[data-del]")) return; sandboxProject(classId, r.dataset.id); });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async(e)=>{ e.stopPropagation(); if(!confirm("Projekt löschen?")) return; try{ await api.deleteSandboxProject(b.dataset.del); sandboxHome(classId); }catch(err){ toast(err.message||"Fehler","err"); } });
}
async function sandboxProject(classId, projectId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let proj=null;
  if(projectId){ try{ proj=await api.getSandboxProject(projectId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  sandboxState = {
    classId, projectId: proj?proj.id:null, title: proj?proj.title:"Mein Projekt",
    territory: (proj && proj.territory) ? proj.territory : HamsterEngine.toJSON(HamsterEngine.blankTerr()),
    code: (proj && proj.code!=null) ? proj.code : DEFAULT_STARTER, sub:"code"
  };
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zur Sandbox</button></div>
    <div class="page-head" style="margin-top:0">
      <input class="input" id="sbxTitle" style="max-width:280px;font-weight:800" maxlength="80">
      <div class="spacer"></div>
      <span class="acts"><button class="abtn on" id="sbxCode" title="Programmieren">📝 Code</button><button class="abtn" id="sbxWelt" title="Welt bearbeiten">🌍 Welt</button></span>
      <button class="btn btn-primary btn-sm" id="sbxSave" style="margin-left:8px">💾 Speichern</button>
    </div>
    <div id="sbxHost" style="--edh:70vh;min-height:600px"></div>`;
  document.getElementById("sbxTitle").value = sandboxState.title;
  document.getElementById("back").onclick = ()=>{ syncSandbox(); sandboxHome(classId); };
  document.getElementById("sbxCode").onclick = ()=> setSandboxSub("code");
  document.getElementById("sbxWelt").onclick = ()=> setSandboxSub("welt");
  document.getElementById("sbxSave").onclick = saveSandbox;
  buildSandboxView();
}
function buildSandboxView(){
  const s=sandboxState; if(!s) return;
  if(pageView){ try{ pageView.destroy(); }catch(e){} }
  if(s.sub==="code") pageView=new HamsterView("#sbxHost",{mode:"solve", model:s.territory, code:s.code, fill:true, commands:true});
  else pageView=new HamsterView("#sbxHost",{mode:"design", model:s.territory, fill:true});
}
function syncSandbox(){
  const s=sandboxState; if(!s||!pageView) return;
  if(s.sub==="code") s.code=pageView.getCode(); else s.territory=pageView.getTerritory();
  const t=document.getElementById("sbxTitle"); if(t) s.title=t.value.trim()||"Mein Projekt";
}
function setSandboxSub(sub){
  if(!sandboxState || sandboxState.sub===sub) return;
  syncSandbox(); sandboxState.sub=sub;
  const cb=document.getElementById("sbxCode"), wb=document.getElementById("sbxWelt");
  if(cb) cb.classList.toggle("on", sub==="code"); if(wb) wb.classList.toggle("on", sub==="welt");
  buildSandboxView();
}
async function saveSandbox(){
  syncSandbox(); const s=sandboxState; if(!s) return;
  const btn=document.getElementById("sbxSave"); btn.disabled=true; btn.textContent="Speichere…";
  try{
    if(s.projectId){ await api.updateSandboxProject(s.projectId, {title:s.title, territory:s.territory, code:s.code}); }
    else { const created=await api.createSandboxProject({class_id:s.classId, title:s.title, territory:s.territory, code:s.code}); s.projectId=created.id; }
    toast("Projekt gespeichert 💾","ok");
  }catch(e){ toast(e.message||"Fehler","err"); }
  finally{ btn.disabled=false; btn.textContent="💾 Speichern"; }
}

/* ---------- Kleinkram ---------- */
function errBox(e){ console.error(e); return `<div class="empty"><span class="ic">⚠️</span>${esc(e&&e.message||"Etwas ist schiefgelaufen.")}</div>`; }
function fmtDate(s){ try{ const d=new Date(s); return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"}); }catch(e){ return ""; } }

/* ============================================================================
   PATCH-NOTES (Änderungsverlauf) – Knopf unten links in Lehrer-/Admin-Ansicht
   Neueste Version zuerst. Bei jedem Deploy oben einen Eintrag ergänzen.
   ============================================================================ */
/* ============================================================================
   ☕ JAVA-IDE — viertes Lern-Tool (Codeboard-angelehnt; Engine: javaengine.js,
   IDE: javaview.js). Struktur gespiegelt von Filius/SQL.
   ============================================================================ */
/* ---------- API ---------- */
api.javaListAssignments = async (classId)=>{ const {data,error}=await sb.from("java_assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };
api.javaStudentAssignments = api.javaListAssignments;   // RLS -> Schüler sehen nur veröffentlichte
api.javaGetAssignment = async (id)=>{ const {data,error}=await sb.from("java_assignments").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.javaCreateAssignment = async (a)=>{ const {data:mn}=await sb.from("java_assignments").select("position").eq("class_id",a.class_id).order("position",{ascending:true}).limit(1); const position=(mn&&mn[0]?mn[0].position:1)-1; const {data,error}=await sb.from("java_assignments").insert(Object.assign({position},a)).select().single(); if(error) throw error; return data; };
api.javaUpdateAssignment = async (id,patch)=>{ const {data,error}=await sb.from("java_assignments").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
api.javaDeleteAssignment = async (id)=>{ const {error}=await sb.from("java_assignments").delete().eq("id",id); if(error) throw error; };
api.javaGetSolution = async (aid)=>{ const {data,error}=await sb.from("java_assignment_solutions").select("*").eq("assignment_id",aid).maybeSingle(); if(error) throw error; return data; };
api.javaSaveSolution = async (aid, data)=>{ const {error}=await sb.from("java_assignment_solutions").upsert({assignment_id:aid, author_id:ME.id, data, updated_at:new Date().toISOString()},{onConflict:"assignment_id"}); if(error) throw error; };
api.javaSolutionForStudent = async (aid)=>{ const {data,error}=await sb.rpc("java_solution_for_student",{p_assignment:aid}); if(error) throw error; return data; };
/* Abgaben: MEHRERE je Aufgabe+Schüler:in (Historie); genau eine ist "aktuell" (is_current) */
api.javaGetMySubmission = async (aid)=>{ const {data,error}=await sb.from("java_submissions").select("*").eq("assignment_id",aid).eq("student_id",ME.id).eq("is_current",true).maybeSingle(); if(error) throw error; return data; };
api.javaMySubmissionHistory = async (aid)=>{ const {data,error}=await sb.from("java_submissions").select("*").eq("assignment_id",aid).eq("student_id",ME.id).order("updated_at",{ascending:false}); if(error) throw error; return data||[]; };
api.javaMySubmissions = async (aids)=>{ if(!aids.length) return []; const {data,error}=await sb.from("java_submissions").select("*").in("assignment_id",aids).eq("student_id",ME.id).eq("is_current",true); if(error) throw error; return data||[]; };
api.javaSaveSubmission = async (aid, files, results, passed)=>{ const {data,error}=await sb.from("java_submissions").insert({assignment_id:aid, student_id:ME.id, files, results, passed, is_current:true, updated_at:new Date().toISOString()}).select().single(); if(error) throw error; return data; };
api.javaSetCurrentSubmission = async (id)=>{ const {error}=await sb.from("java_submissions").update({is_current:true}).eq("id",id); if(error) throw error; };
api.javaClassSubmissions = async (aids)=>{ if(!aids.length) return []; const {data,error}=await sb.from("java_submissions").select("id,assignment_id,student_id,files,results,passed,is_current,updated_at").in("assignment_id",aids).eq("is_current",true); if(error) throw error; return data||[]; };
api.javaSubmissionHistoryOf = async (aid, sid)=>{ const {data,error}=await sb.from("java_submissions").select("*").eq("assignment_id",aid).eq("student_id",sid).order("updated_at",{ascending:false}); if(error) throw error; return data||[]; };
api.javaGetSubmission = async (aid, sid)=>{ const {data,error}=await sb.from("java_submissions").select("*").eq("assignment_id",aid).eq("student_id",sid).eq("is_current",true).maybeSingle(); if(error) throw error; return data; };
/* Entwürfe (Bearbeitungsstand) */
api.javaGetDraft = async (aid)=>{ const {data,error}=await sb.from("java_drafts").select("*").eq("assignment_id",aid).eq("student_id",ME.id).maybeSingle(); if(error) throw error; return data; };
api.javaSaveDraft = async (aid, files)=>{ const {error}=await sb.from("java_drafts").upsert({assignment_id:aid, student_id:ME.id, files, updated_at:new Date().toISOString()},{onConflict:"assignment_id,student_id"}); if(error) throw error; };
api.javaDeleteDraft = async (aid)=>{ const {error}=await sb.from("java_drafts").delete().eq("assignment_id",aid).eq("student_id",ME.id); if(error) throw error; };
/* Musterlösungen (mehrere je Aufgabe, freigebbar) */
api.javaListSamples = async (aid)=>{ const {data,error}=await sb.from("java_sample_solutions").select("*").eq("assignment_id",aid).order("created_at"); if(error) throw error; return data||[]; };
api.javaReleasedSamples = async (aid)=>{ const {data,error}=await sb.from("java_sample_solutions").select("*").eq("assignment_id",aid).eq("released",true).order("created_at"); if(error) throw error; return data||[]; };
api.javaCreateSample = async (s)=>{ const {data,error}=await sb.from("java_sample_solutions").insert(Object.assign({author_id:ME.id},s)).select().single(); if(error) throw error; return data; };
api.javaUpdateSample = async (id, patch)=>{ const {data,error}=await sb.from("java_sample_solutions").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
api.javaDeleteSample = async (id)=>{ const {error}=await sb.from("java_sample_solutions").delete().eq("id",id); if(error) throw error; };
api.javaGetComment = async (subId)=>{ if(!subId) return null; const {data,error}=await sb.from("java_submission_comments").select("*").eq("submission_id",subId).maybeSingle(); if(error) throw error; return data; };
api.javaSaveComment = async (subId, body, released)=>{ const {data,error}=await sb.from("java_submission_comments").upsert({submission_id:subId, author_id:ME.id, body, released, updated_at:new Date().toISOString()},{onConflict:"submission_id"}).select().single(); if(error) throw error; return data; };
api.javaDeleteComment = async (subId)=>{ const {error}=await sb.from("java_submission_comments").delete().eq("submission_id",subId); if(error) throw error; };
api.javaClassComments = async (subIds)=>{ if(!subIds.length) return []; const {data,error}=await sb.from("java_submission_comments").select("submission_id,released,body").in("submission_id",subIds); if(error) throw error; return data||[]; };
api.javaListTemplates = async ()=>{ const {data,error}=await sb.rpc("shared_java_templates"); if(error) throw error; return data||[]; };
api.javaGetTemplate = async (id)=>{ const {data,error}=await sb.from("java_assignment_templates").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.javaCreateTemplate = async (t)=>{ const {data,error}=await sb.from("java_assignment_templates").insert(Object.assign({owner_id:ME.id},t)).select().single(); if(error) throw error; return data; };
api.javaUpdateTemplate = async (id,patch)=>{ const {data,error}=await sb.from("java_assignment_templates").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.javaDeleteTemplate = async (id)=>{ const {error}=await sb.from("java_assignment_templates").delete().eq("id",id); if(error) throw error; };
api.javaListSandboxProjects = async ()=>{ const {data,error}=await sb.from("java_sandbox_projects").select("id,title,updated_at").eq("owner_id",ME.id).order("updated_at",{ascending:false}); if(error) throw error; return data||[]; };
api.javaGetSandboxProject = async (id)=>{ const {data,error}=await sb.from("java_sandbox_projects").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.javaCreateSandboxProject = async (p)=>{ const {data,error}=await sb.from("java_sandbox_projects").insert(Object.assign({owner_id:ME.id},p)).select().single(); if(error) throw error; return data; };
api.javaUpdateSandboxProject = async (id,patch)=>{ const {data,error}=await sb.from("java_sandbox_projects").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.javaDeleteSandboxProject = async (id)=>{ const {error}=await sb.from("java_sandbox_projects").delete().eq("id",id); if(error) throw error; };
async function moveJavaAssignment(list, id, dir){ const i=list.findIndex(x=>x.id===id); const j=i+dir; if(i<0||j<0||j>=list.length) return; const a=list[i], b=list[j]; await api.javaUpdateAssignment(a.id,{position:b.position}); await api.javaUpdateAssignment(b.id,{position:a.position}); }

/* ---------- Auto-Check-Helfer ---------- */
function javaChecksOf(a){ const c=(a&&a.checks)||{}; return { mode:c.mode||"none", tests:Array.isArray(c.tests)?c.tests:[], runs:Array.isArray(c.runs)?c.runs:[] }; }
function javaNorm(s){ return String(s==null?"":s).split("\n").map(l=>l.replace(/[ \t]+$/,"")).join("\n").replace(/\n+$/,""); }
function javaTestOk(test, output){ const e=javaNorm(test.expected), o=javaNorm(output); return (test.match==="contains") ? o.includes(e) : o===e; }
function javaStdinLines(s){ s=String(s==null?"":s); return s==="" ? [] : s.split("\n"); }
/* führt Tests gegen einen Datei-Satz aus -> {results:{id:correct|wrong}, passed, firstError} */
async function javaRunTests(files, tests){
  const results={}; let firstError=null;
  for(const t of tests){
    const r = await JavaEngine.runHeadless(files.map(f=>({name:f.name,content:f.content})), javaStdinLines(t.stdin));
    if(!r.ok && !firstError) firstError = r.errorText || "Fehler";
    results[t.id] = (r.ok && javaTestOk(t, r.output)) ? "correct" : "wrong";
  }
  const passed = tests.length>0 && tests.every(t=>results[t.id]==="correct");
  return { results, passed, firstError };
}
const JAVA_DEFAULT_FILES = ()=>[{name:"Main.java", content:'public class Main {\n\n\tpublic static void main(String[] args) {\n\t\tSystem.out.println("Hallo Welt!");\n\t}\n\n}\n', readonly:false, hidden:false}];

/* ---------- Home (Lehrkraft / Schüler:in) ---------- */
async function javaTeacherHome(){
  shell(`<div class="center-load"><span class="spin"></span>Klassen werden geladen…</div>`);
  _classActivity=null;
  let classes=[];
  try{ classes = await api.myTeacherClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnJvTpl">📋 Vorlagen</button>
      <button class="btn btn-ghost" id="btnJvSbx" style="margin-left:8px">🧪 Sandbox</button>
      <button class="btn btn-primary" id="btnNewClass" style="margin-left:8px">+ Neue Klasse</button></div>
    ${classes.length?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnJvTpl").onclick = ()=> javaTemplatesPage({label:"← Java · Meine Klassen", go:javaTeacherHome});
  document.getElementById("btnJvSbx").onclick = ()=> javaSandbox();
  document.getElementById("btnNewClass").onclick = newClassDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b></div></div>`,
    id=>{ viewFromAdmin=false; javaTeacherClassView(id); },
    `<div class="empty"><span class="ic">☕</span>Noch keine Java-Klassen. Erstelle deine erste Klasse!</div>`);
}
async function javaStudentHome(){
  shell(`<div class="center-load"><span class="spin"></span>Wird geladen…</div>`);
  _classActivity=null;
  let classes=[];
  try{ classes = await api.myClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!classes.length){
    document.getElementById("view").innerHTML = `
      <div class="page-head"><h2>☕ Java</h2><div class="spacer"></div><button class="btn btn-ghost" id="btnJvSbx">🧪 Sandbox</button></div>
      <div class="card" style="max-width:480px;margin:0 auto;text-align:center">
        <div style="font-size:46px">🔑</div>
        <h3 style="margin:6px 0">Tritt deiner Klasse bei</h3>
        <p class="muted" style="margin:0 0 16px">Gib den Code ein, den du von deiner Lehrkraft bekommen hast.</p>
        <div class="field"><input class="input" id="joinCode" placeholder="z. B. K7Q2MX" maxlength="8" style="text-align:center;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-size:22px"></div>
        <button class="btn btn-primary btn-lg" id="btnJoin">Beitreten</button>
      </div>`;
    wireJoin(); { const sx=document.getElementById("btnJvSbx"); if(sx) sx.onclick=()=> javaSandbox(); } return;
  }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnJvSbx">🧪 Sandbox</button>
      <button class="btn btn-ghost" id="btnJoinMore" style="margin-left:8px">+ Klasse beitreten</button></div>
    ${classes.length?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnJvSbx").onclick = ()=> javaSandbox();
  document.getElementById("btnJoinMore").onclick = joinDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Aufgaben ansehen →</div></div>`, id=> javaStudentClassView(id), "");
}

/* ---------- Lehrkraft: Klassenansicht + Matrix ---------- */
async function javaTeacherClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Klasse wird geladen…</div>`);
  let cls, roster=[], asgs=[], subs=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data;
    roster = await api.classRoster(classId);
    roster.sort((a,b)=>{ const na=((a.profiles&&(a.profiles.display_name||a.profiles.username))||"").toLowerCase(), nb=((b.profiles&&(b.profiles.display_name||b.profiles.username))||"").toLowerCase(); return na.localeCompare(nb,"de"); });
    asgs = await api.javaListAssignments(classId);
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!cls){ document.getElementById("view").innerHTML=errBox({message:"Klasse nicht gefunden."}); return; }
  if(asgs.length){ try{ subs = await api.javaClassSubmissions(asgs.map(a=>a.id)); }catch(e){ subs=[]; } }
  const canTeam=(cls.teacher_id===ME.id||ME.is_admin);
  let teachers=[]; try{ teachers=await api.classTeachersNamed(classId); }catch(e){ teachers=[]; }
  const iAmCoTeacher = !canTeam && teachers.some(t=>t.id===ME.id && !t.is_owner);
  const rosterHtml = roster.length ? `<div class="list">${roster.map(m=>{ const p=m.profiles||{}; const nm=p.display_name||p.username||"?"; return `<div class="row"><span class="chip clickable" data-prof="${m.student_id}" title="Profil ansehen" style="cursor:pointer"><span class="av">${esc(initials(nm))}</span>${esc(nm)}</span><div class="grow"></div><span class="muted" style="font-size:11.5px;margin-right:8px">${fmtDate(m.joined_at)}</span>${canTeam?`<button class="abtn" data-stu="${m.student_id}" data-nm="${esc(nm)}" title="Passwort zurücksetzen">🔑</button><button class="abtn" data-rmstu="${m.student_id}" data-nm="${esc(nm)}" title="aus Klasse entfernen">🗑️</button>`:""}</div>`; }).join("")}</div>`
    : `<div class="empty"><span class="ic">🎒</span>Noch keine Schüler:innen. Teile den Code <b>${esc(cls.code)}</b>!</div>`;
  const modeLabel = a=>{ const c=javaChecksOf(a); return c.mode==="tests" ? `🧪 ${c.tests.length} Test(s)` : c.mode==="solution" ? "🏆 Musterlösungs-Vergleich" : "kein Auto-Check"; };
  const asgHtml = asgs.length ? `<div class="list">${asgs.map(a=>`
      <div class="row"><span class="grow"><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="t clickable" data-edit="${a.id}" title="Aufgabe bearbeiten">${esc(a.title)}</span>${a.published?"":'<span class="badge gold">Entwurf</span>'}${a.released?'<span class="badge" title="Musterlösung für Schüler:innen sichtbar">🏆 Lösung frei</span>':''}</span><span class="s">${modeLabel(a)} · ${esc(fmtDateTime(a.created_at))}</span></span>
        <span class="acts">
          <button class="abtn" data-up="${a.id}" title="nach oben">↑</button>
          <button class="abtn" data-down="${a.id}" title="nach unten">↓</button>
          <button class="abtn" data-pub="${a.id}" data-on="${a.published?1:0}" title="${a.published?'verbergen (Entwurf)':'veröffentlichen'}">${a.published?'👁️':'🚀'}</button>
          <button class="abtn" data-rel="${a.id}" data-relon="${a.released?1:0}" title="${a.released?'Musterlösung wieder verbergen':'Musterlösung für Schüler:innen freigeben'}">${a.released?'🏆':'🔒'}</button>
          <button class="abtn" data-sample="${a.id}" title="Musterlösungen verwalten">★</button>
          <button class="abtn" data-edit="${a.id}" title="bearbeiten">✏️</button>
          <button class="abtn" data-del="${a.id}" title="löschen">🗑️</button>
        </span></div>`).join("")}</div>`
    : `<div class="empty" style="padding:16px"><span class="ic">📝</span>Noch keine Aufgaben.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${viewFromAdmin?"← Admin-Bereich":"← Meine Klassen"}</button><div class="spacer"></div><button class="btn btn-ghost btn-sm" id="btnJvTpl2">📋 Vorlagen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls.name)}${canTeam?` <button class="btn btn-ghost btn-sm" id="btnRename" title="Klasse umbenennen" style="vertical-align:middle">✏️</button>`:""}${CLASS_REFRESH_BTN}</h2><div class="spacer"></div>
      <span class="codechip" title="Einlade-Code" style="${cls.join_open===false?'opacity:.55;':''}">🔑 ${esc(cls.code)}${cls.join_open===false?' <span class="badge gray" title="Beitritt mit diesem Code ist deaktiviert">aus</span>':''} <button class="btn btn-sm btn-ghost" id="copyCode" style="margin-left:4px">Kopieren</button></span>
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnCodeToggle" style="margin-left:8px" title="${cls.join_open===false?'Beitritt mit diesem Code wieder erlauben':'Beitritt mit diesem Code deaktivieren'}">${cls.join_open===false?'🔓 Aktivieren':'🚫 Code deaktivieren'}</button><button class="btn btn-ghost btn-sm" id="btnCodeNew" style="margin-left:6px" title="Neuen Code erzeugen – der alte wird ungültig">🔄 Neuer Code</button>`:''}
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnDeleteClass" style="margin-left:8px;color:var(--red-d)" title="Klasse löschen">🗑️ Löschen</button>`:(iAmCoTeacher?`<button class="btn btn-ghost btn-sm" id="btnLeaveClass" style="margin-left:8px;color:var(--red-d)" title="Klasse verlassen">🚪 Klasse verlassen</button>`:"")}</div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">📝 Aufgaben <span class="badge gray">${asgs.length}</span></h3><div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="btnJvFromTpl">📋 aus Vorlage</button><button class="btn btn-blue btn-sm" id="btnNewJvAssign" style="margin-left:8px">+ Aufgabe stellen</button></div>
      <div style="margin-top:12px">${asgHtml}</div></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">📊 Abgabe-Matrix</h3><div style="flex:1"></div>${(asgs.length&&roster.length)?'<button class="btn btn-ghost btn-sm" id="btnJvMatrixMax" title="Matrix im Vollbild öffnen">⛶ Vergrößern</button>':''}</div>
      <div style="margin-top:12px">
        ${(asgs.length&&roster.length)?'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap"><span class="muted" style="font-size:12.5px">🟩 Test bestanden · 🟧 Test fehlgeschlagen · ⬜ offen · ★ = alle sichtbaren Tests bestanden</span><div style="flex:1"></div><input class="input" id="jvMatrixSearch" placeholder="🔍 Schüler:in suchen" style="max-width:240px"></div>':''}
        <div id="jvMatrixHost"></div>
      </div></div>
    <div class="card" style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">🎒 Schüler:innen <span class="badge gray">${roster.length}</span></h3><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnJvImport">📥 Importieren</button>':''}</div><div style="margin-top:12px">${rosterHtml}</div></div>
    <div class="card" style="margin-bottom:16px"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">👩‍🏫 Lehrkräfte <span class="badge gray">${teachers.length}</span></h3><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnTeachers">+ verwalten</button>':''}</div>
      <div class="list" style="margin-top:12px">${teachers.length?teachers.map(t=>`<div class="row"><span class="chip"><span class="av">${esc(initials(t.display_name||t.username))}</span>${esc(t.display_name||t.username)}</span><div class="grow"></div>${t.is_owner?'<span class="badge blue">Ersteller:in</span>':'<span class="badge gray">Co-Lehrkraft</span>'}</div>`).join(""):'<div class="muted" style="font-size:13px">—</div>'}</div></div>`;
  document.getElementById("back").onclick = ()=> (viewFromAdmin?adminHome():javaTeacherHome());
  document.getElementById("copyCode").onclick = ()=>{ if(navigator.clipboard) navigator.clipboard.writeText(cls.code); toast("Code kopiert: "+cls.code,"ok"); };
  { const bd=document.getElementById("btnDeleteClass"); if(bd) bd.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich löschen? Alle Aufgaben und Zuordnungen werden entfernt.`)) return; try{ await api.deleteClass(classId); toast("Klasse gelöscht","ok"); (viewFromAdmin?adminHome():javaTeacherHome()); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const br=document.getElementById("btnRename"); if(br) br.onclick=()=> renameClassDialog(classId, cls.name, cls.tool); }
  wireClassRefresh(()=> javaTeacherClassView(classId));
  { const bt=document.getElementById("btnCodeToggle"); if(bt) bt.onclick=async()=>{ const disabling=(cls.join_open!==false); if(disabling){ if(!confirm(`Beitritt für „${cls.name}" deaktivieren?\n\nMit dem Code ${cls.code} kann danach niemand mehr neu beitreten. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; } try{ await api.setClassJoinOpen(classId, !disabling); toast(disabling?"Beitritt deaktiviert 🚫":"Beitritt wieder aktiv 🔓","ok"); javaTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bn=document.getElementById("btnCodeNew"); if(bn) bn.onclick=async()=>{ if(!confirm(`Neuen Einlade-Code für „${cls.name}" erzeugen?\n\nDer bisherige Code ${cls.code} wird sofort ungültig – verteile danach den neuen Code. Bereits beigetretene Schüler:innen bleiben in der Klasse.`)) return; try{ const nc=await api.regenerateClassCode(classId); toast("Neuer Code: "+nc,"ok"); javaTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bl=document.getElementById("btnLeaveClass"); if(bl) bl.onclick=async()=>{ if(!confirm(`Klasse „${cls.name}" wirklich verlassen? Du bist danach keine Co-Lehrkraft mehr und siehst die Klasse nicht mehr.`)) return; try{ await api.removeClassTeacher(classId, ME.id); toast("Klasse verlassen","ok"); javaTeacherHome(); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  { const bt=document.getElementById("btnTeachers"); if(bt) bt.onclick=()=> classTeachersDialog(classId, cls); }
  document.getElementById("btnJvTpl2").onclick = ()=> javaTemplatesPage({label:"← zurück zur Klasse", go:()=> javaTeacherClassView(classId)});
  { const bi=document.getElementById("btnJvImport"); if(bi) bi.onclick=()=> importStudentsDialog(classId, cls.code, ()=>javaTeacherClassView(classId)); }
  document.querySelectorAll(".chip[data-prof]").forEach(b=> b.onclick=()=>{ const m=roster.find(r=>r.student_id===b.dataset.prof); const p=(m&&m.profiles)||{}; javaStudentProfilePage(classId, b.dataset.prof, p.display_name||p.username||"?", p.username||""); });
  document.querySelectorAll("[data-stu]").forEach(b=> b.onclick=()=> resetStudentPw(b.dataset.stu, b.dataset.nm));
  document.querySelectorAll("[data-rmstu]").forEach(b=> b.onclick=async()=>{ if(!confirm(b.dataset.nm+" aus dieser Klasse entfernen? (Der Account bleibt bestehen.)")) return; try{ await api.removeMembership(classId, b.dataset.rmstu); toast("Entfernt","ok"); javaTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.getElementById("btnNewJvAssign").onclick = ()=> javaAssignmentEditorPage(classId, null);
  document.getElementById("btnJvFromTpl").onclick = ()=> javaPickTemplate(classId);
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=> javaAssignmentEditorPage(classId, {id:b.dataset.edit}));
  document.querySelectorAll("[data-sample]").forEach(b=> b.onclick=()=>{ const a=asgs.find(x=>x.id===b.dataset.sample); javaSampleManager(a, classId); });
  document.querySelectorAll("[data-up]").forEach(b=> b.onclick=async()=>{ await moveJavaAssignment(asgs, b.dataset.up, -1); javaTeacherClassView(classId); });
  document.querySelectorAll("[data-down]").forEach(b=> b.onclick=async()=>{ await moveJavaAssignment(asgs, b.dataset.down, 1); javaTeacherClassView(classId); });
  document.querySelectorAll("[data-pub]").forEach(b=> b.onclick=async()=>{ try{ await api.javaUpdateAssignment(b.dataset.pub,{published:b.dataset.on!=="1"}); javaTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-rel]").forEach(b=> b.onclick=async()=>{ const on=b.dataset.relon==="1"; if(!on && !confirm("Musterlösung dieser Aufgabe für ALLE Schüler:innen sichtbar machen?")) return; try{ await api.javaUpdateAssignment(b.dataset.rel,{released:!on}); toast(on?"Musterlösung verborgen 🔒":"Musterlösung freigegeben 🏆","ok"); javaTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Aufgabe wirklich löschen?")) return; try{ await api.javaDeleteAssignment(b.dataset.del); javaTeacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  const paintJvMatrixInto=(host, q, close)=>{ if(!host) return;
    host.innerHTML = (asgs.length&&roster.length) ? buildJavaMatrix(roster, asgs, subs, q)
      : `<div class="empty"><span class="ic">📊</span>${!asgs.length?"Stelle Aufgaben – dann erscheint hier, wer abgegeben hat.":"Noch keine Schüler:innen in der Klasse."}</div>`;
    host.querySelectorAll(".sqcell[data-aid]").forEach(c=> c.onclick=()=>{ const stu=roster.find(r=>r.student_id===c.dataset.sid); const nm=(stu&&stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?"; if(close) close(); javaReviewSubmission(c.dataset.aid, c.dataset.sid, nm, classId); });
  };
  paintJvMatrixInto(document.getElementById("jvMatrixHost"), "", null);
  { const ms=document.getElementById("jvMatrixSearch"); if(ms) ms.oninput=()=> paintJvMatrixInto(document.getElementById("jvMatrixHost"), ms.value, null); }
  { const bx=document.getElementById("btnJvMatrixMax"); if(bx) bx.onclick=()=> openMatrixModal("📊 Abgabe-Matrix – "+cls.name, (host,q,close)=> paintJvMatrixInto(host,q,close)); }
}
function buildJavaMatrix(roster, asgs, subs, q){
  q=(q||"").trim().toLowerCase();
  const nmeOf=stu=>(stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?";
  const list = q ? roster.filter(stu=> nmeOfSafe(nmeOf(stu)).includes(q)) : roster;
  if(!list.length) return `<div class="empty" style="padding:16px"><span class="ic">🔍</span>Keine Schüler:in gefunden.</div>`;
  const head = asgs.map(a=>`<th title="${esc(a.title)}">${esc(a.title.length>14?a.title.slice(0,13)+"…":a.title)}</th>`).join("");
  const seg=(n,color)=> n>0?`<div style="flex:${n};background:${color}"></div>`:"";
  const rows = list.map(stu=>{
    const cells = asgs.map(a=>{
      const c=javaChecksOf(a);
      const sub = subs.find(x=>x.assignment_id===a.id && x.student_id===stu.student_id);
      if(c.mode!=="tests" || !c.tests.length){
        if(!sub) return `<td><span title="noch nicht bearbeitet" style="color:var(--muted);font-weight:900">·</span></td>`;
        return `<td><span class="sqcell" data-aid="${a.id}" data-sid="${stu.student_id}" title="abgegeben – ansehen" style="cursor:pointer;font-weight:900;color:var(--green-d)">✓</span></td>`;
      }
      const total=c.tests.length;
      if(!sub) return `<td><span title="noch nicht bearbeitet (${total} Tests)" style="color:var(--muted);font-weight:900">·</span></td>`;
      const res=sub.results||{}; let g=0,y=0; for(const t of c.tests){ const st=res[t.id]; if(st==="correct") g++; else if(st==="wrong") y++; }
      const grey=total-g-y, done=(g===total);
      const bar=`<div style="display:flex;height:7px;width:56px;border-radius:4px;overflow:hidden;margin:0 auto 3px;background:var(--line2)">${seg(g,"var(--green)")}${seg(y,"var(--gold)")}${seg(grey,"var(--line2)")}</div>`;
      const cap=`<span style="font-size:11.5px;font-weight:800;color:${done?'var(--green-d)':'var(--muted)'}">${g}/${total}${done?' ★':''}</span>`;
      const title=`✓ ${g} bestanden · ✗ ${y} fehlgeschlagen · · ${grey} offen (von ${total} sichtbaren Tests)`;
      return `<td><span class="sqcell" data-aid="${a.id}" data-sid="${stu.student_id}" title="${esc(title)} – Abgabe ansehen" style="display:inline-block;min-width:60px;text-align:center;cursor:pointer">${bar}${cap}</span></td>`;
    }).join("");
    return `<tr><td class="stu">${esc(nmeOf(stu))}</td>${cells}</tr>`;
  }).join("");
  return `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="stu">Schüler:in</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- Schüler:in: Klassenansicht ---------- */
async function javaStudentClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let cls, asgs=[], subs=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data;
    asgs = await api.javaStudentAssignments(classId);
    if(asgs.length) subs = await api.javaMySubmissions(asgs.map(a=>a.id));
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  let coms=[]; try{ if(subs.length) coms = await api.javaClassComments(subs.map(x=>x.id)); }catch(e){}
  const list = asgs.length ? `<div class="list">${asgs.map(a=>{
      const c=javaChecksOf(a);
      const s=subs.find(x=>x.assignment_id===a.id);
      const com = s ? coms.find(x=>x.submission_id===s.id && x.released) : null;
      let badge;
      if(!s) badge=`<span class="badge gray">offen</span>`;
      else if(c.mode==="tests" && c.tests.length) badge = s.passed===true?`<span class="badge">Tests bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`;
      else badge=`<span class="badge gold">abgegeben</span>`;
      return `<div class="row clickrow" data-id="${a.id}" style="cursor:pointer">
        <span class="grow"><span class="t">${esc(a.title)}</span>${a.description?`<span class="s">${esc(a.description.slice(0,70))}</span>`:""}${com?feedbackPreviewHtml(com.body):""}</span>
        ${badge}<span style="margin-left:8px;color:#7a8aa0">→</span></div>`;
    }).join("")}</div>`
    : `<div class="empty"><span class="ic">📝</span>Noch keine Aufgaben. Schau später wieder rein!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls?cls.name:"Klasse")}${CLASS_REFRESH_BTN}</h2></div>
    ${list}`;
  document.getElementById("back").onclick = javaStudentHome;
  wireClassRefresh(()=> javaStudentClassView(classId));
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=()=> javaSolveAssignment(r.dataset.id, classId));
}

/* ---------- Schüler:in: Aufgabe lösen (IDE) ---------- */
let javaSolveState=null, javaDraftTimer=null;
async function javaSolveAssignment(aid, classId){
  clearInterval(javaDraftTimer);
  shell(`<div class="center-load"><span class="spin"></span>Aufgabe wird geladen…</div>`);
  let a, history=[], draft=null;
  try{ a = await api.javaGetAssignment(aid); history = await api.javaMySubmissionHistory(aid); draft = await api.javaGetDraft(aid); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  let sub = history.find(s=>s.is_current) || history[0] || null;
  const c = javaChecksOf(a);
  /* Rückmeldung über die GESAMTE Historie suchen (bevorzugt an der aktuellen Abgabe) —
     sonst verschwindet sie, wenn der/die Schüler:in per ⭐ eine andere Abgabe aktuell macht */
  let com=null; try{ if(history.length){ const coms = await api.javaClassComments(history.map(s=>s.id)); com = coms.find(x=>x.released && sub && x.submission_id===sub.id) || coms.find(x=>x.released) || null; } }catch(e){}
  const startFiles = (a.files_snapshot&&a.files_snapshot.length) ? a.files_snapshot : JAVA_DEFAULT_FILES();
  /* Entwurf wiederherstellen, wenn er neuer als die aktuelle Abgabe ist */
  const draftNewer = draft && draft.files && draft.files.length && (!sub || new Date(draft.updated_at) > new Date(sub.updated_at));
  const files = draftNewer ? draft.files : ((sub && sub.files && sub.files.length) ? sub.files : JSON.parse(JSON.stringify(startFiles)));
  javaSolveState = { aid, classId, a, sub, dirty:false };
  const testsHtml = (c.mode==="tests" && c.tests.length) ? `
    <div class="card" style="margin-bottom:10px;padding:12px 16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>🧪 Testfälle</b><div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" id="btnJvCheck">Tests prüfen</button></div>
      <div id="jvTestList" style="margin-top:8px"></div></div>` : "";
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(a.title)}</h2><div class="spacer"></div>
      <span id="jvStatus">${sub?(sub.passed===true?'<span class="badge">Tests bestanden ✓</span>':'<span class="badge gold">abgegeben</span>'):'<span class="badge gray">offen</span>'}</span>
      ${a.released?'<button class="btn btn-ghost btn-sm" id="btnJvSol" style="margin-left:8px">🏆 Musterlösung</button>':''}
      <button class="btn btn-ghost btn-sm" id="btnJvReset" style="margin-left:8px" title="Zurück zu den Start-Dateien der Aufgabe">↺ Zurücksetzen</button>
      <button class="btn btn-primary btn-sm" id="btnJvSubmit" style="margin-left:8px">📤 Abgeben</button></div>
    ${a.description?`<div class="card" style="margin-bottom:10px;padding:12px 16px">${esc(a.description).replace(/\n/g,"<br>")}</div>`:""}
    ${com?`<div class="card" style="margin-bottom:10px;padding:12px 16px;border-left:4px solid var(--gold)"><b>💬 Rückmeldung deiner Lehrkraft:</b><br>${esc(com.body).replace(/\n/g,"<br>")}</div>`:""}
    ${draftNewer?'<div class="card" style="margin-bottom:10px;padding:9px 16px;border-left:4px solid var(--blue)"><span class="muted" style="font-size:12.5px">🕒 Dein zuletzt gespeicherter <b>Bearbeitungsstand</b> wurde wiederhergestellt (noch nicht abgegeben).</span></div>':''}
    ${testsHtml}
    <div id="jvHost" style="--jvMin:560px;height:70vh;min-height:560px"></div>
    <div class="card" style="margin-top:14px;padding:12px 16px">
      <b>🗂️ Meine Abgaben</b> <span class="muted" style="font-size:11.5px">(neueste zuerst — ⭐ = aktuelle Abgabe, die deine Lehrkraft sieht)</span>
      <div class="list" id="jvHistList" style="margin-top:8px"></div></div>`;
  pageView = new JavaView(document.getElementById("jvHost"), { mode:"solve", onChange: ()=>{ if(javaSolveState) javaSolveState.dirty=true; } });
  pageView.setData({ files });
  const myView = pageView;                       // Identität dieser Solve-Instanz (andere Seiten nutzen auch #jvHost!)
  const myState = javaSolveState;
  /* ---- Entwurf: sichern beim Verlassen + alle 20 s, falls geändert ---- */
  const saveDraft = async ()=>{
    if(pageView !== myView || javaSolveState !== myState || !myState.dirty) return;
    try{ await api.javaSaveDraft(aid, myView.getData().files); myState.dirty=false; }catch(e){}
  };
  javaDraftTimer = setInterval(()=>{ if(pageView !== myView){ clearInterval(javaDraftTimer); return; } saveDraft(); }, 20000);
  /* zentraler Leave-Hook: feuert bei JEDEM Seitenwechsel (Browser-Zurück, 🏠, Admin, Abmelden …) VOR dem Teardown */
  pageLeave = ()=>{ clearInterval(javaDraftTimer); return saveDraft(); };
  document.getElementById("back").onclick = async()=>{ clearInterval(javaDraftTimer); await saveDraft(); javaStudentClassView(classId||a.class_id); };
  /* ---- Abgabe-Historie (unterhalb der Konsole) ---- */
  const renderHistory = ()=>{
    const host=document.getElementById("jvHistList"); if(!host) return;
    if(!history.length){ host.innerHTML='<div class="muted" style="font-size:13px">Noch keine Abgabe. Klicke oben auf 📤 Abgeben.</div>'; return; }
    host.innerHTML = history.map(s=>{
      const badge = (c.mode==="tests"&&c.tests.length) ? (s.passed===true?'<span class="badge">Tests ✓</span>':'<span class="badge gold">abgegeben</span>') : '<span class="badge gold">abgegeben</span>';
      return `<div class="row"><span class="grow"><span class="t" style="font-size:13.5px">${s.is_current?"⭐ ":""}${esc(fmtDateTime(s.updated_at))}</span></span>${badge}
        <span class="acts"><button class="abtn" data-load="${s.id}" title="Diese Abgabe in den Editor laden">📂</button>${s.is_current?"":`<button class="abtn" data-cur="${s.id}" title="Zur aktuellen Abgabe machen (das sieht die Lehrkraft)">⭐</button>`}</span></div>`;
    }).join("");
    host.querySelectorAll("[data-load]").forEach(b=> b.onclick=()=>{
      const s=history.find(x=>x.id===b.dataset.load); if(!s) return;
      if(javaSolveState.dirty && !confirm("Deinen aktuellen (ungespeicherten) Stand mit dieser Abgabe überschreiben?")) return;
      pageView.setData({ files: JSON.parse(JSON.stringify(s.files||[])) });
      javaSolveState.dirty=true;
      toast("Abgabe vom "+fmtDateTime(s.updated_at)+" geladen 📂","ok");
    });
    host.querySelectorAll("[data-cur]").forEach(b=> b.onclick=async()=>{
      try{ await api.javaSetCurrentSubmission(b.dataset.cur);
        history = await api.javaMySubmissionHistory(aid);
        sub = history.find(x=>x.is_current)||null;
        javaSolveState.sub = sub;
        document.getElementById("jvStatus").innerHTML = sub?(sub.passed===true?'<span class="badge">Tests bestanden ✓</span>':'<span class="badge gold">abgegeben</span>'):'<span class="badge gray">offen</span>';
        renderHistory(); toast("Als aktuelle Abgabe gesetzt ⭐","ok");
      }catch(e){ toast(e.message||"Fehler","err"); }
    });
  };
  renderHistory();
  const renderTests=(results)=>{
    const host=document.getElementById("jvTestList"); if(!host) return;
    host.innerHTML = c.tests.map(t=>{
      const st = results ? results[t.id] : (sub&&sub.results?sub.results[t.id]:null);
      const ic = st==="correct"?"🟩":st==="wrong"?"🟧":"⬜";
      return `<div class="row" style="padding:7px 10px"><span style="font-size:15px;margin-right:8px">${ic}</span><span class="grow"><span class="t" style="font-size:13.5px">${esc(t.name||"Test")}</span>${t.stdin?`<span class="s">Eingabe: ${esc(t.stdin.replace(/\n/g," ⏎ "))}</span>`:""}<span class="s">Erwartet${t.match==="contains"?" (enthält)":""}: ${esc((t.expected||"").slice(0,80))}</span></span></div>`;
    }).join("");
  };
  renderTests(null);
  { const bc=document.getElementById("btnJvCheck"); if(bc) bc.onclick=async()=>{
      bc.disabled=true; bc.textContent="prüft…";
      try{ const r = await javaRunTests(pageView.getData().files, c.tests); renderTests(r.results);
        toast(r.passed?"Alle sichtbaren Tests bestanden! ⭐":(r.firstError?("Fehler: "+r.firstError.slice(0,120)):"Noch nicht alle Tests bestanden."), r.passed?"ok":"err"); }
      catch(e){ toast(e.message||"Fehler","err"); }
      bc.disabled=false; bc.textContent="Tests prüfen"; }; }
  { const bs=document.getElementById("btnJvSol"); if(bs) bs.onclick=async()=>{
      try{
        /* Quellen sammeln: Aufgaben-Musterlösung (RPC) + freigegebene Musterlösungen (mehrere möglich) */
        const sources=[];
        try{ const solFiles = await api.javaSolutionForStudent(aid); if(solFiles && solFiles.length) sources.push({ label:"Musterlösung der Aufgabe", files: solFiles }); }catch(e){}
        try{ (await api.javaReleasedSamples(aid)).forEach((s,i)=> sources.push({ label: s.title || ("Musterlösung " + (i+1)), files: s.files||[] })); }catch(e){}
        if(!sources.length){ toast("Noch keine Musterlösung freigegeben.","err"); return; }
        /* Als Modal – der eigene Arbeitsstand im Editor bleibt unangetastet */
        openModal(`<button class="x" onclick="closeModal()">✕</button><h3 style="margin:0 0 10px">🏆 Musterlösung – ${esc(a.title)}</h3>
          ${sources.length>1?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${sources.map((s,i)=>`<button class="abtn${i===0?" on":""}" data-jvsol="${i}">${esc(s.label)}</button>`).join("")}</div>`:""}
          <div id="jvSolHost" style="--jvMin:440px;height:58vh;min-height:440px"></div>`, true);
        modalView = new JavaView(document.getElementById("jvSolHost"), { mode:"view" });
        modalView.setData({ files: sources[0].files });
        document.querySelectorAll("[data-jvsol]").forEach(b=> b.onclick=()=>{
          document.querySelectorAll("[data-jvsol]").forEach(x=>x.classList.remove("on"));
          b.classList.add("on");
          modalView.setData({ files: sources[+b.dataset.jvsol].files });
        }); }
      catch(e){ toast(e.message||"Fehler","err"); } }; }
  document.getElementById("btnJvReset").onclick = ()=>{ if(!confirm("Deinen Code verwerfen und die Start-Dateien der Aufgabe laden?")) return; pageView.setData({ files: JSON.parse(JSON.stringify(startFiles)) }); javaSolveState.dirty=true; };
  document.getElementById("btnJvSubmit").onclick = async()=>{
    const btn=document.getElementById("btnJvSubmit"); btn.disabled=true; btn.textContent="gibt ab…";
    try{
      const myFiles = pageView.getData().files;
      let results={}, passed=null;
      if(c.mode==="tests" && c.tests.length){ const r=await javaRunTests(myFiles, c.tests); results=r.results; passed=r.passed; renderTests(results); }
      await api.javaSaveSubmission(aid, myFiles, results, passed);
      try{ await api.javaDeleteDraft(aid); }catch(e){}
      javaSolveState.dirty=false;
      history = await api.javaMySubmissionHistory(aid);
      sub = history.find(x=>x.is_current)||null;
      javaSolveState.sub = sub;
      renderHistory();
      document.getElementById("jvStatus").innerHTML = passed===true?'<span class="badge">Tests bestanden ✓</span>':'<span class="badge gold">abgegeben</span>';
      toast(passed===true?"Abgegeben – alle sichtbaren Tests bestanden! ⭐":"Abgabe gespeichert 📤","ok");
    }catch(e){ toast(e.message||"Fehler","err"); }
    btn.disabled=false; btn.textContent="📤 Abgeben";
  };
}

/* ---------- Lehrkraft: Abgabe einsehen (mit authoritativer Auswertung) ---------- */
async function javaReviewSubmission(aid, sid, studentName, classId){
  shell(`<div class="center-load"><span class="spin"></span>Abgabe wird geladen…</div>`);
  let a, history=[], solRow=null;
  try{ a = await api.javaGetAssignment(aid); history = await api.javaSubmissionHistoryOf(aid, sid); solRow = await api.javaGetSolution(aid); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  let sub = history.find(s=>s.is_current) || history[0];
  if(!sub){ document.getElementById("view").innerHTML=errBox({message:"Keine Abgabe vorhanden."}); return; }
  const c = javaChecksOf(a);
  const sol = (solRow&&solRow.data)||{};
  const hiddenTests = Array.isArray(sol.hidden_tests)?sol.hidden_tests:[];
  const curSub = sub;
  /* Rückmeldung historie-weit suchen: bevorzugt an der aktuellen Abgabe, sonst die vorhandene
     (verhindert "leeres Feld + wirkungsloses Löschen", wenn der Schüler per ⭐ umgeschaltet hat) */
  let com=null, comSubId=curSub.id;
  try{
    const coms = await api.javaClassComments(history.map(s=>s.id));
    com = coms.find(x=>x.submission_id===curSub.id) || coms[0] || null;
    if(com) comSubId = com.submission_id;
  }catch(e){}
  const hasChecks = (c.mode==="tests" && (c.tests.length||hiddenTests.length)) || (c.mode==="solution" && sol.files && sol.files.length);
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>Abgabe von ${esc(studentName)}</h2><div class="spacer"></div>
      <span class="muted" id="jvRevDate" style="font-size:12.5px">${esc(fmtDateTime(sub.updated_at))}</span>
      <button class="btn btn-ghost btn-sm" id="btnJvOrig" style="margin-left:8px" title="Ausgewählte Abgabe unverändert in den Editor laden">↺ Original</button>
      <button class="btn btn-blue btn-sm" id="btnJvAsSample" style="margin-left:8px" title="Aktuellen Editor-Stand als Musterlösung speichern">★ Als Musterlösung</button></div>
    <div class="card" style="margin-bottom:10px;padding:12px 16px"><b>Aufgabe:</b> ${esc(a.title)}${a.description?` – ${esc(a.description.slice(0,140))}`:""}
      <span class="muted" style="font-size:12px;display:block;margin-top:3px">🛠️ Live-Korrektur: Du kannst den Code bearbeiten &amp; laufen lassen (▶) – Änderungen werden nicht automatisch gespeichert.</span></div>
    ${history.length>1?`<div class="card" style="margin-bottom:10px;padding:10px 14px"><b style="font-size:13px">Versionen (neueste zuerst):</b> <span id="jvVerNav">${history.map((s,i)=>`<button class="abtn${s.id===sub.id?" on":""}" data-ver="${i}" title="${esc(fmtDateTime(s.updated_at))}">${s.is_current?"⭐ ":""}V${history.length-i}</button>`).join(" ")}</span></div>`:""}
    ${hasChecks?`<div class="card" style="margin-bottom:10px;padding:12px 16px"><div style="display:flex;align-items:center;gap:8px"><b>🧪 Auto-Check (authoritativ neu ausgeführt)</b><div class="spacer"></div><span id="jvRevSpin"><span class="spin" style="width:14px;height:14px"></span></span></div><div id="jvRevChecks" style="margin-top:8px"><span class="muted" style="font-size:13px">Tests laufen…</span></div></div>`:""}
    <div id="jvHost" style="--jvMin:520px;height:62vh;min-height:520px"></div>
    <div class="card" style="margin-top:14px;padding:14px 16px">
      <b>💬 Rückmeldung an ${esc(studentName)}</b>
      <textarea class="input" id="jvComBody" style="margin-top:8px;min-height:80px">${esc(com?com.body:"")}</textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700"><input type="checkbox" id="jvComRel" ${com&&com.released?"checked":""}> Für Schüler:in sichtbar</label>
        ${comSubId!==curSub.id?'<span class="muted" style="font-size:11.5px">Hinweis: Diese Rückmeldung hängt an einer älteren Abgabe-Version.</span>':''}
        <div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" id="jvComDel" style="color:var(--red-d)">löschen</button>
        <button class="btn btn-primary btn-sm" id="jvComSave">💾 Speichern</button>
      </div></div>`;
  document.getElementById("back").onclick = ()=> javaTeacherClassView(classId);
  pageView = new JavaView(document.getElementById("jvHost"), { mode:"free" });   // editierbar: Live-Korrektur
  pageView.setData({ files: JSON.parse(JSON.stringify(sub.files||[])) });
  document.getElementById("btnJvOrig").onclick = ()=>{ pageView.setData({ files: JSON.parse(JSON.stringify(sub.files||[])) }); toast("Original wiederhergestellt ↺","ok"); };
  document.getElementById("btnJvAsSample").onclick = async()=>{
    const title = prompt("Name der Musterlösung:", "Lösung von " + studentName);
    if(title === null) return;
    try{ await api.javaCreateSample({ assignment_id: aid, title: title.trim() || null, files: pageView.getData().files, released:false });
      toast("Als Musterlösung gespeichert ★ (Freigabe über den ★-Manager der Aufgabe)","ok"); }
    catch(e){ toast(e.message||"Fehler","err"); }
  };
  /* Versions-Umschalter */
  let revToken = 0;
  document.querySelectorAll("[data-ver]").forEach(b=> b.onclick=()=>{
    sub = history[+b.dataset.ver];
    document.querySelectorAll("[data-ver]").forEach(x=>x.classList.toggle("on", x===b));
    document.getElementById("jvRevDate").textContent = fmtDateTime(sub.updated_at);
    pageView.setData({ files: JSON.parse(JSON.stringify(sub.files||[])) });
    if(hasChecks) runChecks(sub);
  });
  document.getElementById("jvComSave").onclick = async()=>{
    const body=document.getElementById("jvComBody").value.trim();
    if(!body){ toast("Bitte erst eine Rückmeldung schreiben.","err"); return; }
    try{ await api.javaSaveComment(comSubId, body, document.getElementById("jvComRel").checked); toast("Rückmeldung gespeichert ✓","ok"); }
    catch(e){ toast(e.message||"Fehler","err"); }
  };
  { const bd=document.getElementById("jvComDel"); if(bd) bd.onclick=async()=>{ if(!confirm("Rückmeldung löschen?")) return; try{ await api.javaDeleteComment(comSubId); toast("Gelöscht","ok"); javaReviewSubmission(aid,sid,studentName,classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
  /* authoritative Auswertung (sichtbare + versteckte Tests bzw. Musterlösungs-Vergleich) */
  async function runChecks(subSel){
    const myToken = ++revToken;
    const host=document.getElementById("jvRevChecks"); const spin=document.getElementById("jvRevSpin");
    if(spin) spin.innerHTML='<span class="spin" style="width:14px;height:14px"></span>';
    if(host) host.innerHTML='<span class="muted" style="font-size:13px">Tests laufen…</span>';
    const rows=[];
    const sub = subSel;
    try{
      /* Manipulationsschutz: 🔒-Vorgabedateien werden für die Auswertung IMMER aus dem
         Original-Snapshot wiederhergestellt; Abweichungen werden der Lehrkraft gemeldet. */
      const snap=Array.isArray(a.files_snapshot)?a.files_snapshot:[];
      const roMap=new Map(snap.filter(f=>f.readonly).map(f=>[f.name, f.content]));
      let tampered=false;
      const stuFiles=(sub.files||[]).map(f=>{
        if(roMap.has(f.name)){
          if(javaNorm(f.content)!==javaNorm(roMap.get(f.name))) tampered=true;
          return {name:f.name, content:roMap.get(f.name)};
        }
        return {name:f.name, content:f.content};
      });
      snap.filter(f=>f.readonly && !stuFiles.some(s2=>s2.name===f.name)).forEach(f=>{ tampered=true; stuFiles.push({name:f.name, content:f.content}); });
      if(tampered) rows.push('<div class="row" style="padding:7px 10px;background:#fff0f0;border-radius:8px"><span style="font-size:15px;margin-right:8px">⚠️</span><span class="grow"><span class="t" style="font-size:13.5px;color:var(--red-d)">Schreibgeschützte Vorgabedatei wurde verändert!</span><span class="s">Für die Auswertung wurde das Original wiederhergestellt – bitte die Abgabe genau ansehen.</span></span></div>');
      if(c.mode==="tests"){
        const all=[...c.tests.map(t=>({t,hid:false})), ...hiddenTests.map(t=>({t,hid:true}))];
        for(const {t,hid} of all){
          const r=await JavaEngine.runHeadless(stuFiles, javaStdinLines(t.stdin));
          const ok=r.ok&&javaTestOk(t,r.output);
          rows.push(`<div class="row" style="padding:7px 10px"><span style="font-size:15px;margin-right:8px">${ok?"🟩":"🟧"}</span><span class="grow"><span class="t" style="font-size:13.5px">${esc(t.name||"Test")}${hid?' <span class="badge gray" title="für Schüler:innen unsichtbar">🙈 versteckt</span>':""}</span>${t.stdin?`<span class="s">Eingabe: ${esc(String(t.stdin).replace(/\n/g," ⏎ "))}</span>`:""}<span class="s">${r.ok?("Ausgabe: "+esc(javaNorm(r.output).slice(0,120))):("⚠️ "+esc((r.errorText||"Fehler").slice(0,140)))}</span></span></div>`);
        }
      } else {
        const solFiles=(sol.files||[]).map(f=>({name:f.name,content:f.content}));
        const runs=c.runs.length?c.runs:[{stdin:""}];
        for(let i=0;i<runs.length;i++){
          const stdin=javaStdinLines(runs[i].stdin);
          const rs=await JavaEngine.runHeadless(solFiles, stdin.slice());
          const ru=await JavaEngine.runHeadless(stuFiles, stdin.slice());
          const ok=rs.ok&&ru.ok&&javaNorm(rs.output)===javaNorm(ru.output);
          rows.push(`<div class="row" style="padding:7px 10px"><span style="font-size:15px;margin-right:8px">${ok?"🟩":"🟧"}</span><span class="grow"><span class="t" style="font-size:13.5px">Lauf ${i+1}${runs[i].stdin?` · Eingabe: ${esc(String(runs[i].stdin).replace(/\n/g," ⏎ "))}`:""}</span><span class="s">Erwartet (Musterlösung): ${rs.ok?esc(javaNorm(rs.output).slice(0,100)):"⚠️ Musterlösung fehlerhaft"}</span><span class="s">Schüler:in: ${ru.ok?esc(javaNorm(ru.output).slice(0,100)):("⚠️ "+esc((ru.errorText||"Fehler").slice(0,120)))}</span></span></div>`);
        }
      }
      if(myToken !== revToken) return;                       // Version wurde inzwischen gewechselt
      if(host) host.innerHTML = rows.join("") || '<span class="muted" style="font-size:13px">Keine Tests definiert.</span>';
    }catch(e){ if(myToken === revToken && host) host.innerHTML = `<span class="muted" style="font-size:13px">⚠️ ${esc(e.message||"Fehler bei der Auswertung")}</span>`; }
    if(myToken === revToken && spin) spin.innerHTML="";
  }
  if(hasChecks) runChecks(sub);
}

/* ---------- Lehrkraft: Musterlösungen verwalten (mehrere je Aufgabe) ---------- */
async function javaSampleManager(assignment, classId){
  shell(`<div class="center-load"><span class="spin"></span>Musterlösungen…</div>`);
  let samples=[];
  try{ samples=await api.javaListSamples(assignment.id); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const list = samples.length ? `<div class="list">${samples.map((s,i)=>`
      <div class="row"><span class="grow"><span class="t clickable" data-open="${s.id}" title="ansehen">${esc(s.title||("Musterlösung "+(i+1)))}</span><span class="s">${esc(fmtDateTime(s.created_at))}${s.released?" · 🏆 für Schüler:innen freigegeben":" · 🔒 privat"}</span></span>
        <span class="acts">
          <button class="abtn" data-open="${s.id}" title="ansehen">👁️</button>
          <button class="abtn" data-rel="${s.id}" data-on="${s.released?1:0}" title="${s.released?'Freigabe zurücknehmen':'für Schüler:innen freigeben'}">${s.released?'🏆':'🔒'}</button>
          <button class="abtn" data-del="${s.id}" title="löschen">🗑️</button>
        </span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">★</span>Noch keine Musterlösungen. Öffne eine Schüler-Abgabe und wähle „★ Als Musterlösung" – oder nutze die 🏆-Musterlösung aus dem Aufgaben-Editor.</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>★ Musterlösungen – ${esc(assignment.title)}</h2></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Freigegebene Musterlösungen (🏆) sehen Schüler:innen über den 🏆-Knopf in der Aufgabe – zusätzlich zur Musterlösung aus dem Aufgaben-Editor (Freigabe dort über 🏆/🔒 in der Aufgabenliste).</span></div>
    ${list}`;
  document.getElementById("back").onclick = ()=> javaTeacherClassView(classId);
  document.querySelectorAll("[data-open]").forEach(b=> b.onclick=()=>{
    const s=samples.find(x=>x.id===b.dataset.open); if(!s) return;
    openModal(`<button class="x" onclick="closeModal()">✕</button><h3 style="margin:0 0 10px">★ ${esc(s.title||"Musterlösung")}</h3><div id="jvSampHost" style="--jvMin:440px;height:58vh;min-height:440px"></div>`, true);
    modalView = new JavaView(document.getElementById("jvSampHost"), { mode:"view" });
    modalView.setData({ files: s.files||[] });
  });
  document.querySelectorAll("[data-rel]").forEach(b=> b.onclick=async()=>{ try{ await api.javaUpdateSample(b.dataset.rel,{released:b.dataset.on!=="1"}); javaSampleManager(assignment, classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Musterlösung wirklich löschen?")) return; try{ await api.javaDeleteSample(b.dataset.del); javaSampleManager(assignment, classId); }catch(e){ toast(e.message||"Fehler","err"); } });
}

/* ---------- Lehrkraft: Schüler-Profil ---------- */
async function javaStudentProfilePage(classId, sid, name, username){
  shell(`<div class="center-load"><span class="spin"></span>Profil…</div>`);
  let ov=null, asgs=[], subs=[], note=null;
  try{
    try{ ov = await api.studentOverview(sid); }catch(e){}
    asgs = await api.javaListAssignments(classId);
    if(asgs.length){ const all = await api.javaClassSubmissions(asgs.map(a=>a.id)); subs = all.filter(s=>s.student_id===sid); }
    try{ note = await api.getStudentNote(classId, sid); }catch(e){}
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const rows = asgs.map(a=>{
    const c=javaChecksOf(a);
    const s=subs.find(x=>x.assignment_id===a.id);
    let st;
    if(!s) st='<span class="badge gray">offen</span>';
    else if(c.mode==="tests"&&c.tests.length){ const res=s.results||{}; const g=c.tests.filter(t=>res[t.id]==="correct").length; st=`<span class="badge ${g===c.tests.length?"":"gold"}">${g}/${c.tests.length} Tests</span>`; }
    else st='<span class="badge gold">abgegeben</span>';
    return `<div class="row ${s?'clickrow':''}" ${s?`data-aopen="${a.id}"`:""} style="${s?'cursor:pointer':''}"><span class="grow"><span class="t">${esc(a.title)}</span></span>${st}${s?'<span style="margin-left:8px;color:#7a8aa0">→</span>':""}</div>`;
  }).join("");
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück zur Klasse</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(name)}</h2></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px;align-items:start">
      <div>
        <div class="card" style="margin-bottom:14px;padding:14px 16px"><b>🪪 Benutzername</b><div style="font-family:monospace;font-size:15px;margin-top:6px">${esc(username||"?")}</div></div>
        <div class="card" style="margin-bottom:14px;padding:14px 16px"><b>🕒 Aktivität</b>
          <div class="muted" style="font-size:13px;margin-top:6px">Letzter Login: ${ov&&ov.last_login?esc(fmtDateTime(ov.last_login)):"–"}<br>Letzte Abgabe: ${ov&&ov.last_submission?esc(fmtDateTime(ov.last_submission)):"–"}</div></div>
        <div class="card" style="padding:14px 16px"><b>🗒️ Private Notizen</b> <span class="muted" style="font-size:11.5px">(nur für Lehrkräfte dieser Klasse)</span>
          <textarea class="input" id="jvNote" style="margin-top:8px;min-height:90px">${esc(note?note.body:"")}</textarea>
          <button class="btn btn-primary btn-sm" id="jvNoteSave" style="margin-top:8px">💾 Speichern</button></div>
      </div>
      <div class="card" style="padding:14px 16px"><b>📝 Aufgaben</b><div class="list" style="margin-top:8px">${rows||'<div class="muted" style="font-size:13px">Noch keine Aufgaben.</div>'}</div></div>
    </div>`;
  document.getElementById("back").onclick = ()=> javaTeacherClassView(classId);
  document.getElementById("jvNoteSave").onclick = async()=>{ try{ await api.saveStudentNote(classId, sid, document.getElementById("jvNote").value); toast("Notiz gespeichert ✓","ok"); }catch(e){ toast(e.message||"Fehler","err"); } };
  document.querySelectorAll("[data-aopen]").forEach(r=> r.onclick=()=> javaReviewSubmission(r.dataset.aopen, sid, name, classId));
}

/* ---------- Vorlagen ---------- */
async function javaTemplatesPage(back){
  const b = subBack(javaTemplatesPage, back) || {label:"← Java · Meine Klassen", go:javaTeacherHome};
  shell(`<div class="center-load"><span class="spin"></span>Vorlagen…</div>`);
  let list=[]; try{ list=await api.javaListTemplates(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const rows = list.length ? `<div class="list">${list.map(t=>`
      <div class="row"><span class="grow"><span class="t${(t.mine||ME.is_admin)?" clickable":""}"${(t.mine||ME.is_admin)?` data-edit="${t.id}" title="bearbeiten"`:""}>${esc(t.title)}</span><span class="s">${t.test_count} Test(s) · von ${esc(t.owner_name)}${t.mine?" (du)":""} · ${t.shared?"🌍 geteilt":"🔒 privat"} · ${esc(fmtDateTime(t.updated_at))}</span></span>
        ${(t.mine||ME.is_admin)?`<button class="abtn" data-edit="${t.id}" title="bearbeiten">✏️</button><button class="abtn" data-share="${t.id}" data-on="${t.shared?1:0}" title="${t.shared?'Freigabe zurücknehmen':'für andere Lehrkräfte freigeben'}">${t.shared?'🌍':'🔒'}</button><button class="abtn" data-del="${t.id}" data-nm="${esc(t.title)}" title="löschen">🗑️</button>`:""}
      </div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Lege eine über „+ Neue Vorlage" an – oder wähle in einer Aufgabe „⭐ Als Vorlage".</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>📋 Aufgaben-Vorlagen</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewTpl">+ Neue Vorlage</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Vorlagen sind wiederverwendbare Aufgaben (Start-Dateien + Tests + Musterlösung). In einer Klasse legst du über <b>📋 aus Vorlage</b> eine neue Aufgabe daraus an. <b>Geteilte</b> Vorlagen können auch andere Lehrkräfte verwenden.</span></div>
    ${rows}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewTpl").onclick = ()=> javaAssignmentEditorPage(null, null, null, true);
  document.querySelectorAll("[data-edit]").forEach(bt=> bt.onclick=()=> javaAssignmentEditorPage(null, {id:bt.dataset.edit}, null, true));
  document.querySelectorAll("[data-share]").forEach(bt=> bt.onclick=async()=>{ const on=bt.dataset.on==="1"; try{ await api.javaUpdateTemplate(bt.dataset.share,{shared:!on}); toast(on?"Freigabe zurückgenommen":"Vorlage freigegeben 🌍","ok"); javaTemplatesPage(); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(bt=> bt.onclick=async()=>{ if(!confirm(`Vorlage „${bt.dataset.nm}" wirklich löschen?`)) return; try{ await api.javaDeleteTemplate(bt.dataset.del); toast("Vorlage gelöscht","ok"); javaTemplatesPage(); }catch(e){ toast(e.message||"Fehler","err"); } });
}
async function javaPickTemplate(classId){
  openModal(`<button class="x" id="tplPickX">×</button><h3 style="margin:0 0 12px">📋 Aufgabe aus Vorlage</h3><div id="tplPickHost"><div class="center-load"><span class="spin"></span>Vorlagen…</div></div>`);
  { const x=document.getElementById("tplPickX"); if(x) x.onclick=closeModal; }
  let list=[]; try{ list=await api.javaListTemplates(); }catch(e){ const h=document.getElementById("tplPickHost"); if(h) h.innerHTML=errBox(e); return; }
  const host=document.getElementById("tplPickHost"); if(!host) return;
  if(!list.length){ host.innerHTML=`<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Öffne eine Aufgabe und wähle „⭐ Als Vorlage", um eine anzulegen.</div>`; return; }
  host.innerHTML=`<div class="muted" style="font-size:12.5px;margin-bottom:8px">Wähle eine Vorlage – sie wird als neue Aufgabe in dieser Klasse geöffnet (du kannst sie vor dem Speichern anpassen).</div>
    <div class="list">${list.map(t=>`
      <div class="row clickrow" data-tpl="${t.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${t.test_count} Test(s) · von ${esc(t.owner_name)}${t.mine?" (du)":""}${t.shared?" · 🌍 geteilt":""}</span></span><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`;
  host.querySelectorAll(".clickrow[data-tpl]").forEach(r=> r.onclick=async()=>{ try{ const tpl=await api.javaGetTemplate(r.dataset.tpl); closeModal(); javaAssignmentEditorPage(classId, null, tpl, false); }catch(e){ toast(e.message||"Fehler","err"); } });
}

/* ---------- Aufgaben-/Vorlagen-Editor ---------- */
let javaEditState=null;
async function javaAssignmentEditorPage(classId, existing, prefillTpl, isTemplate){
  shell(`<div class="center-load"><span class="spin"></span>Editor…</div>`);
  let a=null, sol={files:[],hidden_tests:[]}, tpl=null;
  try{
    if(existing && existing.id){
      if(isTemplate){
        tpl=await api.javaGetTemplate(existing.id);
        if(tpl&&tpl.solution_data) sol={files:tpl.solution_data.files||[],hidden_tests:tpl.solution_data.hidden_tests||[]};   // sonst zerstört Speichern die Musterlösung!
      }
      else{ a=await api.javaGetAssignment(existing.id); const sr=await api.javaGetSolution(existing.id); if(sr&&sr.data) sol={files:sr.data.files||[],hidden_tests:sr.data.hidden_tests||[]}; }
    }
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const src = a || tpl || prefillTpl || null;
  const checks0 = src ? javaChecksOf({checks: src.checks}) : {mode:"none",tests:[],runs:[]};
  if(prefillTpl && prefillTpl.solution_data) sol = { files:(prefillTpl.solution_data.files||[]), hidden_tests:(prefillTpl.solution_data.hidden_tests||[]) };
  const s = javaEditState = {
    classId, isTemplate: !!isTemplate,
    assignId: a?a.id:null, templateId: tpl?tpl.id:null,
    title: src?src.title:"", description: (src&&src.description)||"",
    mode: checks0.mode,
    tests: JSON.parse(JSON.stringify(checks0.tests.concat((sol.hidden_tests||[]).map(t=>Object.assign({},t,{hidden:true}))))),
    runs: JSON.parse(JSON.stringify(checks0.runs.length?checks0.runs:[{stdin:""}])),
    startFiles: JSON.parse(JSON.stringify((src&&src.files_snapshot&&src.files_snapshot.length)?src.files_snapshot:JAVA_DEFAULT_FILES())),
    solFiles: JSON.parse(JSON.stringify((sol.files&&sol.files.length)?sol.files:JAVA_DEFAULT_FILES())),
    sub: "start",
  };
  s.tests.forEach((t,i)=>{ if(!t.id) t.id="t"+Date.now()+"_"+i; });
  const backTo = ()=> s.isTemplate ? javaTemplatesPage() : javaTeacherClassView(classId);
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${s.isTemplate?"← Vorlagen":"← zurück zur Klasse"}</button></div>
    <div class="page-head" style="margin-top:0"><h2>${s.assignId||s.templateId?"✏️ ":"➕ "}${s.isTemplate?"Vorlage":"Aufgabe"}</h2><div class="spacer"></div>
      ${!s.isTemplate?'<button class="btn btn-ghost btn-sm" id="btnAsTpl">⭐ Als Vorlage</button>':''}
      <button class="btn btn-primary btn-sm" id="btnJvSave" style="margin-left:8px">💾 Speichern</button></div>
    <div class="card" style="margin-bottom:12px;padding:14px 16px">
      <div class="field"><label>Titel</label><input class="input" id="jvTitle" maxlength="120" value="${esc(s.title)}"></div>
      <div class="field" style="margin-bottom:0"><label>Beschreibung / Arbeitsauftrag</label><textarea class="input" id="jvDesc" style="min-height:70px">${esc(s.description)}</textarea></div>
    </div>
    <div class="card" style="margin-bottom:12px;padding:14px 16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b>🧪 Auto-Check</b>
        <select class="input" id="jvMode" style="max-width:340px">
          <option value="none" ${s.mode==="none"?"selected":""}>Kein Auto-Check (Bewertung durch Lehrkraft)</option>
          <option value="tests" ${s.mode==="tests"?"selected":""}>Testfälle: Eingaben → erwartete Ausgabe</option>
          <option value="solution" ${s.mode==="solution"?"selected":""}>Musterlösungs-Vergleich (Ausgaben müssen übereinstimmen)</option>
        </select></div>
      <div id="jvCheckHost" style="margin-top:10px"></div>
    </div>
    <div class="card" style="margin-bottom:12px;padding:10px 16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="acts"><button class="abtn on" id="jvSubStart" title="Dateien, die Schüler:innen bekommen">📝 Startdateien</button><button class="abtn" id="jvSubSol" title="Deine Lösung (Schüler:innen sehen sie nie – außer du gibst sie frei)">🏆 Musterlösung</button></span>
        <span class="muted" style="font-size:12px" id="jvSubHint">Diese Dateien bekommen die Schüler:innen als Start.</span></div>
      <div class="muted" style="font-size:12px;margin-top:6px">🙈 <b>Ausgeblendete</b> Startdateien werden im Schüler-Editor nicht angezeigt, aber <b>mitkompiliert</b> – sie sind technisch auslesbar. Lösungen und Prüf-Geheimnisse gehören in die <b>🏆 Musterlösung</b> bzw. in <b>versteckte Testfälle</b>; die liegen serverseitig geschützt.</div>
    </div>
    <div id="jvHost" style="--jvMin:480px;height:60vh;min-height:480px"></div>`;
  document.getElementById("back").onclick = ()=>{ syncJavaEditor(); backTo(); };
  pageView = new JavaView(document.getElementById("jvHost"), { mode:"edit" });
  pageView.setData({ files: s.startFiles });
  function syncJavaEditor(){
    const d = pageView.getData().files;
    if(s.sub==="start") s.startFiles=d; else s.solFiles=d;
    s.title=document.getElementById("jvTitle").value.trim();
    s.description=document.getElementById("jvDesc").value.trim();
  }
  function setSub(which){
    syncJavaEditor();
    s.sub=which;
    document.getElementById("jvSubStart").classList.toggle("on", which==="start");
    document.getElementById("jvSubSol").classList.toggle("on", which==="sol");
    document.getElementById("jvSubHint").textContent = which==="start" ? "Diese Dateien bekommen die Schüler:innen als Start." : "Deine Musterlösung – für Schüler:innen unsichtbar (außer nach Freigabe 🏆).";
    pageView.setData({ files: which==="start"?s.startFiles:s.solFiles });
  }
  document.getElementById("jvSubStart").onclick=()=>setSub("start");
  document.getElementById("jvSubSol").onclick=()=>setSub("sol");
  const renderChecks=()=>{
    const host=document.getElementById("jvCheckHost");
    if(s.mode==="none"){ host.innerHTML='<span class="muted" style="font-size:13px">Abgaben werden nur gesammelt – die Bewertung machst du selbst (Matrix zeigt „abgegeben").</span>'; return; }
    if(s.mode==="solution"){
      host.innerHTML = `<div class="muted" style="font-size:13px;margin-bottom:8px">Die erwartete Ausgabe kommt aus deiner <b>🏆 Musterlösung</b> (unten hinterlegen!). Für Programme mit Scanner-Eingaben kannst du mehrere Eingabe-Läufe definieren – jede Zeile = eine Eingabe.</div>
        <div id="jvRuns">${s.runs.map((r,i)=>`<div class="row" style="padding:7px 10px;align-items:flex-start"><span style="font-weight:800;font-size:12.5px;margin:6px 8px 0 0">Lauf ${i+1}</span><textarea class="input" data-run="${i}" style="min-height:44px;font-family:monospace;font-size:12.5px" placeholder="(keine Eingaben)">${esc(r.stdin||"")}</textarea><button class="abtn" data-rundel="${i}" title="Lauf entfernen" style="margin-left:6px">🗑️</button></div>`).join("")}</div>
        <button class="btn btn-ghost btn-sm" id="jvAddRun" style="margin-top:6px">+ Eingabe-Lauf</button>`;
      host.querySelectorAll("[data-run]").forEach(t=> t.oninput=()=>{ s.runs[+t.dataset.run].stdin=t.value; });
      host.querySelectorAll("[data-rundel]").forEach(bt=> bt.onclick=()=>{ if(s.runs.length<=1){ toast("Mindestens ein Lauf.","err"); return; } s.runs.splice(+bt.dataset.rundel,1); renderChecks(); });
      document.getElementById("jvAddRun").onclick=()=>{ s.runs.push({stdin:""}); renderChecks(); };
      return;
    }
    host.innerHTML = `<div id="jvTests">${s.tests.map((t,i)=>`
      <div class="card" style="margin-bottom:8px;padding:10px 12px;background:var(--line2)">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="input" data-tf="name" data-i="${i}" placeholder="Name des Tests" style="max-width:220px;font-weight:800" value="${esc(t.name||"")}">
          <select class="input" data-tf="match" data-i="${i}" style="max-width:170px"><option value="exact" ${t.match!=="contains"?"selected":""}>Ausgabe exakt</option><option value="contains" ${t.match==="contains"?"selected":""}>Ausgabe enthält</option></select>
          <label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700"><input type="checkbox" data-tf="hidden" data-i="${i}" ${t.hidden?"checked":""}> 🙈 versteckt</label>
          <div class="spacer"></div><button class="abtn" data-tdel="${i}" title="Test löschen">🗑️</button></div>
        <div style="display:flex;gap:8px;margin-top:7px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px"><label style="font-size:11px;font-weight:800;color:var(--muted)">EINGABEN (eine je Zeile, für Scanner)</label><textarea class="input" data-tf="stdin" data-i="${i}" style="min-height:44px;font-family:monospace;font-size:12.5px">${esc(t.stdin||"")}</textarea></div>
          <div style="flex:1;min-width:200px"><label style="font-size:11px;font-weight:800;color:var(--muted)">ERWARTETE AUSGABE</label><textarea class="input" data-tf="expected" data-i="${i}" style="min-height:44px;font-family:monospace;font-size:12.5px">${esc(t.expected||"")}</textarea></div>
        </div></div>`).join("")}</div>
      <button class="btn btn-ghost btn-sm" id="jvAddTest">+ Testfall</button>
      <span class="muted" style="font-size:12px;margin-left:10px">🙈 Versteckte Tests sehen Schüler:innen nicht – sie zählen nur in deiner Einsicht.</span>`;
    host.querySelectorAll("[data-tf]").forEach(el=>{
      const i=+el.dataset.i, f=el.dataset.tf;
      el[el.type==="checkbox"?"onchange":"oninput"]=()=>{ s.tests[i][f]= el.type==="checkbox"?el.checked:el.value; };
    });
    host.querySelectorAll("[data-tdel]").forEach(bt=> bt.onclick=()=>{ s.tests.splice(+bt.dataset.tdel,1); renderChecks(); });
    document.getElementById("jvAddTest").onclick=()=>{ s.tests.push({id:"t"+Date.now(),name:"Test "+(s.tests.length+1),stdin:"",expected:"",match:"exact",hidden:false}); renderChecks(); };
  };
  renderChecks();
  document.getElementById("jvMode").onchange=function(){ s.mode=this.value; renderChecks(); };
  const buildPayload=()=>{
    syncJavaEditor();
    if(!s.title){ toast("Bitte einen Titel eingeben.","err"); return null; }
    const visTests=s.tests.filter(t=>!t.hidden).map(t=>({id:t.id,name:t.name,stdin:t.stdin||"",expected:t.expected||"",match:t.match==="contains"?"contains":"exact"}));
    const hidTests=s.tests.filter(t=>t.hidden).map(t=>({id:t.id,name:t.name,stdin:t.stdin||"",expected:t.expected||"",match:t.match==="contains"?"contains":"exact"}));
    const checks={mode:s.mode, tests:s.mode==="tests"?visTests:[], runs:s.mode==="solution"?s.runs.map(r=>({stdin:r.stdin||""})):[]};
    if(s.mode!=="tests" && s.tests.length && !confirm("Hinweis: Du hast Testfälle angelegt, aber einen anderen Auto-Check-Modus gewählt.\n\nBeim Speichern werden die Testfälle NICHT übernommen. Trotzdem speichern?")) return null;
    return { checks, hidTests: s.mode==="tests"?hidTests:[], files_snapshot:s.startFiles, solFiles:s.solFiles };
  };
  document.getElementById("btnJvSave").onclick=async()=>{
    const btn=document.getElementById("btnJvSave");
    if(btn.disabled) return;
    const p=buildPayload(); if(!p) return;
    btn.disabled=true;
    try{
      if(s.isTemplate){
        const row={title:s.title, description:s.description, files_snapshot:p.files_snapshot, checks:p.checks, solution_data:{files:p.solFiles, hidden_tests:p.hidTests}};
        if(s.templateId) await api.javaUpdateTemplate(s.templateId, row);
        else{ const t=await api.javaCreateTemplate(row); s.templateId=t.id; }
        toast("Vorlage gespeichert ⭐","ok"); javaTemplatesPage(); return;
      }
      const row={class_id:classId, title:s.title, description:s.description, files_snapshot:p.files_snapshot, checks:p.checks};
      let id=s.assignId;
      if(id) await api.javaUpdateAssignment(id, row);
      else{ const na=await api.javaCreateAssignment(row); id=na.id; s.assignId=id; }
      await api.javaSaveSolution(id, {files:p.solFiles, hidden_tests:p.hidTests});
      toast("Aufgabe gespeichert ✓","ok"); javaTeacherClassView(classId);
    }catch(e){ toast(e.message||"Fehler","err"); }
    finally{ btn.disabled=false; }
  };
  { const bt=document.getElementById("btnAsTpl"); if(bt) bt.onclick=async()=>{
      const p=buildPayload(); if(!p) return;
      try{ await api.javaCreateTemplate({title:s.title, description:s.description, files_snapshot:p.files_snapshot, checks:p.checks, solution_data:{files:p.solFiles, hidden_tests:p.hidTests}});
        toast("Als Vorlage gespeichert ⭐","ok"); }
      catch(e){ toast(e.message||"Fehler","err"); } }; }
}

/* ---------- Sandbox ---------- */
async function javaSandbox(back){
  const b = subBack(javaSandbox, back) || {label:"← Zurück", go:()=> (ME.role==="teacher"?javaTeacherHome():javaStudentHome())};
  shell(`<div class="center-load"><span class="spin"></span>Sandbox…</div>`);
  let projects=[]; try{ projects=await api.javaListSandboxProjects(); }catch(e){}
  const list = projects.length ? `<div class="list">${projects.map(p=>`
      <div class="row clickrow" data-id="${p.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(fmtDateTime(p.updated_at))}</span></span>
        <button class="btn btn-sm btn-ghost" data-del="${p.id}" title="löschen">🗑️</button><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🧪</span>Noch keine Projekte. Leg dein erstes an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">${esc(b.label)}</button></div>
    <div class="page-head" style="margin-top:0"><h2>🧪 Java-Sandbox</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewSbx">+ Neues Projekt</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Programmiere frei in Java – mehrere Dateien, Konsole, Scanner-Eingaben – und speichere deine eigenen Projekte.</span></div>
    ${list}`;
  document.getElementById("back").onclick = b.go;
  document.getElementById("btnNewSbx").onclick = ()=> javaSandboxProject(null);
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=(e)=>{ if(e.target.closest("[data-del]")) return; javaSandboxProject(r.dataset.id); });
  document.querySelectorAll("[data-del]").forEach(bt=> bt.onclick=async(e)=>{ e.stopPropagation(); if(!confirm("Projekt löschen?")) return; try{ await api.javaDeleteSandboxProject(bt.dataset.del); javaSandbox(); }catch(err){ toast(err.message||"Fehler","err"); } });
}
let javaSbxState=null;
async function javaSandboxProject(projectId){
  shell(`<div class="center-load"><span class="spin"></span>Lädt…</div>`);
  let proj=null;
  if(projectId){ try{ proj=await api.javaGetSandboxProject(projectId); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; } }
  javaSbxState = { projectId: proj?proj.id:null, title: proj?proj.title:"Mein Projekt" };
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zur Sandbox</button></div>
    <div class="page-head" style="margin-top:0">
      <input class="input" id="jvSbxTitle" style="max-width:280px;font-weight:800" maxlength="80">
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" id="jvSbxSave">💾 Speichern</button>
    </div>
    <div id="jvHost" style="--jvMin:560px;height:72vh;min-height:560px"></div>`;
  document.getElementById("jvSbxTitle").value = javaSbxState.title;
  pageView = new JavaView(document.getElementById("jvHost"), { mode:"free" });
  pageView.setData({ files: (proj&&proj.files&&proj.files.length)?proj.files:JAVA_DEFAULT_FILES() });
  document.getElementById("back").onclick = ()=> javaSandbox();
  document.getElementById("jvSbxSave").onclick = async()=>{
    const title=(document.getElementById("jvSbxTitle").value||"").trim()||"Mein Projekt";
    const files=pageView.getData().files;
    try{
      if(javaSbxState.projectId) await api.javaUpdateSandboxProject(javaSbxState.projectId,{title,files});
      else{ const p=await api.javaCreateSandboxProject({title,files}); javaSbxState.projectId=p.id; }
      toast("Projekt gespeichert ✓","ok");
    }catch(e){ toast(e.message||"Fehler","err"); }
  };
}

const PATCH_NOTES = [
  { v:"2.41", date:"11. August 2026", title:"🐹 Hamster: neues Arbeitslayout", items:[
    `<b>Steuerung sitzt jetzt über dem Territorium.</b> Start, Schritt, Stopp, Tempo – alles direkt über dem Spielfeld statt unter dem Editor.`,
    `<b>📖 Befehle öffnen sich rechts</b> über dem Territorium. Damit kannst du die Befehlsübersicht lesen, <b>während</b> du links weiterprogrammierst.`,
    `<b>Alles selbst einstellbar:</b> Ein Griff unter dem Arbeitsbereich zieht die <b>Höhe</b>, ein Griff zwischen Editor und Territorium das <b>Breitenverhältnis</b>. Beides wird gemerkt und gilt auch bei der nächsten Aufgabe.`,
    `Der Arbeitsbereich startet etwas flacher als bisher, damit die Ausgaben darunter ohne Scrollen sichtbar sind.`,
  ]},
  { v:"2.40", date:"10. August 2026", title:"↕️ Java: Konsole lässt sich jetzt richtig vergrößern", items:[
    `<b>Konsole wächst wirklich mit:</b> Bisher blieb die Konsole beim Ziehen stehen, sobald der Editor seine Mindesthöhe erreicht hatte – es wurde faktisch nur der Editor größer. Jetzt wächst der ganze Bereich mit, sodass sich <b>Editor und Konsole beliebig hoch</b> ziehen lassen.`,
    `<b>Die Seite scrollt beim Ziehen mit:</b> Am unteren Bildschirmrand war früher Schluss. Jetzt rollt die Seite automatisch weiter, solange du ziehst – auch über die Fensterhöhe hinaus.`,
    `Beim Ziehen wird kein Text mehr versehentlich markiert, und in der Abgaben-Ansicht bleibt die Konsole auf eine sinnvolle Höhe begrenzt, damit der Code sichtbar bleibt.`,
  ]},
  { v:"2.39", date:"10. August 2026", title:"🎁 Release 1.0 – Feinschliff", items:[
    `<b>Browser-Tab:</b> In den Werkzeugen stand das Symbol doppelt (einmal als Tab-Icon, einmal im Titel). Der Titel zeigt jetzt nur noch den Namen – das Symbol bleibt das Tab-Icon.`,
    `<b>Impressum &amp; Lizenzen:</b> Der 🌗-Knopf zeigt dort jetzt – wie in der App – den <b>aktuellen</b> Zustand an (☀️ Hell, 🌙 Dunkel, 🌗 Automatisch) und wechselt bei Systemumstellung mit.`,
    `<b>Schulserver:</b> Die Karte „Lehrer-Einladungen" erscheint nur noch dort, wo es auch eine Registrierung gibt. Auf dem Schulserver (Login-only) ist sie ausgeblendet.`,
    `<b>Für den Schulserver neu:</b> fertige Skripte für ein <b>nächtliches Datenbank-Backup</b> samt geprüfter Wiederherstellung – siehe Anleitung im Docker-Paket.`,
  ]},
  { v:"2.38", date:"10. August 2026", title:"📜 Lizenzen & Herkunft – wir nennen die Vorbilder", items:[
    `<b>Neue Seite „Lizenzen &amp; Herkunft":</b> Unten im Footer verlinkt. Dort steht jetzt vollständig, worauf diese Plattform aufbaut – mit Urheber:innen, Lizenzen und Quellen.`,
    `<b>Netzwerke:</b> Das Werkzeug heißt jetzt <b>🌐 Netzwerke</b> (statt „Filius") und nennt offen, dass es ein Nachbau der Lernsoftware <b>FILIUS</b> der Universität Siegen ist. Die Oberflächen-Grafiken stammen aus FILIUS und werden – wie es die <b>GNU GPL v3</b> verlangt – mit Urhebernennung und beiliegendem Lizenztext weitergegeben.`,
    `<b>Hamster:</b> Wir nennen jetzt ausdrücklich das <b>Java-Hamster-Modell von Dr.-Ing. Dietrich Boles</b> (Universität Oldenburg) als Vorbild. Unser Simulator ist eine eigene Neuprogrammierung – aber die Idee stammt von ihm, und das gehört dazugesagt.`,
    `<b>Impressum:</b> Der Satz „Alle Rechte vorbehalten" galt versehentlich auch für fremde Inhalte. Jetzt steht dort korrekt, dass wir die Rechte nur an <b>unseren eigenen</b> Teilen halten.`,
    `Beide Werkzeuge sind <b>keine offiziellen Produkte</b> der genannten Projekte oder Universitäten.`,
  ]},
  { v:"2.37", date:"10. August 2026", title:"🔒 Sicherheits-Update", items:[
    `<b>Lehrer-Registrierung neu:</b> Statt eines festen Lehrer-Codes gibt es jetzt <b>persönliche Einladungscodes</b>. Die Administration erstellt sie im Admin-Bereich unter „✉️ Lehrer-Einladungen"; jeder Code gilt <b>genau einmal</b> und läuft ab. <i>Der alte Code funktioniert nicht mehr.</i>`,
    `<b>Konten besser geschützt:</b> Das Zurücksetzen eines Schüler-Passworts ist nur noch möglich, wenn die Schüler:in ohne dein Zutun in deiner Klasse ist (selbst beigetreten oder von der Administration eingetragen) – so kann sich niemand die Berechtigung selbst verschaffen. Außerdem lassen sich nur noch <b>Schüler:innen</b> in Klassen eintragen und zurücksetzen.`,
    `<b>Abgaben:</b> Beim Hamster kann – wie bei den anderen Werkzeugen längst – nichts mehr in Klassen abgegeben werden, in denen man nicht Mitglied ist.`,
    `<b>Filius:</b> Die Webbrowser-Vorschau zeigt Schüler-Seiten jetzt über eine strenge Positivliste an (nur erlaubte Elemente) – eingebauter Schadcode kann nicht mehr ausgeführt werden.`,
    `<b>Java – wichtig für Lehrkräfte:</b> 🙈 ausgeblendete Startdateien werden im Editor nicht angezeigt, aber <b>mitkompiliert</b> und sind daher auslesbar. Sie sind <b>kein Versteck für Lösungen</b>. Musterlösungen und versteckte Testfälle liegen weiterhin serverseitig geschützt – dort gehören Geheimnisse hin.`,
  ]},
  { v:"2.36", date:"10. August 2026", title:"🌗 Heller Editor im hellen Design", items:[
    `<b>Echte Wahl zwischen hell und dunkel:</b> Im hellen Design sind der <b>Java-Editor samt Konsole</b> und der <b>Hamster-Editor</b> jetzt hell – weißer Hintergrund, dunkle Schrift und eine helle Syntax-Farbpalette. Im dunklen Design bleibt alles wie gewohnt dunkel.`,
    `Auch die <b>Hover-Erklärungen</b> im Java-Editor und die <b>Eingabezeile der Konsole</b> passen sich dem Design an.`,
  ]},
  { v:"2.35", date:"10. August 2026", title:"☕ Java-Ausbau: Historie, Musterlösungen, farbiger Editor & mehr", items:[
    `<b>Farbiger Code wie beim Hamster:</b> Der Java-Editor hat jetzt Syntax-Farben im dunklen Design – und beim <b>Zeigen auf einen Methodennamen</b> erscheint eine Erklärung mit der Signatur (eigene Methoden UND eingebaute wie println, nextInt, substring …).`,
    `<b>Mehrere Abgaben mit Historie:</b> Wie beim Hamster kannst du jetzt mehrfach abgeben. Die <b>Historie steht unter der Konsole</b> – jede Abgabe lässt sich wieder laden (📂) oder zur aktuellen machen (⭐).`,
    `<b>Bearbeitungsstand wird gesichert:</b> Verlässt du eine Aufgabe, wird dein Stand automatisch gespeichert und beim nächsten Öffnen wiederhergestellt (auch alle 20 Sekunden zwischendurch).`,
    `<b>Lehrkräfte:</b> In der Einsicht ist der Code jetzt <b>live bearbeitbar</b> (▶ läuft, wird nicht gespeichert), mit Versions-Umschalter – und „★ Als Musterlösung" speichert die Lösung. <b>Mehrere Musterlösungen</b> je Aufgabe, einzeln freigebbar (★-Manager in der Aufgabenliste).`,
    `<b>Editor &amp; Konsole:</b> Höhe beider Bereiche per <b>Ziehgriff</b> einstellbar; die Konsole scrollt nach jeder Ausgabe zuverlässig ganz nach unten; Enter rückt wie beim Hamster ein (kein Extra-Tab nach <code>{</code>).`,
    `<b>Java-Sprache:</b> <b>Eigene generische Klassen</b> (class Box&lt;T&gt;, auch Paar&lt;K,V&gt;), Boolean.parseBoolean, und Kommazahlen verlangen jetzt konsequent den <b>Punkt</b> – „3,5" gibt eine verständliche Fehlermeldung.`,
    `<b>Plattform:</b> Der <b>Zurück-Knopf des Browsers</b> führt jetzt zur vorherigen Seite der Plattform. Im Browser-Tab zeigt jedes Tool <b>sein Emoji und seinen Namen</b>; auf Login und Tool-Auswahl steht das Schullogo.`,
  ]},
  { v:"2.34", date:"10. August 2026", title:"🏫 Schul-Logo überall", items:[
    `Das offizielle <b>GW-Logo des Gymnasiums Wesermünde</b> ersetzt den Hamster oben links in der Kopfzeile, auf der Login-Seite und im Impressum. (Der 🐹 bleibt natürlich das Maskottchen des Hamster-Simulators!)`,
  ]},
  { v:"2.33", date:"9. August 2026", title:"🤝 Namenszug & Impressum im Footer", items:[
    `Die Plattform ist jetzt offiziell ein Gemeinschaftsprojekt: Der Footer nennt <b>Laurens Offinger &amp; Sebastian Glücks</b>.`,
    `Neue, eigene <b>Impressum-Seite im Plattform-Design</b> (hell &amp; dunkel) mit allen Angaben der Schule – dezent im Footer verlinkt.`,
  ]},
  { v:"2.32", date:"9. August 2026", title:"☕ NEU: Java – die vierte Werkstatt (echte Programmier-IDE)", items:[
    `<b>Java ist da!</b> In der Tool-Auswahl gibt es jetzt <b>☕ Java</b> – eine richtige Programmier-IDE im Browser (angelehnt an Codeboard): <b>mehrere Dateien</b>, Editor mit Zeilennummern &amp; Undo, <b>Konsole mit Eingaben</b> (Scanner), ▶ Ausführen/⏹ Stopp.`,
    `<b>Volles Schul-Java:</b> Klassen &amp; Objekte, <b>Vererbung</b> (extends/super/Überschreiben), abstrakte Klassen, Polymorphie, static, private/protected, Arrays (auch 2D), ArrayList, String-/Math-Methoden, switch, for-each – mit deutschen Fehlermeldungen samt Datei + Zeile.`,
    `<b>Aufgaben wie gewohnt:</b> Klassen, Aufgaben mit Start-Dateien (auch schreibgeschützt/versteckt), Abgaben, Abgabe-Matrix, Rückmeldungen, Vorlagen, Sandbox.`,
    `<b>Auto-Check pro Aufgabe wählbar:</b> <b>Testfälle</b> (Eingaben → erwartete Ausgabe, exakt oder „enthält", optional 🙈 versteckte Tests) <b>oder</b> <b>Musterlösungs-Vergleich</b> (deine Lösung liefert die Soll-Ausgabe) – oder ganz ohne.`,
    `<b>Sicher:</b> Musterlösungen und versteckte Tests liegen serverseitig geschützt (nur Lehrkräfte) – Schüler:innen können sie nicht über die API auslesen.`,
  ]},
  { v:"2.31", date:"16. Juli 2026", title:"🧭 Navigation, Vollbild-Matrix & Vorlagen", items:[
    `<b>Zurück führt jetzt richtig:</b> Öffnest du <b>Vorlagen, Sandbox, Datenbanken oder Netzwerke</b> aus einer Klasse heraus, bringt „zurück" dich wieder in <b>diese Klasse</b> – statt in die Klassenübersicht.`,
    `<b>Abgabe-Matrix im Vollbild:</b> In jeder Klassenansicht (alle Tools) öffnet <b>⛶ Vergrößern</b> die Abgabe-Matrix über die <b>gesamte Bildschirmbreite</b> – mit Namenssuche; ein Klick auf eine Zelle öffnet wie gewohnt die Abgabe.`,
    `<b>Hamster:</b> In der Klassenansicht gibt es jetzt oben einen <b>📋 Vorlagen</b>-Knopf (wie bei SQL und Filius); auf der Startseite wurden <b>Vorlagen</b> und <b>Sandbox</b> in eine einheitliche Reihenfolge gebracht.`,
  ]},
  { v:"2.30", date:"5. Juli 2026", title:"🔄 Komfort & Filius-Feinschliff", items:[
    `<b>Aktualisieren-Schaltfläche</b> neben dem Klassennamen – in allen Tools, für Lehrkräfte und Schüler:innen.`,
    `<b>Rückmeldungs-Vorschau:</b> In der Aufgabenübersicht siehst du jetzt zu jeder Aufgabe direkt eine Vorschau der freigegebenen Rückmeldung deiner Lehrkraft (beim Hamster die Rückmeldung zur aktuellen Abgabe).`,
    `<b>Hamster:</b> Beim Laden einer eigenen Abgabe wird das Territorium jetzt sauber auf den Aufgaben-Start zurückgesetzt.`,
    `<b>Filius – Editor:</b> Das Fenster ist jetzt immer hoch genug, dass die Rechner-Konfiguration <b>und</b> alle Bausteine links ohne Scrollen sichtbar sind.`,
    `<b>Filius – Desktop:</b> Die Programm-Symbole rutschen nicht mehr hinter die Leiste; die Taskleiste sitzt jetzt korrekt unten.`,
    `<b>Filius – Bildbetrachter:</b> Der „Öffnen"-Dialog erscheint jetzt <b>innerhalb</b> des virtuellen Desktops (wie der Datei-Explorer).`,
    `<b>Filius – Kabel:</b> Ein <b>Rechtsklick beendet den Kabelmodus</b>.`,
    `<b>Filius – Software-Installation:</b> Programme jetzt als zweispaltige, alphabetische Liste mit <b>Häkchen</b>; „Änderungen annehmen" bleibt immer sichtbar.`,
  ]},
  { v:"2.28", date:"1. Juli 2026", title:"🌐 Filius Wellen 2+3: Betriebssystem, Routing & Anwendungen", items:[
    `<b>Virtuelles Dateisystem + Datei-Explorer + Text-Editor:</b> Jeder Rechner hat jetzt Ordner & Dateien (Reiter <b>📁 Dateien</b> im Simulationsmodus) – anlegen, bearbeiten, löschen, importieren, herunterladen. Der <b>Webserver</b> liefert die Seite aus <code>/webserver/index.html</code>, die du im Editor bearbeiten kannst.`,
    `<b>Komplette Befehlszeile:</b> zusätzlich zu ping/ipconfig/host/traceroute jetzt <code>ls, cd, pwd, mkdir, touch, cat, echo … > datei, cp, mv, rm</code> sowie <code>arp</code> (ARP-Tabelle) und <code>route</code> (Weiterleitungstabelle). <code>help</code> listet alles auf.`,
    `<b>E-Mail (SMTP/POP3):</b> Richte einen <b>E-Mail-Server</b> mit Maildomain und Konten ein und auf den Rechnern das <b>E-Mail-Programm</b> – dann <b>Mails senden und abrufen</b> (Reiter ✉️ E-Mail). Neue Aufgaben-Prüfung „E-Mail zustellbar".`,
    `<b>Gnutella (Peer-to-Peer):</b> Dateien im Ordner <code>/peer2peer</code> teilen, im Netz <b>suchen und herunterladen</b> (Reiter 🔗 Gnutella).`,
    `<b>Echo-Server + Einfacher Client:</b> Verbindung testen und eine Nachricht zurückspiegeln lassen (Reiter 🔌 Client).`,
    `<b>Firewall:</b> pro Rechner aktivierbar – eingehende <b>Pings (ICMP)</b> oder bestimmte <b>Ports</b> (z. B. 80) blockieren. Passt perfekt zu „NICHT erreichbar"-Prüfungen.`,
    `<b>Statische Routen:</b> Am Router lassen sich jetzt <b>manuelle Weiterleitungs-Einträge</b> (Ziel · Netzmaske · nächster Hop) eintragen – für Routing-Aufgaben ohne automatisches Routing.`,
    `<b>Simulationsgeschwindigkeit:</b> Regler (🐢–🐇) in der Werkzeugleiste steuert das Tempo der Paket-Animation. <b>Bildbetrachter</b> für importierte Bilddateien im Datei-Explorer.`,
  ]},
  { v:"2.27", date:"1. Juli 2026", title:"🌐 Filius Welle 1: Netzwerk sichtbar machen", items:[
    `<b>Fix vorab:</b> Filius-Klassen ließen sich zunächst nicht anlegen (DB-Regel). Nach Einspielen von <code>schema_update_phaseW.sql</code> funktioniert das Anlegen von Filius-Klassen.`,
    `<b>MAC-Adressen:</b> Jede Netzwerkkarte hat jetzt eine feste <b>physische Adresse (MAC)</b> – sichtbar in der Rechner-/Router-Konfiguration und im Befehl <code>ipconfig</code>.`,
    `<b>Datenaustausch-Fenster (Paket-Trace):</b> Im Simulationsmodus hat jeder Rechner den neuen Reiter <b>📊 Datenaustausch</b> – nach einem <code>ping</code> siehst du die einzelnen <b>Rahmen</b> (ARP „Wer hat …?" + Antwort, dann die ICMP Echo-Anfragen/-Antworten) mit Quelle, Ziel, Protokoll und Schicht.`,
    `<b>Schichtenmodell:</b> Klick auf einen Rahmen zeigt die <b>4 Schichten</b> (Anwendung · Transport · Vermittlung/IP · Netzzugang/Ethernet) mit MAC- und IP-Adressen – so wird die Kapselung sichtbar.`,
    `<b>Switch lernt mit (SAT):</b> Ein Klick auf einen <b>Switch</b> (im Simulationsmodus) zeigt seine <b>Source-Address-Table</b> – welche MAC-Adresse an welchem Port zuletzt gesehen wurde; füllt sich automatisch beim Datenverkehr, „Tabelle leeren" möglich.`,
    `<b>Weiterleitungstabelle:</b> Ein Klick auf einen <b>Router</b> (im Simulationsmodus) zeigt seine <b>Weiterleitungstabelle</b> (Ziel · Netzmaske · nächstes Gateway · Schnittstelle) inklusive der MAC je Schnittstelle.`,
    `<b>ping</b> gibt jetzt originalgetreuere Ausgaben (TTL, Paketstatistik). Das ist Welle 1 des großen Filius-Ausbaus – weitere Wellen (Betriebssystem/Befehlszeile, Routen-UI, E-Mail, Gnutella, Firewall …) folgen.`,
  ]},
  { v:"2.26", date:"1. Juli 2026", title:"🌐 Neues Tool: Filius – Netzwerksimulator", items:[
    `<b>Filius ist da!</b> Nach 🐹 Hamster und 🗄️ SQL gibt es jetzt als drittes Lern-Tool den <b>🌐 Netzwerksimulator</b> (nach dem Vorbild von FILIUS) – direkt im Browser, ohne Installation, im gleichen Design.`,
    `<b>Netzwerke bauen (Entwurfsmodus):</b> Komponenten per Klick platzieren – <b>Notebook, Rechner, Switch, Router</b> und Textfelder –, mit dem <b>🔌 Kabel</b>-Werkzeug verbinden und per Doppelklick konfigurieren (IP-Adresse, Subnetzmaske, Gateway, DNS, DHCP).`,
    `<b>Simulieren:</b> Im ▶ Simulationsmodus öffnet ein Klick auf einen Rechner die <b>Befehlszeile</b> (<code>ping</code>, <code>ipconfig</code>, <code>host</code>, <code>traceroute</code>) und – wo installiert – einen <b>Webbrowser</b>. Datenpakete werden auf den Leitungen animiert. Es funktionieren echtes <b>Subnetz-/Gateway-Routing</b> (auch über mehrere Router mit automatischem Routing), <b>DNS</b>, <b>Webserver</b> und <b>DHCP</b>.`,
    `<b>Aufgaben-Klassen wie gewohnt:</b> Lehrkräfte stellen Aufgaben mit automatisch bewerteten <b>Prüfungen</b> (z. B. „PC1 erreicht PC2 per Ping", „mind. 1 Router", „PC1 hat IP im Netz 192.168.0.0/24", „Webseite erreichbar", „DNS löst auf"). Dazu <b>Abgabe-Matrix, Einsicht, Rückmeldungen, Muster-Netzwerk freigeben, Vorlagen, Netzwerk-Bibliothek</b> und eine <b>🧪 Sandbox</b> mit privaten Projekten – genau wie beim SQL-Playground.`,
    `<b>Schüler:innen</b> treten per Klassencode bei, bauen das Netz, klicken <b>🔍 Netzwerk prüfen &amp; speichern</b> und sehen sofort, welche Prüfungen bestanden sind.`,
  ]},
  { v:"2.25", date:"1. Juli 2026", title:"Vorhandene Schüler:innen hinzufügen & Sandbox-Projekte", items:[
    `<b>Vorhandene:n Schüler:in hinzufügen:</b> Im Dialog „📥 Importieren" (Klassenansicht) kannst du jetzt eine:n bereits registrierte:n Schüler:in einfach <b>per Benutzername</b> zur Klasse hinzufügen – gilt für Hamster- und SQL-Klassen.`,
    `<b>SQL-Sandbox mit Projekten:</b> Die Sandbox funktioniert jetzt wie beim Hamster – du legst <b>eigene Projekte</b> an, die gespeichert werden (Datenbank + Abfrage), und öffnest sie später wieder.`,
    `In der Sandbox wird das <b>Datenbank-Schema standardmäßig angezeigt</b>, und du kannst deinen SQL-Code als <b>.sql herunterladen</b> bzw. eine <b>.sql-Datei hochladen</b>.`,
  ]},
  { v:"2.24", date:"1. Juli 2026", title:"Kleinigkeiten: Auswahl, Titel, Tool-Name", items:[
    `In der Schüler-Ansicht ist die <b>aktuell gewählte Teilaufgabe</b> jetzt <b>grün</b> hervorgehoben (statt grau).`,
    `Die Klassen-Übersicht im SQL-Tool heißt jetzt schlicht <b>„Meine Klassen"</b> (ohne Icon), wie beim Hamster.`,
    `In der Titelleiste steht neben dem 🏠 jetzt der <b>Name des aktuellen Tools</b>.`,
  ]},
  { v:"2.23", date:"1. Juli 2026", title:"SQL-Editor: Aufgabentext direkt in der Teilaufgaben-Liste", items:[
    `In der Teilaufgaben-Liste steht jetzt direkt der <b>Aufgabentext</b> neben der Nummer (die Zwischenüberschrift „Teilaufgabe N" entfällt) – so erkennst du jede Teilaufgabe sofort am Inhalt.`,
  ]},
  { v:"2.22", date:"1. Juli 2026", title:"SQL-Aufgaben-Editor: Teilaufgaben über die volle Breite", items:[
    `Der Aufgaben-Editor ist jetzt <b>untereinander</b> aufgebaut: zuerst die <b>Teilaufgaben-Liste über die volle Breite</b> (jede als Karte mit Nummer, Vorschau und den Schaltflächen ↑ ↓ 🗑 rechts), darunter der <b>Editierbereich</b> der gewählten Teilaufgabe (Aufgabentext, Musterlösung, Ausführen).`,
    `Beim Klick auf eine Teilaufgabe springt die Ansicht automatisch zum Editierbereich.`,
  ]},
  { v:"2.21", date:"1. Juli 2026", title:"SQL-Aufgaben-Editor: schönere Teilaufgaben-Liste", items:[
    `Die <b>Teilaufgaben-Liste</b> im Aufgaben-Editor ist jetzt deutlich übersichtlicher: jede Teilaufgabe ist eine eigene <b>Karte</b> mit <b>Nummern-Marke</b>, klar erkennbarer Auswahl (grün hervorgehoben) und einer auf zwei Zeilen begrenzten <b>Vorschau</b> des Aufgabentexts.`,
  ]},
  { v:"2.20", date:"30. Juni 2026", title:"SQL-Klassen: volle Verwaltung wie beim Hamster", items:[
    `In einer SQL-Klasse gibt es jetzt oben Schnellzugriffe auf <b>🗄️ Datenbanken</b> und <b>📋 Vorlagen</b>.`,
    `<b>Schüler:innen-Verwaltung</b> wie im Hamster-Tool: <b>📥 Importieren</b>, einzelne entfernen, Passwort zurücksetzen und ein Klick auf den Namen öffnet das <b>Schüler-Profil</b> (Fortschritt je Aufgabe + private Notizen).`,
    `<b>Klassen suchen</b> funktioniert jetzt auch im SQL-Tool zuverlässig (Suche + Sortierung über der Klassenliste).`,
    `<b>Admin:</b> beim Anlegen einer Klasse lässt sich jetzt das <b>Tool</b> (Hamster oder SQL) auswählen.`,
  ]},
  { v:"2.19", date:"30. Juni 2026", title:"SQL-Sandbox: echte Datenbanken", items:[
    `Die <b>Standard-Datenbanken</b> in der 🧪 Sandbox sind entfernt. Stattdessen arbeitest du mit <b>echten Datenbanken</b>.`,
    `<b>Lehrkräfte</b> sehen in der Sandbox alle <b>geteilten</b> Datenbanken <i>und ihre eigenen</i> (auch private). Beim Anlegen einer Datenbank legst du mit dem Schalter <b>🌍 Freigeben</b> fest, ob sie allen (auch Schüler:innen) in der Sandbox zur Verfügung steht.`,
    `<b>Schüler:innen</b> sehen in der Sandbox die geteilten Datenbanken sowie alle, zu denen ihnen eine <b>Aufgabe</b> gestellt wurde – so können sie gezielt üben.`,
    `Nebenbei lädt das SQL-Tool etwas schneller (die alten Beispieldaten werden nicht mehr geladen).`,
    `<b>Sicherheit:</b> Der Beitritt zu einer Klasse ist jetzt fest an den <b>Klassencode</b> (bzw. den Lehrer-Import) gebunden – ein Eintragen in fremde Klassen über Umwege ist nicht mehr möglich.`,
  ]},
  { v:"2.18", date:"30. Juni 2026", title:"Politur: SQL-Bedienung, Klassen-Funktionen, Vorlagen", items:[
    `<b>Datenbank-Schema standardmäßig offen</b> – beim Aufgaben-Erstellen und beim Lösen. Klappst du es beim Lösen zu (oder auf), gilt das für <b>alle Teilaufgaben</b> der Aufgabe.`,
    `<b>Ergebnis bleibt sichtbar:</b> Öffnest du eine schon gespeicherte Teilaufgabe, wird deine Abfrage <b>automatisch ausgeführt</b> und das Ergebnis direkt angezeigt.`,
    `<b>Fortschrittsbalken</b> je Aufgabe in der Schüler-Aufgabenübersicht (🟩 richtig · 🟧 bearbeitet · ⬜ offen); größerer Status-Punkt; beim Öffnen einer Teilaufgabe wird nach oben gescrollt.`,
    `<b>Aufgaben-Editor:</b> in der Teilaufgaben-Liste stehen oben Nummer + Schaltflächen, darunter der Vorschautext über die ganze Breite.`,
    `<b>SQL-Klassen können jetzt alles wie Hamster-Klassen:</b> Klasse an eine andere Lehrkraft <b>übergeben</b>, als Co-Lehrkraft <b>verlassen</b>, Einlade-<b>Code deaktivieren</b> bzw. <b>neu erzeugen</b> (jeweils mit Rückfrage) und umbenennen; eigene Lehrkräfte-Liste.`,
    `<b>Vorlagen bearbeiten:</b> in der 📋 Vorlagen-Übersicht gibt es jetzt <b>+ Neue Vorlage</b> und du kannst bestehende Vorlagen <b>bearbeiten</b>.`,
    `<b>Allgemein:</b> neuer <b>🏠-Knopf</b> in der Titelleiste führt zur Tool-Auswahl (dafür ist „Tool wechseln" aus dem Konto-Menü entfernt); im <b>Dark-Mode</b> ist der Benutzername jetzt hell; „je Zelle" aus der Abgabe-Matrix entfernt; in der Aufgabenliste wird beim Überfahren nur der <b>Titel</b> unterstrichen.`,
  ]},
  { v:"2.17", date:"28. Juni 2026", title:"SQL-Playground: Aufgaben-Vorlagen", items:[
    `<b>Aufgabe als Vorlage speichern:</b> Im Aufgaben-Editor gibt es jetzt <b>⭐ Als Vorlage</b> – die komplette Aufgabe (Datenbank + alle Teilaufgaben + Musterlösungen) wird als wiederverwendbare Vorlage gespeichert.`,
    `<b>Aus Vorlage erstellen:</b> In einer Klasse legst du über <b>📋 aus Vorlage</b> mit einem Klick eine neue Aufgabe aus einer Vorlage an – du kannst sie vor dem Speichern noch anpassen. So musst du wiederkehrende Aufgaben nicht doppelt bauen.`,
    `<b>Vorlagen-Bibliothek</b> (Knopf <b>📋 Vorlagen</b> auf „SQL · Meine Klassen"): Vorlagen ansehen, löschen und – wie bei Datenbanken – <b>für andere Lehrkräfte freigeben</b> (🌍) oder privat halten.`,
    `Damit ist der SQL-Playground rund: Datenbanken, Aufgaben, Lösen + Benotung, Auswertung, Rückmeldungen und Vorlagen.`,
  ]},
  { v:"2.16", date:"28. Juni 2026", title:"SQL-Playground: Rückmeldungen zu Abgaben", items:[
    `<b>Kommentar zur Abgabe:</b> In der Korrekturansicht (📊 Abgabe-Matrix → Zelle anklicken) kannst du der/dem Schüler:in jetzt eine <b>Rückmeldung</b> schreiben. Mit dem Schalter <b>„Für Schüler:in sichtbar"</b> entscheidest du, ob sie freigegeben wird – nicht freigegebene Kommentare bleiben für Schüler:innen vollständig unsichtbar (serverseitig abgesichert).`,
    `<b>Schüler:innen sehen freigegebene Rückmeldungen</b> oben in ihrer Aufgabe (💬 Rückmeldung deiner Lehrkraft).`,
    `<b>Nächste Schritte:</b> Aufgaben-Vorlagen (Aufgaben als Vorlage speichern und wiederverwenden).`,
  ]},
  { v:"2.15", date:"28. Juni 2026", title:"SQL-Playground: Musterlösung freigeben & Abgaben einsehen", items:[
    `<b>Musterlösung freigeben:</b> In der SQL-Aufgabenliste gibt es pro Aufgabe einen neuen Schalter <b>🔒/🏆</b>. Ist er aktiv (🏆 „Lösung frei"), können Schüler:innen die <b>Musterlösung jeder Teilaufgabe</b> in ihrer Aufgabe einblenden – vorher bleibt sie verborgen.`,
    `<b>Abgaben einsehen:</b> In der <b>📊 Abgabe-Matrix</b> kannst du jetzt auf jede Zelle mit einer Abgabe klicken und die <b>Lösung der/des Schüler:in</b> ansehen – pro Teilaufgabe ihr/sein SQL, der Status (✓/~) und die Musterlösung. Mit <b>▶</b> lässt sich die Schüler-Abfrage gegen die Aufgaben-Datenbank laufen lassen (reine Ansicht, nichts wird verändert).`,
    `<b>Nächste Schritte:</b> Rückmeldungen/Kommentare zu Abgaben (für Schüler:innen freigebbar) und Aufgaben-Vorlagen.`,
  ]},
  { v:"2.14", date:"28. Juni 2026", title:"SQL-Playground: Abgabe-Matrix für Lehrkräfte", items:[
    `<b>Neue Abgabe-Matrix</b> in jeder SQL-Klasse: eine Tabelle <b>Schüler:innen × Aufgaben</b>. Jede Zelle zeigt auf einen Blick, wie viele <b>Teilaufgaben</b> der/die Schüler:in schon gelöst hat – als kleiner Farbbalken und als <b>Quote</b> (z. B. „3/5").`,
    `<b>Farben je Teilaufgabe:</b> 🟩 richtig · 🟧 bearbeitet, aber noch nicht richtig · ⬜ noch nicht bearbeitet. Sind <b>alle</b> Teilaufgaben richtig, erscheint ein <b>★</b>. Beim Überfahren mit der Maus zeigt jede Zelle die genaue Aufschlüsselung.`,
    `<b>Schüler:in suchen:</b> Über der Matrix gibt es ein Suchfeld – praktisch bei großen Klassen.`,
    `<b>Nächste Schritte:</b> Lehrer-Korrektur & Kommentare zu Abgaben sowie ein Schalter zum <b>Freigeben der Musterlösung</b>.`,
  ]},
  { v:"2.13", date:"28. Juni 2026", title:"SQL-Playground: Aufgaben lösen & automatische Bewertung", items:[
    `<b>Schüler:innen können SQL-Aufgaben jetzt lösen:</b> Aufgabe öffnen → links die <b>Teilaufgaben</b>, rechts Aufgabentext, ausklappbares <b>Datenbank-Schema</b>, ein <b>SQL-Editor</b> mit <b>▶ Ausführen</b> (Ergebnis-Tabelle) und <b>💾 Lösung speichern</b>.`,
    `<b>Automatische Bewertung:</b> Bei Teilaufgaben mit „Ergebnis vergleichen" prüft das System sofort, ob das Ergebnis stimmt – <b>✓ richtig</b> oder <b>~ noch nicht richtig</b>. Der Vergleich passiert <b>sicher auf dem Server</b>; die Musterlösung bleibt verborgen.`,
    `<b>Fortschritt sichtbar:</b> In der Aufgabenliste der Klasse steht je Aufgabe <b>offen · in Bearbeitung · bestanden</b>; in der Aufgabe selbst zeigt jede Teilaufgabe ihren Status.`,
    `Hat die Lehrkraft die <b>Musterlösung freigegeben</b>, können Schüler:innen sie pro Teilaufgabe einblenden (Freigabe-Schalter für Lehrkräfte folgt im nächsten Update).`,
    `<b>Nächste Schritte:</b> Lehrer-Auswertung – Abgabe-Matrix (grün/gelb/grau pro Teilaufgaben-Quote) und Korrektur/Kommentare.`,
  ]},
  { v:"2.12", date:"28. Juni 2026", title:"SQL-Playground: Aufgaben-Editor", items:[
    `Lehrkräfte können jetzt <b>SQL-Aufgaben stellen</b> (in einer SQL-Klasse → „+ Aufgabe stellen"). Eine Aufgabe besteht aus <b>einer Datenbank</b> (aus der 🗄️ Bibliothek) und beliebig vielen <b>Teilaufgaben</b>.`,
    `Pro Teilaufgabe (linke Liste): <b>Aufgabentext</b>, eine <b>Musterlösung (SQL)</b> mit <b>▶ Ausführen</b> + Ergebnis-Vorschau und der Schalter <b>„Ergebnis mit Musterlösung vergleichen"</b> (für die spätere automatische Bewertung). Teilaufgaben lassen sich <b>hinzufügen, umsortieren (↑↓) und löschen</b>.`,
    `Aufgaben können <b>veröffentlicht</b> oder als <b>Entwurf</b> gehalten, umsortiert, bearbeitet und gelöscht werden.`,
    `Beim Speichern wird die Datenbank <b>in die Aufgabe eingefroren</b> (spätere Änderungen an der Bibliotheks-Datenbank verändern bestehende Aufgaben nicht), die Musterlösungen werden <b>geprüft</b> und das erwartete Ergebnis <b>sicher hinterlegt</b> (für Schüler:innen verborgen).`,
    `<b>Nächster Schritt:</b> Schüler:innen lösen diese Aufgaben und bekommen automatisches Feedback (folgt im nächsten Update).`,
  ]},
  { v:"2.11", date:"28. Juni 2026", title:"SQL-Playground: Datenbank-Bibliothek", items:[
    `Neuer Knopf <b>🗄️ Datenbanken</b> im SQL-Tool: Lehrkräfte legen hier eigene <b>Datenbanken</b> an – Name vergeben und den <b>SQL-Code</b> eingeben, der die Datenbank erstellt (Tabellen + Daten).`,
    `<b>▶ Ausführen</b> testet den Code sofort und zeigt darunter das entstandene <b>Datenbank-Schema</b> (Tabellen + Spalten, Primärschlüssel hervorgehoben). Gespeichert wird nur, wenn der Code fehlerfrei läuft.`,
    `<b>Teilen:</b> Eine Datenbank kann <b>für andere Lehrkräfte freigegeben</b> (oder privat gehalten) werden; in der Liste steht jeweils der <b>Ersteller</b>. Geteilte Datenbanken sehen andere Lehrkräfte nur zum Ansehen/Verwenden.`,
    `SQL-Code lässt sich aus einer <b>.sql-Datei laden</b> (📂) und als <b>.sql herunterladen</b> (⬇️).`,
    `Diese Datenbanken sind die Grundlage für die <b>SQL-Aufgaben</b>, die als Nächstes kommen.`,
  ]},
  { v:"2.10", date:"28. Juni 2026", title:"SQL-Playground: SQL-Sandbox (erste Funktion)", items:[
    `<b>🧪 SQL-Sandbox</b> im SQL-Tool: Wähle eine <b>Beispiel-Datenbank</b> (SQL Island oder Fußball – oder eine leere), klappe das <b>Datenbank-Schema</b> auf, schreib eine <b>SQL-Abfrage</b> und führe sie mit <b>▶ Ausführen</b> (oder <b>Strg+Enter</b>) aus – das Ergebnis erscheint als Tabelle.`,
    `Die Datenbank läuft <b>komplett im Browser</b> (SQLite) – du kannst gefahrlos alles ausprobieren (auch <code>CREATE</code>/<code>INSERT</code>/<code>UPDATE</code>); mit <b>↺ Zurücksetzen</b> ist die Datenbank wieder im Ausgangszustand. In der Sandbox wird nichts gespeichert.`,
    `<b>Klassen, Aufgaben mit Teilaufgaben und Abgaben</b> für den SQL-Playground folgen in den nächsten Updates.`,
  ]},
  { v:"2.9", date:"28. Juni 2026", title:"Mehr-Tool-Plattform, SQL-Playground (Start) & Dark-Mode", items:[
    `<b>Mehrere Lern-Tools:</b> Nach dem Login wählst du jetzt aus, <b>welches Tool</b> du nutzen möchtest – den <b>🐹 Hamster-Simulator</b> oder den neuen <b>🗄️ SQL-Playground</b>. <b>Filius</b> und <b>Java</b> sind schon aufgeführt, aber noch deaktiviert (folgen später). Wechseln kannst du jederzeit oben im Konto-Menü unter <b>„🔀 Tool wechseln"</b>.`,
    `<b>SQL-Playground startet:</b> Du kannst bereits <b>SQL-Klassen anlegen</b> und Schüler:innen per Code beitreten lassen. <b>Datenbanken, Aufgaben mit Teilaufgaben und Abgaben</b> folgen Schritt für Schritt in den nächsten Updates.`,
    `<b>Klassen gehören zu einem Tool:</b> Hamster- und SQL-Klassen sind getrennt – in der Hamster-Übersicht erscheinen nur Hamster-Klassen und umgekehrt. Bestehende Klassen bleiben Hamster-Klassen.`,
    `<b>🌗 Dark-Mode:</b> Oben rechts in der Titelleiste kannst du zwischen <b>hell</b>, <b>dunkel</b> und <b>automatisch</b> (folgt der System-Einstellung) umschalten. Die Wahl wird auf dem Gerät gespeichert.`,
  ]},
  { v:"2.8", date:"26. Juni 2026", title:"Editor-Layout, Abgaben-Historie & Sicherheit", items:[
    `<b>Ausgabebereich vergrößern verkleinert nicht mehr den Editor:</b> Wenn du den Bereich „Ausgaben & Meldungen" größer ziehst, bleiben <b>Quellcode und Territorium gleich groß</b> – die Seite wird stattdessen länger (Scrollen).`,
    `<b>Abgaben-Historie:</b> Öffnest du in einer Aufgabe eine deiner früheren Abgaben, ist deren Schaltfläche jetzt als <b>„geöffnet"</b> markiert (ausgegraut), während die anderen weiterhin „Öffnen" anbieten – so siehst du sofort, welche Version gerade angezeigt wird.`,
    `<b>Musterlösung ansehen:</b> Das Editor-Fenster ist hoch genug, sodass die <b>Schaltflächen am unteren Rand</b> (Start, Schritt, …) vollständig sichtbar sind.`,
    `<b>Neue Aufgaben oben:</b> Eine neu erstellte Aufgabe erscheint jetzt <b>ganz oben</b> in der Aufgabenliste (statt unten). Die Reihenfolge lässt sich weiterhin mit den Pfeilen anpassen.`,
    `<b>Passwort ändern – mit Sicherheitsabfrage:</b> Zum Ändern des eigenen Passworts muss jetzt zuerst das <b>aktuelle Passwort</b> eingegeben werden.`,
  ]},
  { v:"2.7", date:"13. Juni 2026", title:"Klassen-Verwaltung, Übersicht & Editor-Komfort", items:[
    `<b>Klassenübersicht – Suche & Sortierung:</b> Über dem Klassenraster gibt es jetzt eine <b>🔍 Suche</b> und eine <b>Sortierung</b> (Neueste/Älteste zuerst, Name A–Z / Z–A, sowie „Letzte Änderung" = jüngste Abgabe in der Klasse). Greift in der Lehrer- <i>und</i> Schüler-Übersicht.`,
    `<b>Klassenansicht neu geordnet & einklappbar:</b> Die Reihenfolge ist jetzt <b>Aufgaben → Abgabe-Matrix → Schüler:innen → Lehrkräfte</b>. Jeder Abschnitt lässt sich über den <b>▼-Pfeil</b> auf-/zuklappen – praktisch bei großen Klassen.`,
    `<b>Einlade-Code steuern:</b> Die erstellende Lehrkraft kann den Klassencode jetzt <b>🚫 deaktivieren</b> (kein Beitritt mehr möglich) und einen <b>🔄 neuen Code erzeugen</b> (der alte wird sofort ungültig). Beides muss in einem Dialog bestätigt werden; bereits beigetretene Schüler:innen bleiben drin.`,
    `<b>Sandbox losgelöst von Klassen:</b> Die Sandbox steht jetzt direkt in der <b>Klassenübersicht</b> – auch für Schüler:innen – und ist nicht mehr an eine einzelne Klasse gebunden. Der frühere „Sandbox an/aus"-Schalter pro Klasse entfällt.`,
    `<b>Alphabetische Listen:</b> In der <b>Abgabe-Matrix</b>, der <b>Schülerliste</b> und der <b>Lehrkräfte-Liste</b> stehen die Namen jetzt in alphabetischer Reihenfolge.`,
    `<b>Editor:</b> Der Bereich <b>„Ausgaben & Meldungen"</b> ist größer und lässt sich an der unteren Kante <b>frei in der Höhe ziehen</b> – mehr Zeilen auf einen Blick. Außerdem fügt <b>Enter am Zeilenanfang</b> keine Einrückung mehr hinzu, sondern schiebt die Zeile nur nach unten.`,
    `<b>Admin – Nutzer:innen importieren:</b> Lehrkräfte <i>und</i> Schüler:innen können im Admin-Bereich per Liste angelegt werden – <b>zunächst ohne Klasse</b>. Bereits existierende Benutzernamen werden dabei übersprungen.`,
    `<b>Admin – mehr Felder bearbeiten:</b> Neben dem Benutzernamen lassen sich nun auch <b>Vor- und Nachname</b> einer Person ändern.`,
  ]},
  { v:"2.6", date:"8. Juni 2026", title:"Java-Korrektheit: char, Typprüfung & main-Pflicht", items:[
    `<b>char</b> ist jetzt ein vollwertiger Zahlentyp (ASCII): <code>int c = 'A';</code> ergibt <b>65</b>, <code>char s = 65;</code> ergibt <b>'A'</b> – inkl. <b>(char)/(int)-Umwandlungen</b> und Rechnen mit char, z. B. <code>char b = (char)(a + 5);</code>.`,
    `<b>Strengere Typprüfung</b> bei Zuweisungen nach Java-Regeln: int→double und char→int/double sind erlaubt, aber z. B. <code>int x = true;</code> oder <code>String s = 123;</code> nicht. double-Werte werden mit Nachkommastelle ausgegeben (z. B. <code>double i = 123;</code> → <b>123.0</b>).`,
    `Eine <b>void main()-Methode ist jetzt Pflicht</b> (wie in echtem Java). Reiner loser Befehls-Code (ohne main) wird mit einer klaren Meldung abgelehnt – packe dein Programm in <code>void main() { … }</code>.`,
  ]},
  { v:"2.5", date:"8. Juni 2026", title:"Aufgaben-Statistik & Klassen-Dashboard", items:[
    `Jede Aufgabe hat jetzt einen <b>📊-Knopf</b> (in der Aufgabenliste der Klasse) → öffnet ein <b>Dashboard</b>, das auf einen Blick zeigt, wo die Klasse steht und woran sie hängt.`,
    `<b>Kennzahlen oben:</b> Bestanden-Quote (z. B. „14 / 22"), wie viele die Aufgabe überhaupt bearbeitet haben, die <b>durchschnittliche Anzahl Versuche</b> und eine Verteilung (1× / 2–3× / 4+×). Ein <b>Fortschrittsbalken</b> zeigt farbig: 🟩 bestanden · 🟨 abgegeben, aber nicht bestanden · ⬜ noch nicht bearbeitet.`,
    `<b>🔎 Häufigste Fehler</b> – das Herzstück: Die App spielt die Abgaben automatisch noch einmal durch und <b>gruppiert, woran es scheitert</b> – z. B. „🧱 gegen die Mauer gelaufen", „🌾 kein Korn zum Fressen", „⌨️ Compilerfehler", „🔁 Endlosschleife" oder „🎯 läuft, aber Ziel nicht erreicht". Jede Gruppe zeigt die <b>Anzahl</b> und die betroffenen <b>Namen</b>; wenn viele in derselben Zeile scheitern, erscheint ein Hinweis „oft in Zeile X".`,
    `<b>Direkt zur Korrektur:</b> Ein Klick auf einen Namen öffnet sofort die Live-Korrektur dieser Abgabe.`,
    `<b>Umschalter</b> „Aktueller Stand" (jede letzte Abgabe – wo steht die Klasse jetzt) ↔ „Alle Versuche" (häufigste Stolpersteine insgesamt).`,
  ]},
  { v:"2.4", date:"8. Juni 2026", title:"Java-Datentypen, Typprüfung & Editor-Komfort", items:[
    `Editor: <b>Rückgängig/Wiederholen</b> mit <b>Strg+Z</b> und <b>Strg+Y</b>.`,
    `Neue Datentypen <b>double</b> (Kommazahlen, z. B. <code>1.5</code>) und <b>char</b> (einzelnes Zeichen, z. B. <code>'A'</code>).`,
    `<b>Typprüfung</b>: Einer Variablen kann nur ein passender Wert zugewiesen werden (z. B. kein <code>boolean</code> in eine <code>int</code>-Variable).`,
    `Doppelte lokale Variablennamen oder Parameter werden jetzt als Fehler gemeldet (wie in Java).`,
    `Der Hamster dreht sichtbar <b>links herum</b> – auch beim Einstellen der Blickrichtung in der Welt-Ansicht.`,
    `Admin: <b>Benutzernamen ändern</b>; Schüler-Import optional <b>mit eigenem Benutzernamen und/oder Passwort</b>.`,
  ]},
  { v:"2.3", date:"7. Juni 2026", title:"Editor robuster & Feinschliff", items:[
    `Klarere Fehlermeldungen im Editor: <b>break/continue</b> nur in Schleifen, <b>Endlosschleifen</b> und <b>endlose Rekursion</b> werden erkannt und sauber gestoppt, nicht geschlossene Texte (<code>"…</code>) werden gemeldet.`,
    `Laufzeitfehler markieren jetzt zuverlässiger die <b>betroffene Zeile</b>.`,
    `Oberflächen-Feinschliff (Login &amp; Fußzeile).`,
  ]},
  { v:"2.2", date:"7. Juni 2026", title:"Benutzernamen & Admin-Profile", items:[
    `Im Schüler-Profil steht jetzt auch der <b>Benutzername</b> – praktisch, falls jemand ihn vergisst.`,
    `Im <b>Admin-Bereich</b> öffnet ein Klick auf eine:n Nutzer:in ein <b>Info-Profil</b>: für <b>Schüler:innen</b> mit ihren Klassen-Mitgliedschaften, für <b>Lehrkräfte</b> mit ihren eigenen und Co-Klassen – jeweils mit Benutzername und letztem Login.`,
  ]},
  { v:"2.1", date:"7. Juni 2026", title:"Schüler-Profile, Matrix-Suche & Konto-Menü", items:[
    `In der <b>Abgabe-Matrix</b> kannst du jetzt nach <b>Schülernamen suchen</b> – praktisch bei großen Klassen.`,
    `<b>Klick auf eine:n Schüler:in</b> (in der Liste oder Matrix) öffnet ein <b>Profil</b>: zuletzt eingeloggt, letzte Aktivität, Aufgaben-Übersicht und private <b>Notizen</b> (nur für Lehrkräfte).`,
    `Schüler:innen können ihre <b>Abgabe mit einem Kommentar</b> an die Lehrkraft versehen – sichtbar in der Korrektur.`,
    `Oben rechts: <b>Konto-Menü</b> unter dem eigenen Namen (Admin-Bereich, Passwort ändern, Abmelden).`,
  ]},
  { v:"2.0", date:"6. Juni 2026", title:"Lehrer-Editor, eigene Sandbox & Klassen-Übergabe", items:[
    `Aufgaben erstellen/bearbeiten jetzt auf einer <b>eigenen Seite</b> statt im Pop-up – mit dem <b>gleichen Editor wie die Schüler:innen</b>: der <b>Startcode ist direkt ausführbar</b> (▶ Start), Umschalter <b>📝 Code / 🌍 Welt</b> fürs Territorium.`,
    `Lehrkräfte haben jetzt eine <b>eigene 🧪 Sandbox</b> (Knopf auf „Meine Klassen") – eigene Projekte frei bauen, speichern und öffnen, ganz ohne Klasse.`,
    `<b>Klasse übergeben</b>: im Dialog „👩‍🏫 Lehrkräfte" eine andere Lehrkraft zur Eigentümer:in machen – du wirst dann Co-Lehrkraft.`,
    `<b>Co-Lehrkräfte</b> können eine Klasse jetzt selbst <b>verlassen</b> („🚪 Klasse verlassen").`,
  ]},
  { v:"1.9", date:"5. Juni 2026", title:"Patch-Notes & Neuigkeiten", items:[
    `Neuer <b>🗒️ Patch-Notes-Knopf</b> unten links (Lehrer- &amp; Admin-Ansicht): zeigt, was sich mit jedem Update geändert hat.`,
  ]},
  { v:"1.8", date:"5. Juni 2026", title:"Editor & Vorlagen", items:[
    `Der Editor erkennt <b>Compilerfehler schon vor dem Start</b> – z. B. wenn eine Variable ohne Datentyp benutzt wird – und führt nur fehlerfreien Code aus.`,
    `<b>Tab-Taste</b> fügt jetzt einen echten Tabulator ein; nach einem <b>Zeilenumbruch</b> wird automatisch genauso weit eingerückt wie die Zeile davor.`,
    `Neue <b>📖 Befehls-Übersicht</b> im Editor – pro Aufgabe einstellbar, ob Schüler:innen sie einblenden dürfen.`,
    `Eigene Seite <b>📋 Vorlagen</b>: Aufgaben-Vorlagen anlegen, bearbeiten und löschen.`,
    `Aufgaben lassen sich jetzt per <b>Klick auf den Titel</b> bearbeiten.`,
    `Musterlösungen werden über <b>Schaltflächen</b> direkt ausgewählt (statt mit Pfeilen).`,
    `Schüler:innen sehen die Lehrer-Rückmeldung nun immer zur <b>gerade geöffneten Abgabe</b>.`,
  ]},
  { v:"1.7", date:"5. Juni 2026", title:"Admin-Modell & Lehrer-Teams", items:[
    `<b>Admin</b> ist jetzt ein Zusatz-Rang für Lehrkräfte (Knopf „🛠️ Admin") – die Lehrer-Rolle bleibt erhalten, Wechsel hin und zurück möglich.`,
    `In der Klassenansicht zeigt eine <b>Lehrkräfte-Karte</b>, wer die Klasse betreut; Ersteller:in und Admin verwalten Co-Lehrkräfte.`,
    `Klassen können <b>gelöscht</b> werden; der „Abmelden"-Knopf ist jetzt rot.`,
  ]},
  { v:"1.6", date:"5. Juni 2026", title:"Verwaltung & Suche", items:[
    `<b>Suche</b> nach Klassen und Nutzer:innen im Admin-Bereich.`,
    `Schüler:innen aus einer Klasse <b>entfernen</b>; Admin kann ganze Accounts löschen.`,
    `<b>Mehrere Lehrkräfte</b> pro Klasse möglich.`,
  ]},
  { v:"1.5", date:"5. Juni 2026", title:"Schüler-Import & Admin-Bereich", items:[
    `<b>📥 Schüler:innen-Import</b>: einfach „Vorname,Nachname" einfügen – Benutzernamen und Passwörter werden automatisch erzeugt (Liste zum Verteilen, kein E-Mail-Versand).`,
    `Erster <b>Admin-Bereich</b> zum Verwalten aller Klassen und Nutzer:innen.`,
  ]},
  { v:"1.4", date:"4. Juni 2026", title:"Bewertung & Sandbox", items:[
    `Neuer Auto-Check <b>„Soll-Zustand vergleichen"</b>: du hinterlegst einen Lösungscode, das Ergebnis wird automatisch mit der Schüler-Abgabe verglichen.`,
    `<b>🧪 Sandbox-Modus</b> je Klasse: Schüler:innen bauen frei Welt + Code und speichern eigene Projekte.`,
    `<b>Größerer Code-Editor</b> für angenehmeres Programmieren.`,
  ]},
  { v:"1.3", date:"4. Juni 2026", title:"Abgaben & Feedback", items:[
    `<b>Mehrere Abgaben</b> je Aufgabe mit Verlauf („🗂️ Meine Abgaben") – ältere Versionen öffnen und weiterbearbeiten.`,
    `<b>Lehrer-Kommentare</b> je Abgabe, gezielt für Schüler:innen freigebbar.`,
    `<b>Musterlösungen</b> anlegen, freigeben und ansehen.`,
  ]},
  { v:"1.2", date:"4. Juni 2026", title:"Aufgaben-Workflow", items:[
    `<b>Entwurf / Veröffentlichen</b> und <b>Reihenfolge</b> (↑/↓) für Aufgaben.`,
    `<b>Tipp/Hinweis</b> je Aufgabe; Vor- und Nachname bei der Registrierung.`,
    `Erste <b>Aufgaben-Vorlagen</b> zum Wiederverwenden.`,
  ]},
  { v:"1.1", date:"3. Juni 2026", title:"Komfort-Updates", items:[
    `Live-Anzeige des <b>Ziels</b> nach „Start"; Körner-Anzahl pro Feld einstellbar.`,
    `Klasse <b>umbenennen</b>, Aufgaben nachträglich <b>bearbeiten</b>, Klassencode optional.`,
  ]},
  { v:"1.0", date:"3. Juni 2026", title:"Erste Version", items:[
    `Logins für <b>Lehrkräfte und Schüler:innen</b>, Klassen mit Einlade-Code.`,
    `Aufgaben mit selbst gebautem <b>Territorium</b> + Auto-Check-Ziel stellen.`,
    `Schüler:innen lösen im eingebauten <b>Hamster-Simulator</b> und geben ab.`,
    `<b>Abgabe-Matrix</b> (✓ abgegeben, ★ bestanden) und Live-Korrektur durch die Lehrkraft.`,
  ]},
];
function patchNotesDialog(){
  const html = PATCH_NOTES.map((p,i)=>`
    <div class="pn${i===0?" latest":""}">
      <h4><span class="ver">v${esc(p.v)}</span>${esc(p.title)}${i===0?' <span class="badge">neu</span>':""}<span class="date">${esc(p.date)}</span></h4>
      <ul>${p.items.map(it=>`<li>${it}</li>`).join("")}</ul>
    </div>`).join("");
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>🗒️ Patch-Notes</h3>
    <p class="muted" style="margin:2px 0 4px;font-size:13.5px">Was sich in „Informatik am Gymnasium Wesermünde" getan hat – neueste Updates zuerst. Aktuelle Version: <b>${esc(APP_BUILD)} Uhr</b>.</p>
    <div class="patchlog">${html}</div>`);
}

/* ---------- Footer: Versionsnummer (aus den Patch-Notes) + Copyright ---------- */
const APP_BUILD = "2026-08-11 17:10";   // letztes Update (im Patch-Notes-Dialog angezeigt)
/* ============================================================================
   Browser-Zurück (SPA-History) + Favicon/Titel je Tool
   ============================================================================ */
/* Favicon + Tab-Titel: Schullogo auf Login/Tool-Auswahl, Tool-Emoji + Name im Tool */
function setChrome(){
  const base = "Informatik am Gymnasium Wesermünde";
  const cfg = window.HAMSTER_CONFIG || {};
  const link = document.querySelector("link[rel='icon']");
  const t = ME && ACTIVE_TOOL ? TOOLS.find(x => x.id === ACTIVE_TOOL) : null;
  if(t){
    // Emoji NUR als Favicon, nicht im Titel – sonst zeigt der Browser-Tab das Symbol doppelt
    document.title = t.name + " · " + base;
    if(link) link.href = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>" + t.icon + "</text></svg>");
  } else {
    document.title = base;
    if(link) link.href = cfg.FAVICON_URL || "logo-gywem.png";
  }
}

/* SPA-History: Seiten-Funktionen werden global umwickelt -> pushState je Navigation;
   der Browser-Zurück-Knopf rendert die vorherige Seite (Renderer-Closures im Speicher;
   nach einem echten Reload beginnt die Historie neu — das ist ok). */
const NAV = { map: new Map(), order: [], n: 0, silent: false, first: true, lastKey: null, lastId: 0 };
(function(){
  const PAGES = [
    "toolLauncher","adminHome","adminUserProfile",
    "teacherHome","studentHome","teacherClassView","studentClassView","solveAssignment","reviewSubmission",
    "templatesPage","sampleManager","assignmentEditorPage","assignmentStats","studentProfilePage","sandboxHome","sandboxProject",
    "sqlTeacherHome","sqlStudentHome","sqlTeacherClassView","sqlStudentClassView","sqlSolveAssignment","sqlReviewSubmission",
    "sqlStudentProfilePage","sqlTemplatesPage","sqlTemplateEditorPage","sqlDatabasesPage","sqlDatabaseEditorPage",
    "sqlAssignmentEditorPage","sqlSandbox","sqlSandboxProject",
    "filiusTeacherHome","filiusStudentHome","filiusTeacherClassView","filiusStudentClassView","filiusSolveAssignment",
    "filiusReviewSubmission","filiusStudentProfilePage","filiusNetworksPage","filiusNetworkEditorPage",
    "filiusTemplatesPage","filiusTemplateEditorPage","filiusAssignmentEditorPage","filiusSandbox","filiusSandboxProject",
    "javaTeacherHome","javaStudentHome","javaTeacherClassView","javaStudentClassView","javaSolveAssignment",
    "javaReviewSubmission","javaStudentProfilePage","javaTemplatesPage","javaAssignmentEditorPage",
    "javaSandbox","javaSandboxProject","javaSampleManager",
  ];
  const keyOf = (name, args) => name + ":" + args.map(a => (a && typeof a === "object" && a.id) ? a.id : (typeof a === "object" || typeof a === "function") ? "·" : String(a)).join(",");
  function remember(id, fn){
    NAV.map.set(id, { fn, uid: ME && ME.id });                 // Einträge gehören zum angemeldeten Nutzer!
    NAV.order.push(id);
    while(NAV.order.length > 90){ NAV.map.delete(NAV.order.shift()); }
  }
  window.navReset = function(){                                // bei Abmelden/Anmelden: fremde Historie verwerfen
    NAV.map.clear(); NAV.order.length = 0; NAV.lastKey = null; NAV.first = true;
    try{ history.replaceState(null, ""); }catch(e){}
  };
  for(const name of PAGES){
    const orig = window[name];
    if(typeof orig !== "function") continue;
    window[name] = function(...args){
      if(!NAV.silent){
        const id = ++NAV.n;
        remember(id, () => { NAV.silent = true; try{ orig.apply(null, args); } finally { NAV.silent = false; } });
        const key = keyOf(name, args);
        try{
          if(NAV.first){ history.replaceState({ hknav: id }, ""); NAV.first = false; }
          else if(key === NAV.lastKey){ history.replaceState({ hknav: id }, ""); }
          else history.pushState({ hknav: id }, "");
        }catch(e){}
        NAV.lastKey = key; NAV.lastId = id;
      }
      return orig.apply(null, args);
    };
  }
  window.addEventListener("popstate", (e) => {
    NAV.lastKey = null;                                   // nach Zurück nicht fälschlich dedupen
    try{ closeModal(); }catch(err){}                      // offene Dialoge/Overlays gehören zur verlassenen Seite
    try{ if(typeof openMatrixModal === "function" && openMatrixModal._close) openMatrixModal._close(); }catch(err){}
    if(!ME){ renderAuth(); return; }                      // nach Abmelden: nie fremde Seiten wiederherstellen
    const st = e.state;
    const entry = st && st.hknav ? NAV.map.get(st.hknav) : null;
    if(entry && entry.uid === ME.id){ entry.fn(); }
    else { NAV.silent = true; try{ route(); } finally { NAV.silent = false; } }
  });
})();

(function(){ const f=document.getElementById("appfoot"); if(f){ const v=(typeof PATCH_NOTES!=="undefined"&&PATCH_NOTES[0])?PATCH_NOTES[0].v:"";
  const lnk=(href,txt)=>'<a href="'+href+'" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px" onmouseover="this.style.color=\'var(--blue)\'" onmouseout="this.style.color=\'inherit\'">'+txt+'</a>';
  f.innerHTML='© 2026 Laurens Offinger &amp; Sebastian Glücks · Version '+v+' · '+lnk("impressum.html","Impressum")+' · '+lnk("lizenzen.html","Lizenzen"); } })();

boot();
