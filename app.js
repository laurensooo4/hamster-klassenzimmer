"use strict";
/* ============================================================================
   Hamster-Klassenzimmer · App-Logik (Auth, Routing, Klassen)
   ============================================================================ */
const CONFIG = window.HAMSTER_CONFIG;
const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

let ME = null;          // aktuelles Profil {id, username, role, display_name}
const app = () => document.getElementById("app");

/* ---------- Helfer ---------- */
const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const normUser = u => u.trim().toLowerCase();
const userEmail = u => normUser(u) + "@" + CONFIG.EMAIL_DOMAIN;
const initials = s => (s||"?").trim().slice(0,1).toUpperCase();
function toast(msg, type){ const t=document.getElementById("toast"); t.textContent=msg; t.className=(type||"")+" show"; clearTimeout(toast._t); toast._t=setTimeout(()=>t.className=t.className.replace("show","").trim(),2400); }
function hideSplash(){ const s=document.getElementById("splash"); if(s) s.classList.add("hide"); }
const HAMSTER = "🐹";

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
  try{
    const { data:{ session } } = await sb.auth.getSession();
    if(session) await loadMe(session.user.id);
  }catch(e){ console.error(e); }
  hideSplash();
  route();
  sb.auth.onAuthStateChange((event)=>{ if(event==="SIGNED_OUT"){ ME=null; route(); } });
}
async function loadMe(uid){
  const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  if(error){ console.error(error); }
  ME = data || null;
  return ME;
}
function route(){
  if(!ME){ renderAuth(); return; }
  if(ME.role==="teacher") teacherHome();
  else studentHome();
}
async function signOut(){ await sb.auth.signOut(); ME=null; renderAuth(); }

/* ============================================================================
   AUTH-SCREEN (Duolingo-Stil)
   ============================================================================ */
let authState = { mode:"login", role:"student" };
function renderAuth(){
  const s=authState; const isReg = s.mode==="register";
  const codeField = isReg ? (s.role==="teacher"
      ? `<div class="field"><label>Lehrer-Code</label><input class="input" id="auCode" placeholder="Code von der Schulleitung" autocomplete="off"></div>`
      : `<div class="field"><label>Klassencode</label><input class="input" id="auCode" placeholder="z. B. K7Q2MX" autocomplete="off" style="text-transform:uppercase;letter-spacing:2px;font-family:monospace"></div>`) : "";
  const foot = isReg ? (s.role==="teacher" ? "Lehrer:innen brauchen den Lehrer-Code." : "Du brauchst den Klassencode deiner Lehrkraft.")
                     : 'Noch kein Account? Tippe oben auf "Registrieren".';
  app().innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="mascot">${HAMSTER}</div>
    <h1>Hamster-Klassenzimmer</h1>
    <p class="sub">${isReg?"Lass uns loslegen!":"Willkommen zurück!"}</p>
    <div class="tabs">
      <button data-m="login" class="${!isReg?"active":""}">Anmelden</button>
      <button data-m="register" class="${isReg?"active":""}">Registrieren</button>
    </div>
    <div class="auth-msg" id="authMsg"></div>
    ${isReg ? `<div class="field"><label>Ich bin…</label>
        <div class="role-pick">
          <div class="role-opt ${s.role==="student"?"active":""}" data-role="student"><span class="ic">🎒</span>Schüler:in</div>
          <div class="role-opt ${s.role==="teacher"?"active":""}" data-role="teacher"><span class="ic">👨‍🏫</span>Lehrer:in</div>
        </div></div>` : ""}
    ${codeField}
    <div class="field"><label>Benutzername</label>
      <input class="input" id="auUser" placeholder="z. B. max.muster" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    <div class="field"><label>Passwort</label>
      <input class="input" id="auPass" type="password" placeholder="Passwort" autocomplete="${isReg?"new-password":"current-password"}"></div>
    <button class="btn btn-primary btn-lg" id="auSubmit">${isReg?"Account erstellen":"Anmelden"}</button>
    <p class="auth-foot">${foot}</p>
    <div class="auth-credit">🎮 Vibe-Coded von <b>Laurens Offinger</b></div>
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
  route();
}
async function doRegister(){
  const uRaw=document.getElementById("auUser").value.trim(), p=document.getElementById("auPass").value, role=authState.role;
  const u=normUser(uRaw);
  const codeEl=document.getElementById("auCode"); const code=codeEl?codeEl.value.trim():"";
  if(!/^[a-z0-9_.\-]{3,20}$/.test(u)){ authMsg("Benutzername: 3-20 Zeichen, nur Buchstaben/Zahlen/._-"); return; }
  if(p.length<6){ authMsg("Das Passwort muss mindestens 6 Zeichen haben."); return; }
  if(!code){ authMsg(role==="teacher"?"Bitte den Lehrer-Code eingeben.":"Bitte den Klassencode eingeben."); return; }
  setBusy(true);
  // 1) Code prüfen, BEVOR ein Account angelegt wird
  let className=null;
  if(role==="teacher"){
    const { data:ok, error:e1 } = await sb.rpc("check_teacher_code", { p_code: code });
    if(e1){ setBusy(false); authMsg("Prüfung fehlgeschlagen: "+e1.message); return; }
    if(!ok){ setBusy(false); authMsg("Falscher Lehrer-Code."); return; }
  } else {
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
    const { error:e2 } = await sb.rpc("register_teacher", { p_username:u, p_display:uRaw, p_code:code });
    if(e2){ setBusy(false); authMsg("Registrierung fehlgeschlagen: "+e2.message); return; }
  } else {
    const { error:e2 } = await sb.from("profiles").insert({ id:uid, username:u, role:"student", display_name:uRaw });
    if(e2){ setBusy(false); if(/duplicate|unique/i.test(e2.message)) authMsg("Dieser Benutzername ist schon vergeben."); else authMsg("Profil konnte nicht angelegt werden: "+e2.message); return; }
    const { error:e3 } = await sb.rpc("join_class", { p_code: code });
    if(e3){ setBusy(false); authMsg("Beitritt fehlgeschlagen: "+e3.message); return; }
  }
  await loadMe(uid);
  toast(className?("Willkommen in "+className+"! 🎉"):("Willkommen, "+uRaw+"! 🎉"),"ok");
  route();
}
function setBusy(b){ const btn=document.getElementById("auSubmit"); if(btn){ btn.disabled=b; btn.innerHTML = b?'<span class="spin" style="width:18px;height:18px;border-top-color:#fff;border-color:rgba(255,255,255,.4)"></span>':(authState.mode==="login"?"Anmelden":"Account erstellen"); } }

/* ============================================================================
   APP-SHELL (Topbar)
   ============================================================================ */
function shell(inner){
  if(typeof pageView!=="undefined" && pageView){ try{ pageView.destroy(); }catch(e){} pageView=null; }
  const roleBadge = ME.role==="teacher" ? `<span class="badge blue">Lehrkraft</span>` : `<span class="badge">Schüler:in</span>`;
  app().innerHTML = `
    <div class="topbar">
      <div class="brand"><span class="h">${HAMSTER}</span> Hamster-Klassenzimmer</div>
      <div class="spacer"></div>
      ${roleBadge}
      <span class="chip ${ME.role}"><span class="av">${esc(initials(ME.display_name||ME.username))}</span>${esc(ME.display_name||ME.username)}</span>
      <button class="btn btn-ghost btn-sm" id="btnChangePw" title="Passwort ändern">🔑 Passwort</button>
      <button class="btn btn-ghost btn-sm" id="btnLogout">Abmelden</button>
    </div>
    <div class="container" id="view"></div>`;
  document.getElementById("btnChangePw").onclick = changePasswordDialog;
  document.getElementById("btnLogout").onclick = signOut;
  document.getElementById("view").innerHTML = inner;
}

/* ============================================================================
   DATEN-API
   ============================================================================ */
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(n){ n=n||6; let s=""; const a=new Uint32Array(n); window.crypto.getRandomValues(a); for(let i=0;i<n;i++) s+=ALPH[a[i]%ALPH.length]; return s; }

const api = {
  async myClasses(){
    const { data, error } = await sb.from("classes").select("*").order("created_at",{ascending:false});
    if(error) throw error; return data||[];
  },
  async createClass(name){
    for(let tries=0; tries<5; tries++){
      const code = genCode(6);
      const { data, error } = await sb.from("classes").insert({ name, code, teacher_id:ME.id }).select().single();
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
const DEFAULT_STARTER = "void main() {\n    \n}";
api.listAssignments = async (classId)=>{ const {data,error}=await sb.from("assignments").select("*").eq("class_id",classId).order("created_at"); if(error) throw error; return data||[]; };
api.getAssignment = async (id)=>{ const {data,error}=await sb.from("assignments").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.createAssignment = async (a)=>{ const {data,error}=await sb.from("assignments").insert(a).select().single(); if(error) throw error; return data; };
api.deleteAssignment = async (id)=>{ const {error}=await sb.from("assignments").delete().eq("id",id); if(error) throw error; };
api.upsertSubmission = async (s)=>{ const row=Object.assign({student_id:ME.id, submitted_at:new Date().toISOString()}, s); const {data,error}=await sb.from("submissions").upsert(row,{onConflict:"assignment_id,student_id"}).select().single(); if(error) throw error; return data; };
api.mySubmission = async (assignmentId)=>{ const {data,error}=await sb.from("submissions").select("*").eq("assignment_id",assignmentId).eq("student_id",ME.id).maybeSingle(); if(error) throw error; return data; };
api.classSubmissions = async (assignmentIds)=>{ if(!assignmentIds.length) return []; const {data,error}=await sb.from("submissions").select("*").in("assignment_id",assignmentIds); if(error) throw error; return data||[]; };

/* Headless Auto-Check: führt den Code auf einer frischen Kopie des Territoriums aus */
function gradeSubmission(code, territory, goal){
  if(!goal||!goal.type) return null;
  try{
    const ast=HamsterEngine.parse(code);
    const model=HamsterEngine.toModel(territory);
    const m={rows:model.rows,cols:model.cols,walls:model.walls,grains:model.grains,hamster:model.hamster,onWrite:()=>{}};
    const it=HamsterEngine.makeInterpreter(ast,m); const g=it.run(); let n=0;
    while(true){ const r=g.next(); if(r.done)break; if(++n>2000000) return false; }
    return HamsterEngine.checkGoal(goal,m)===true;
  }catch(e){ return false; }
}
function goalLabel(goal){
  if(!goal||!goal.type) return "kein Auto-Check";
  if(goal.type==="noGrains") return "Feld leer (alle Körner gefressen)";
  if(goal.type==="grainsInMaul") return "≥ "+goal.n+" Körner im Maul";
  if(goal.type==="atPos") return "Hamster bei Reihe "+goal.row+", Spalte "+goal.col;
  return "Auto-Check";
}

/* ---------- Lehrer: Aufgabe stellen ---------- */
function newAssignmentDialog(classId, onDone){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Neue Aufgabe</h3>
    <div class="field"><label>Titel</label><input class="input" id="asTitle" placeholder="z. B. Lauf bis zur Wand" maxlength="80"></div>
    <div class="field"><label>Aufgabenstellung</label><textarea class="input" id="asDesc" placeholder="Was soll der Hamster tun?"></textarea></div>
    <div class="field"><label>Territorium (anklicken zum Bearbeiten)</label><div id="asDesign"></div></div>
    <div class="field"><label>Startcode für Schüler (optional)</label><textarea class="input" id="asStarter" style="font-family:monospace;font-size:13px;min-height:70px" placeholder="${esc(DEFAULT_STARTER)}"></textarea></div>
    <div class="field"><label>Auto-Check (optional)</label>
      <select class="input" id="asGoalType">
        <option value="">Kein Auto-Check</option>
        <option value="noGrains">Feld leer – alle Körner gefressen</option>
        <option value="grainsInMaul">Hamster hat ≥ N Körner im Maul</option>
        <option value="atPos">Hamster steht am Ziel (Reihe/Spalte)</option>
      </select>
      <div id="asGoalExtra" style="margin-top:8px"></div>
    </div>
    <button class="btn btn-primary btn-lg" id="asSave">Aufgabe stellen</button>`, true);
  modalView = new HamsterView("#asDesign", { mode:"design", model: HamsterEngine.blankTerr() });
  const gt=document.getElementById("asGoalType"), extra=document.getElementById("asGoalExtra");
  gt.onchange=()=>{ if(gt.value==="grainsInMaul") extra.innerHTML=`<input class="input" id="asGoalN" type="number" min="1" value="5" placeholder="Anzahl Körner">`;
    else if(gt.value==="atPos") extra.innerHTML=`<div style="display:flex;gap:8px"><input class="input" id="asGoalR" type="number" min="0" placeholder="Reihe"><input class="input" id="asGoalC" type="number" min="0" placeholder="Spalte"></div>`;
    else extra.innerHTML=""; };
  document.getElementById("asTitle").focus();
  document.getElementById("asSave").onclick=async()=>{
    const title=document.getElementById("asTitle").value.trim(); if(!title){ document.getElementById("asTitle").focus(); return; }
    const description=document.getElementById("asDesc").value.trim();
    const starter_code=document.getElementById("asStarter").value.trim()||null;
    const territory=modalView.getTerritory();
    let goal=null;
    if(gt.value==="noGrains") goal={type:"noGrains"};
    else if(gt.value==="grainsInMaul") goal={type:"grainsInMaul", n:Math.max(1,+ (document.getElementById("asGoalN")||{}).value||1)};
    else if(gt.value==="atPos") goal={type:"atPos", row:+ (document.getElementById("asGoalR")||{}).value||0, col:+ (document.getElementById("asGoalC")||{}).value||0};
    const btn=document.getElementById("asSave"); btn.disabled=true; btn.textContent="Speichere…";
    try{ await api.createAssignment({ class_id:classId, title, description, territory, starter_code, goal }); closeModal(); toast("Aufgabe gestellt 🎉","ok"); if(onDone) onDone(); }
    catch(e){ btn.disabled=false; btn.textContent="Aufgabe stellen"; toast(e.message||"Fehler","err"); }
  };
}

/* ---------- Lehrer: Abgabe ansehen ---------- */
function viewSubmissionDialog(assignment, sub, studentName){
  const passed = sub.passed===true ? `<span class="badge">bestanden ✓</span>` : sub.passed===false ? `<span class="badge gold">abgegeben</span>` : "";
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>${esc(studentName)} — ${esc(assignment.title)} ${passed}</h3>
    <p class="muted" style="margin:2px 0 12px">Abgegeben am ${fmtDateTime(sub.submitted_at)}. Du kannst den Code hier laufen lassen.</p>
    <div id="subHost"></div>`, true);
  modalView = new HamsterView("#subHost", { mode:"view", model:assignment.territory, code:sub.code });
}

/* ---------- Schüler: Aufgabe lösen ---------- */
async function solveAssignment(assignmentId){
  shell(`<div class="center-load"><span class="spin"></span>Aufgabe lädt…</div>`);
  let a, sub;
  try{ a=await api.getAssignment(assignmentId); sub=await api.mySubmission(assignmentId); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const code = sub ? sub.code : (a.starter_code || DEFAULT_STARTER);
  const statusHtml = sub ? (sub.passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`) : `<span class="badge gray">offen</span>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(a.title)}</h2><div class="spacer"></div><span id="solveStatus">${statusHtml}</span></div>
    ${a.description?`<div class="card" style="margin-bottom:12px"><b>Aufgabe:</b> ${esc(a.description)}${a.goal?`<div class="muted" style="margin-top:6px;font-size:13px">🎯 Ziel: ${esc(goalLabel(a.goal))}</div>`:""}</div>`:""}
    <div id="solveHost" style="height:66vh;min-height:470px"></div>
    <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
      <button class="btn btn-primary btn-lg" id="btnSubmit" style="max-width:240px">📤 Abgeben</button>
      <span id="submitMsg" class="muted"></span>
    </div>`;
  document.getElementById("back").onclick = ()=> studentClassView(a.class_id);
  pageView = new HamsterView("#solveHost", { mode:"solve", model:a.territory, code, fill:true });
  document.getElementById("btnSubmit").onclick = async ()=>{
    const myCode = pageView.getCode();
    const passed = gradeSubmission(myCode, a.territory, a.goal);
    const btn=document.getElementById("btnSubmit"); btn.disabled=true; btn.textContent="Sende…";
    try{
      await api.upsertSubmission({ assignment_id:a.id, code:myCode, status:"submitted", passed });
      btn.disabled=false; btn.textContent="📤 Erneut abgeben";
      document.getElementById("solveStatus").innerHTML = passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`;
      const msg = passed===true ? "Super, Ziel erreicht! 🎉" : passed===false ? "Abgegeben – Ziel noch nicht erfüllt, du kannst es nochmal versuchen." : "Abgegeben! ✓";
      document.getElementById("submitMsg").textContent = msg;
      toast("Abgegeben!","ok");
    }catch(e){ btn.disabled=false; btn.textContent="📤 Abgeben"; toast(e.message||"Fehler","err"); }
  };
}

function fmtDateTime(s){ try{ return new Date(s).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}); }catch(e){ return ""; } }

/* ---------- Passwort ändern (alle Rollen) ---------- */
function changePasswordDialog(){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Passwort ändern</h3><p class="muted" style="margin:2px 0 16px">Wähle ein neues Passwort (mind. 6 Zeichen).</p>
    <div class="field"><label>Neues Passwort</label><input class="input" id="np1" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Wiederholen</label><input class="input" id="np2" type="password" autocomplete="new-password"></div>
    <button class="btn btn-primary btn-lg" id="npSave">Passwort speichern</button>`);
  document.getElementById("np1").focus();
  document.getElementById("npSave").onclick=async()=>{
    const a=document.getElementById("np1").value, b=document.getElementById("np2").value;
    if(a.length<6){ toast("Mindestens 6 Zeichen.","err"); return; }
    if(a!==b){ toast("Die Passwörter stimmen nicht überein.","err"); return; }
    const btn=document.getElementById("npSave"); btn.disabled=true; btn.textContent="Speichere…";
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
   LEHRER-ANSICHT
   ============================================================================ */
async function teacherHome(){
  shell(`<div class="center-load"><span class="spin"></span>Klassen werden geladen…</div>`);
  let classes=[];
  try{ classes = await api.myClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const cards = classes.length ? `<div class="grid">${classes.map(c=>`
      <div class="card click" data-id="${c.id}">
        <h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b></div>
      </div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📚</span>Noch keine Klassen. Erstelle deine erste Klasse!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-primary" id="btnNewClass">+ Neue Klasse</button></div>
    ${cards}`;
  document.getElementById("btnNewClass").onclick = newClassDialog;
  document.querySelectorAll(".card.click").forEach(c=> c.onclick=()=> teacherClassView(c.dataset.id));
}
function newClassDialog(){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Neue Klasse</h3><p class="muted" style="margin:2px 0 16px">Gib der Klasse einen Namen – der Einlade-Code wird automatisch erzeugt.</p>
    <div class="field"><label>Klassenname</label><input class="input" id="clName" placeholder="z. B. Informatik 9b" maxlength="60"></div>
    <button class="btn btn-primary btn-lg" id="clCreate">Klasse erstellen</button>`);
  const inp=document.getElementById("clName"); inp.focus();
  const go=async()=>{ const name=inp.value.trim(); if(!name){ inp.focus(); return; }
    const btn=document.getElementById("clCreate"); btn.disabled=true; btn.textContent="Erstelle…";
    try{ const c=await api.createClass(name); closeModal(); toast('Klasse "'+name+'" erstellt 🎉',"ok"); teacherClassView(c.id); }
    catch(e){ btn.disabled=false; btn.textContent="Klasse erstellen"; toast(e.message||"Fehler","err"); } };
  document.getElementById("clCreate").onclick=go;
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}

async function teacherClassView(classId){
  shell(`<div class="center-load"><span class="spin"></span>Klasse wird geladen…</div>`);
  let cls, roster=[];
  try{
    const { data } = await sb.from("classes").select("*").eq("id",classId).single();
    cls=data; roster = await api.classRoster(classId);
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  if(!cls){ document.getElementById("view").innerHTML=errBox({message:"Klasse nicht gefunden."}); return; }

  const rosterHtml = roster.length ? `<div class="list">${roster.map(m=>{
      const p=m.profiles||{}; const nm=p.display_name||p.username||"?";
      return `<div class="row"><span class="chip"><span class="av">${esc(initials(nm))}</span>${esc(nm)}</span>
        <div class="grow"></div><span class="muted" style="font-size:11.5px;margin-right:4px">${fmtDate(m.joined_at)}</span>
        <button class="btn btn-sm btn-ghost" data-stu="${m.student_id}" data-nm="${esc(nm)}" title="Passwort zurücksetzen">🔑</button></div>`;
    }).join("")}</div>`
    : `<div class="empty"><span class="ic">🎒</span>Noch keine Schüler:innen. Teile den Code <b>${esc(cls.code)}</b>!</div>`;

  let assignments=[], subs=[];
  try{ assignments = await api.listAssignments(classId); subs = await api.classSubmissions(assignments.map(a=>a.id)); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }

  const assignHtml = assignments.length ? `<div class="list">${assignments.map(a=>`
      <div class="row"><span class="grow"><span class="t">${esc(a.title)}</span>${a.goal?`<span class="s">🎯 ${esc(goalLabel(a.goal))}</span>`:`<span class="s">kein Auto-Check</span>`}</span>
        <button class="btn btn-sm btn-ghost" data-del="${a.id}" title="löschen">🗑️</button></div>`).join("")}</div>`
    : `<div class="empty" style="padding:16px"><span class="ic">📝</span>Noch keine Aufgaben.</div>`;
  const matrixHtml = (assignments.length && roster.length) ? buildMatrix(roster, assignments, subs)
    : `<div class="empty"><span class="ic">📊</span>${!assignments.length?"Stelle Aufgaben – dann erscheint hier, wer was abgegeben hat.":"Noch keine Schüler:innen in der Klasse."}</div>`;

  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0">
      <h2>${esc(cls.name)}</h2>
      <div class="spacer"></div>
      <span class="codechip" title="Einlade-Code">🔑 ${esc(cls.code)} <button class="btn btn-sm btn-ghost" id="copyCode" style="margin-left:4px">Kopieren</button></span>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));margin-bottom:16px">
      <div class="card"><h3>🎒 Schüler:innen <span class="badge gray">${roster.length}</span></h3>
        <div style="margin-top:12px">${rosterHtml}</div></div>
      <div class="card">
        <div style="display:flex;align-items:center"><h3 style="margin:0">📝 Aufgaben <span class="badge gray">${assignments.length}</span></h3>
          <div style="flex:1"></div><button class="btn btn-blue btn-sm" id="btnNewAssign">+ Aufgabe stellen</button></div>
        <div style="margin-top:12px">${assignHtml}</div></div>
    </div>
    <h3 style="margin:0 0 10px">📊 Abgabe-Matrix</h3>
    ${matrixHtml}`;
  document.getElementById("back").onclick = teacherHome;
  document.getElementById("copyCode").onclick = ()=>{ if(navigator.clipboard) navigator.clipboard.writeText(cls.code); toast("Code kopiert: "+cls.code,"ok"); };
  document.getElementById("btnNewAssign").onclick = ()=> newAssignmentDialog(classId, ()=>teacherClassView(classId));
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Aufgabe wirklich löschen?")) return; try{ await api.deleteAssignment(b.dataset.del); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll(".cell[data-sub]").forEach(c=> c.onclick=()=>{ const s=subs.find(x=>x.id===c.dataset.sub); if(!s)return; const a=assignments.find(x=>x.id===s.assignment_id); const stu=roster.find(r=>r.student_id===s.student_id); const nm=(stu&&stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?"; viewSubmissionDialog(a,s,nm); });
  document.querySelectorAll("[data-stu]").forEach(b=> b.onclick=()=> resetStudentPw(b.dataset.stu, b.dataset.nm));
}
function buildMatrix(roster, assignments, subs){
  const head = assignments.map(a=>`<th title="${esc(a.title)}">${esc(a.title.length>14?a.title.slice(0,13)+"…":a.title)}</th>`).join("");
  const rows = roster.map(stu=>{
    const nm=(stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?";
    const cells = assignments.map(a=>{
      const s=subs.find(x=>x.assignment_id===a.id && x.student_id===stu.student_id);
      if(!s) return `<td><span class="cell none">·</span></td>`;
      const cl=s.passed===true?"pass":"done"; const ic=s.passed===true?"★":"✓";
      return `<td><span class="cell ${cl}" data-sub="${s.id}" title="Abgabe ansehen">${ic}</span></td>`;
    }).join("");
    return `<tr><td class="stu">${esc(nm)}</td>${cells}</tr>`;
  }).join("");
  return `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="stu">Schüler:in</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ============================================================================
   SCHÜLER-ANSICHT
   ============================================================================ */
async function studentHome(){
  shell(`<div class="center-load"><span class="spin"></span>Wird geladen…</div>`);
  let classes=[];
  try{ classes = await api.myClasses(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }

  if(!classes.length){
    document.getElementById("view").innerHTML = `
      <div class="page-head"><h2>Willkommen, ${esc(ME.display_name||ME.username)}! ${HAMSTER}</h2></div>
      <div class="card" style="max-width:480px;margin:0 auto;text-align:center">
        <div style="font-size:46px">🔑</div>
        <h3 style="margin:6px 0">Tritt deiner Klasse bei</h3>
        <p class="muted" style="margin:0 0 16px">Gib den Code ein, den du von deiner Lehrkraft bekommen hast.</p>
        <div class="field"><input class="input" id="joinCode" placeholder="z. B. K7Q2MX" maxlength="8" style="text-align:center;text-transform:uppercase;letter-spacing:3px;font-family:monospace;font-size:22px"></div>
        <button class="btn btn-primary btn-lg" id="btnJoin">Beitreten</button>
      </div>`;
    wireJoin();
    return;
  }
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>Meine Klassen</h2><div class="spacer"></div>
      <button class="btn btn-ghost" id="btnJoinMore">+ Klasse beitreten</button></div>
    <div class="grid">${classes.map(c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Aufgaben ansehen →</div></div>`).join("")}</div>`;
  document.getElementById("btnJoinMore").onclick = joinDialog;
  document.querySelectorAll(".card.click").forEach(c=> c.onclick=()=> studentClassView(c.dataset.id));
}
function wireJoin(){
  const inp=document.getElementById("joinCode"); inp.focus();
  const go=async()=>{ const code=inp.value.trim().toUpperCase(); if(!code){ inp.focus(); return; }
    const btn=document.getElementById("btnJoin"); btn.disabled=true; btn.textContent="Trete bei…";
    try{ const c=await api.joinClass(code); toast('Du bist jetzt in "'+(c?c.name:"")+'" 🎉',"ok"); studentHome(); }
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
    try{ const c=await api.joinClass(code); closeModal(); toast('Beigetreten: "'+(c?c.name:"")+'"',"ok"); studentHome(); }
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
    if(assignments.length){ const { data:s } = await sb.from("submissions").select("*").in("assignment_id",assignments.map(a=>a.id)).eq("student_id",ME.id); mySubs=s||[]; }
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const list = assignments.length ? `<div class="list">${assignments.map(a=>{
      const s=mySubs.find(x=>x.assignment_id===a.id);
      const badge = s ? (s.passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`) : `<span class="badge gray">offen</span>`;
      return `<div class="row clickrow" data-id="${a.id}" style="cursor:pointer">
        <span class="grow"><span class="t">${esc(a.title)}</span>${a.description?`<span class="s">${esc(a.description.slice(0,70))}</span>`:""}</span>
        ${badge}<span style="margin-left:8px;color:#7a8aa0">→</span></div>`;
    }).join("")}</div>`
    : `<div class="empty"><span class="ic">📝</span>Noch keine Aufgaben. Schau später wieder rein!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(cls?cls.name:"Klasse")}</h2></div>
    ${list}`;
  document.getElementById("back").onclick = studentHome;
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=()=> solveAssignment(r.dataset.id));
}

/* ---------- Kleinkram ---------- */
function errBox(e){ console.error(e); return `<div class="empty"><span class="ic">⚠️</span>${esc(e&&e.message||"Etwas ist schiefgelaufen.")}</div>`; }
function fmtDate(s){ try{ const d=new Date(s); return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"}); }catch(e){ return ""; } }

boot();
