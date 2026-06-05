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
  if(ME.role==="admin") adminHome();
  else if(ME.role==="teacher") teacherHome();
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
      : `<div class="field"><label>Klassencode <span style="color:#7a8aa0;font-weight:600;text-transform:none;letter-spacing:0">(optional)</span></label><input class="input" id="auCode" placeholder="z. B. K7Q2MX – kann leer bleiben" autocomplete="off" style="text-transform:uppercase;letter-spacing:2px;font-family:monospace"></div>`) : "";
  const foot = isReg ? (s.role==="teacher" ? "Lehrer:innen brauchen den Lehrer-Code." : "Mit Klassencode trittst du direkt bei – oder ohne starten und später beitreten.")
                     : 'Noch kein Account? Tippe oben auf "Registrieren".';
  app().innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="mascot">${HAMSTER}</div>
    <h1>Informatik am Gymnasium Wesermünde</h1>
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
    ${isReg?`<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Vorname</label><input class="input" id="auFirst" autocomplete="given-name"></div><div class="field" style="flex:1"><label>Nachname</label><input class="input" id="auLast" autocomplete="family-name"></div></div>`:""}
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
  const first=(document.getElementById("auFirst")||{value:""}).value.trim();
  const last=(document.getElementById("auLast")||{value:""}).value.trim();
  if(!/^[a-z0-9_.\-]{3,20}$/.test(u)){ authMsg("Benutzername: 3-20 Zeichen, nur Buchstaben/Zahlen/._-"); return; }
  if(!first||!last){ authMsg("Bitte Vor- und Nachnamen eingeben."); return; }
  if(p.length<6){ authMsg("Das Passwort muss mindestens 6 Zeichen haben."); return; }
  if(role==="teacher" && !code){ authMsg("Bitte den Lehrer-Code eingeben."); return; }
  const displayName = first+" "+last;
  setBusy(true);
  // 1) Code prüfen, BEVOR ein Account angelegt wird
  let className=null;
  if(role==="teacher"){
    const { data:ok, error:e1 } = await sb.rpc("check_teacher_code", { p_code: code });
    if(e1){ setBusy(false); authMsg("Prüfung fehlgeschlagen: "+e1.message); return; }
    if(!ok){ setBusy(false); authMsg("Falscher Lehrer-Code."); return; }
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
    if(code){ const { error:e3 } = await sb.rpc("join_class", { p_code: code }); if(e3){ setBusy(false); authMsg("Beitritt fehlgeschlagen: "+e3.message); return; } }
  }
  await loadMe(uid);
  toast(className?("Willkommen in "+className+", "+first+"! 🎉"):("Willkommen, "+first+"! 🎉"),"ok");
  route();
}
function setBusy(b){ const btn=document.getElementById("auSubmit"); if(btn){ btn.disabled=b; btn.innerHTML = b?'<span class="spin" style="width:18px;height:18px;border-top-color:#fff;border-color:rgba(255,255,255,.4)"></span>':(authState.mode==="login"?"Anmelden":"Account erstellen"); } }

/* ============================================================================
   APP-SHELL (Topbar)
   ============================================================================ */
function shell(inner){
  if(typeof pageView!=="undefined" && pageView){ try{ pageView.destroy(); }catch(e){} pageView=null; }
  const roleBadge = ME.role==="admin" ? `<span class="badge" style="background:#ffe0b2;color:#b35900">Admin</span>` : ME.role==="teacher" ? `<span class="badge blue">Lehrkraft</span>` : `<span class="badge">Schüler:in</span>`;
  app().innerHTML = `
    <div class="topbar">
      <div class="brand"><span class="h">${HAMSTER}</span> Informatik am Gymnasium Wesermünde</div>
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
let solveState=null, reviewState=null, sampleState=null, sandboxState=null;
const DEFAULT_STARTER = "void main() {\n    \n}";
api.listAssignments = async (classId)=>{ const {data,error}=await sb.from("assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };
api.getAssignment = async (id)=>{ const {data,error}=await sb.from("assignments").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.createAssignment = async (a)=>{ const {data:mx}=await sb.from("assignments").select("position").eq("class_id",a.class_id).order("position",{ascending:false}).limit(1); const position=(mx&&mx[0]?mx[0].position:0)+1; const {data,error}=await sb.from("assignments").insert(Object.assign({position},a)).select().single(); if(error) throw error; return data; };
api.deleteAssignment = async (id)=>{ const {error}=await sb.from("assignments").delete().eq("id",id); if(error) throw error; };
api.updateAssignment = async (id, patch)=>{ const {data,error}=await sb.from("assignments").update(patch).eq("id",id).select().single(); if(error) throw error; return data; };
api.listTemplates = async ()=>{ const {data,error}=await sb.from("templates").select("*").order("created_at",{ascending:false}); if(error) throw error; return data||[]; };
api.createTemplate = async (t)=>{ const {data,error}=await sb.from("templates").insert(Object.assign({owner_id:ME.id},t)).select().single(); if(error) throw error; return data; };
api.deleteTemplate = async (id)=>{ const {error}=await sb.from("templates").delete().eq("id",id); if(error) throw error; };
async function moveAssignment(list, id, dir){ const i=list.findIndex(x=>x.id===id); const j=i+dir; if(i<0||j<0||j>=list.length) return; const a=list[i], b=list[j]; await api.updateAssignment(a.id,{position:b.position}); await api.updateAssignment(b.id,{position:a.position}); }
/* Abgaben: mehrere je Schüler:in + Historie; genau eine ist "aktuell" (is_current) */
api.addSubmission = async (s)=>{ const row=Object.assign({student_id:ME.id, is_current:true, submitted_at:new Date().toISOString()}, s); const {data,error}=await sb.from("submissions").insert(row).select().single(); if(error) throw error; return data; };
api.myCurrentSubmission = async (assignmentId)=>{ const {data,error}=await sb.from("submissions").select("*").eq("assignment_id",assignmentId).eq("student_id",ME.id).eq("is_current",true).maybeSingle(); if(error) throw error; return data; };
api.mySubmissions = async (assignmentId)=>{ const {data,error}=await sb.from("submissions").select("*").eq("assignment_id",assignmentId).eq("student_id",ME.id).order("submitted_at",{ascending:false}); if(error) throw error; return data||[]; };
api.classSubmissions = async (assignmentIds)=>{ if(!assignmentIds.length) return []; const {data,error}=await sb.from("submissions").select("*").in("assignment_id",assignmentIds).order("submitted_at",{ascending:false}); if(error) throw error; return data||[]; };

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
api.listSandboxProjects = async (classId)=>{ const {data,error}=await sb.from("sandbox_projects").select("*").eq("class_id",classId).eq("owner_id",ME.id).order("updated_at",{ascending:false}); if(error) throw error; return data||[]; };
api.getSandboxProject = async (id)=>{ const {data,error}=await sb.from("sandbox_projects").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.createSandboxProject = async (p)=>{ const {data,error}=await sb.from("sandbox_projects").insert(Object.assign({owner_id:ME.id},p)).select().single(); if(error) throw error; return data; };
api.updateSandboxProject = async (id, patch)=>{ const {data,error}=await sb.from("sandbox_projects").update(Object.assign({updated_at:new Date().toISOString()},patch)).eq("id",id).select().single(); if(error) throw error; return data; };
api.deleteSandboxProject = async (id)=>{ const {error}=await sb.from("sandbox_projects").delete().eq("id",id); if(error) throw error; };

/* Mehrere Lehrkräfte je Klasse + Schüler entfernen/löschen */
api.listTeachers = async ()=>{ const {data,error}=await sb.from("profiles").select("id,username,display_name").eq("role","teacher").order("display_name"); if(error) throw error; return data||[]; };
api.listClassTeachers = async (classId)=>{ const {data,error}=await sb.from("class_teachers").select("teacher_id, profiles:teacher_id(username,display_name)").eq("class_id",classId); if(error) throw error; return data||[]; };
api.addClassTeacher = async (classId, teacherId)=>{ const {error}=await sb.from("class_teachers").insert({class_id:classId, teacher_id:teacherId}); if(error) throw error; };
api.removeClassTeacher = async (classId, teacherId)=>{ const {error}=await sb.from("class_teachers").delete().eq("class_id",classId).eq("teacher_id",teacherId); if(error) throw error; };
api.removeMembership = async (classId, studentId)=>{ const {error}=await sb.from("memberships").delete().eq("class_id",classId).eq("student_id",studentId); if(error) throw error; };
api.adminDeleteStudent = async (studentId)=>{ const {error}=await sb.rpc("admin_delete_student",{p_user:studentId}); if(error) throw error; };

/* Headless: Code auf frischer Kopie des Territoriums laufen lassen -> Endmodell (wirft bei Fehler) */
function runHeadless(code, territory){
  const ast=HamsterEngine.parse(code);
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

/* ---------- Lehrer: Aufgabe stellen / bearbeiten ---------- */
function newAssignmentDialog(classId, onDone, existing){
  const ex = existing || null;
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>${ex?"Aufgabe bearbeiten":"Neue Aufgabe"}</h3>
    ${ex?"":`<div class="field"><label>Aus Vorlage laden</label>
      <div style="display:flex;gap:8px"><select class="input" id="asTpl" style="flex:1"><option value="">– keine –</option></select>
      <button class="btn btn-ghost btn-sm" id="asDelTpl" title="Vorlage löschen" style="display:none">🗑️</button></div></div>`}
    <div class="field"><label>Titel</label><input class="input" id="asTitle" placeholder="z. B. Lauf bis zur Wand" maxlength="80"></div>
    <div class="field"><label>Aufgabenstellung</label><textarea class="input" id="asDesc" placeholder="Was soll der Hamster tun?"></textarea></div>
    <div class="field"><label>Territorium (anklicken zum Bearbeiten)</label><div id="asDesign"></div></div>
    <div class="field"><label>Startcode für Schüler (optional)</label><textarea class="input" id="asStarter" style="font-family:monospace;font-size:13px;min-height:70px" placeholder="${esc(DEFAULT_STARTER)}"></textarea></div>
    <div class="field"><label>Spickzettel / Tipp (optional)</label><textarea class="input" id="asHint" style="min-height:54px" placeholder="Hinweis, den Schüler:innen einblenden können"></textarea></div>
    <div class="field"><label>Auto-Check (optional)</label>
      <select class="input" id="asGoalType">
        <option value="">Kein Auto-Check</option>
        <option value="noGrains">Feld leer – alle Körner gefressen</option>
        <option value="grainsInMaul">Hamster hat ≥ N Körner im Maul</option>
        <option value="atPos">Hamster steht am Ziel (Reihe/Spalte)</option>
        <option value="solution">Mit Musterlösung vergleichen (Lösungscode)</option>
      </select>
      <div id="asGoalExtra" style="margin-top:8px"></div>
    </div>
    <label style="display:flex;gap:9px;align-items:center;font-weight:800;margin:2px 0 14px;cursor:pointer"><input type="checkbox" id="asPublish" style="width:18px;height:18px"> Für die Klasse sichtbar (veröffentlichen)</label>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" id="asSaveTpl" style="flex:none">💾 Als Vorlage</button>
      <button class="btn btn-primary" id="asSave" style="flex:1">${ex?"Änderungen speichern":"Aufgabe stellen"}</button>
    </div>`, true);
  modalView = new HamsterView("#asDesign", { mode:"design", model: ex? ex.territory : HamsterEngine.blankTerr() });
  const gt=document.getElementById("asGoalType"), extra=document.getElementById("asGoalExtra");
  const renderExtra=()=>{ if(gt.value==="grainsInMaul") extra.innerHTML=`<input class="input" id="asGoalN" type="number" min="1" value="5" placeholder="Anzahl Körner">`;
    else if(gt.value==="atPos") extra.innerHTML=`<div style="display:flex;gap:8px"><input class="input" id="asGoalR" type="number" min="0" value="0" placeholder="Reihe"><input class="input" id="asGoalC" type="number" min="0" value="0" placeholder="Spalte"></div>`;
    else if(gt.value==="solution") extra.innerHTML=`<textarea class="input" id="asSolCode" style="font-family:monospace;font-size:13px;min-height:96px" placeholder="Lösungscode der Lehrkraft – wird NICHT an Schüler:innen gezeigt"></textarea><label style="display:flex;gap:8px;align-items:center;font-weight:700;margin-top:6px;cursor:pointer"><input type="checkbox" id="asSolHam"> Endposition des Hamsters muss auch stimmen</label><div class="muted" style="font-size:12px;margin-top:4px">Baue oben im Territorium die Startwelt – der Lösungscode erzeugt daraus den Soll-Zustand. Beim Speichern wird er getestet.</div>`;
    else extra.innerHTML=""; };
  gt.onchange=renderExtra;
  const gatherGoal=()=>{ if(gt.value==="noGrains")return{type:"noGrains"}; if(gt.value==="grainsInMaul")return{type:"grainsInMaul",n:Math.max(1,+(document.getElementById("asGoalN")||{}).value||1)}; if(gt.value==="atPos")return{type:"atPos",row:+(document.getElementById("asGoalR")||{}).value||0,col:+(document.getElementById("asGoalC")||{}).value||0};
    if(gt.value==="solution"){ const code=((document.getElementById("asSolCode")||{}).value||"").trim(); if(!code) throw new Error("Bitte den Lösungscode eingeben."); return computeSolutionGoal(code, modalView.getTerritory(), !!(document.getElementById("asSolHam")||{}).checked); }
    return null; };
  const fill=(o, withTerritory)=>{ document.getElementById("asTitle").value=o.title||""; document.getElementById("asDesc").value=o.description||""; document.getElementById("asStarter").value=o.starter_code||""; document.getElementById("asHint").value=o.hint||""; gt.value=(o.goal&&o.goal.type)||""; renderExtra(); if(o.goal){ if(o.goal.type==="grainsInMaul"&&document.getElementById("asGoalN"))document.getElementById("asGoalN").value=o.goal.n; if(o.goal.type==="atPos"){ if(document.getElementById("asGoalR"))document.getElementById("asGoalR").value=o.goal.row; if(document.getElementById("asGoalC"))document.getElementById("asGoalC").value=o.goal.col; } } if(o.goal&&o.goal.type==="solution"){ const t=document.getElementById("asSolCode"); if(t&&o.solution_code!=null) t.value=o.solution_code; const h=document.getElementById("asSolHam"); if(h) h.checked=!!o.match_hamster; } if(withTerritory&&o.territory){ modalView.destroy(); modalView=new HamsterView("#asDesign",{mode:"design",model:o.territory}); } };
  document.getElementById("asPublish").checked = ex? !!ex.published : true;
  if(ex){ fill(ex, false); if(ex.goal&&ex.goal.type==="solution"){ api.getAssignmentSolution(ex.id).then(s=>{ if(s){ const t=document.getElementById("asSolCode"); if(t) t.value=s.code||""; const h=document.getElementById("asSolHam"); if(h) h.checked=!!s.match_hamster; } }).catch(()=>{}); } }
  else { renderExtra();
    const tplSel=document.getElementById("asTpl"), delTpl=document.getElementById("asDelTpl");
    api.listTemplates().then(tpls=>{ window._tpls=tpls; tplSel.innerHTML='<option value="">– keine –</option>'+tpls.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join(""); }).catch(()=>{});
    tplSel.onchange=()=>{ const t=(window._tpls||[]).find(x=>x.id===tplSel.value); delTpl.style.display=t?"inline-flex":"none"; if(t) fill(t, true); };
    delTpl.onclick=async()=>{ if(!tplSel.value)return; if(!confirm("Vorlage löschen?"))return; try{ await api.deleteTemplate(tplSel.value); window._tpls=(window._tpls||[]).filter(x=>x.id!==tplSel.value); tplSel.innerHTML='<option value="">– keine –</option>'+window._tpls.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join(""); delTpl.style.display="none"; toast("Vorlage gelöscht","ok"); }catch(e){ toast(e.message,"err"); } };
  }
  document.getElementById("asTitle").focus();
  document.getElementById("asSaveTpl").onclick=async()=>{
    const title=document.getElementById("asTitle").value.trim()||"Unbenannte Vorlage";
    let goal; try{ goal=gatherGoal(); }catch(e){ toast(e.message||"Lösungscode fehlerhaft","err"); return; }
    try{ await api.createTemplate({ title, description:document.getElementById("asDesc").value.trim(), territory:modalView.getTerritory(), starter_code:document.getElementById("asStarter").value.trim()||null, goal, hint:document.getElementById("asHint").value.trim()||null, solution_code:(document.getElementById("asSolCode")||{}).value||null, match_hamster:!!(document.getElementById("asSolHam")||{}).checked }); toast("Als Vorlage gespeichert 💾","ok"); }
    catch(e){ toast(e.message||"Fehler","err"); }
  };
  document.getElementById("asSave").onclick=async()=>{
    const title=document.getElementById("asTitle").value.trim(); if(!title){ document.getElementById("asTitle").focus(); return; }
    let goal; try{ goal=gatherGoal(); }catch(e){ toast(e.message||"Lösungscode fehlerhaft","err"); return; }
    const solCode=(document.getElementById("asSolCode")||{}).value||"", solHam=!!(document.getElementById("asSolHam")||{}).checked;
    const payload={ title, description:document.getElementById("asDesc").value.trim(), territory:modalView.getTerritory(), starter_code:document.getElementById("asStarter").value.trim()||null, goal, hint:document.getElementById("asHint").value.trim()||null, published:document.getElementById("asPublish").checked };
    const btn=document.getElementById("asSave"); btn.disabled=true; btn.textContent="Speichere…";
    try{
      let aid;
      if(ex){ await api.updateAssignment(ex.id, payload); aid=ex.id; }
      else { const created=await api.createAssignment(Object.assign({class_id:classId}, payload)); aid=created.id; }
      if(goal && goal.type==="solution"){ await api.saveAssignmentSolution(aid, solCode, solHam); }
      else { try{ await api.deleteAssignmentSolution(aid); }catch(_){} }
      closeModal(); toast(ex?"Aufgabe aktualisiert ✓":(payload.published?"Aufgabe veröffentlicht 🎉":"Entwurf gespeichert ✓"),"ok");
      if(onDone) onDone();
    } catch(e){ btn.disabled=false; btn.textContent=ex?"Änderungen speichern":"Aufgabe stellen"; toast(e.message||"Fehler","err"); }
  };
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
    <div id="reviewHost" style="height:76vh;min-height:560px"></div>
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
  pageView = new HamsterView("#reviewHost", { mode:"solve", model:s.assignment.territory, code:sub.code, fill:true, goal:s.assignment.goal });
  if(s.history.length>1) renderVerNav();
  const ta=document.getElementById("revComment"), rel=document.getElementById("revRelease"), del=document.getElementById("revDelete"), msg=document.getElementById("revMsg");
  if(ta) ta.value=""; if(rel) rel.checked=false; if(del) del.style.display="none"; if(msg) msg.textContent="";
  try{ const c=await api.getComment(sub.id); if(c){ if(ta) ta.value=c.body||""; if(rel) rel.checked=!!c.released; if(del) del.style.display=""; } }catch(e){}
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
    <div id="smEditHost" style="height:74vh;min-height:560px"></div>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary btn-lg" id="smSave" style="max-width:260px">💾 Speichern</button>
      <button class="btn btn-ghost" id="smNew" style="display:none">➕ Neue (Editor leeren)</button>
      <span id="smMsg" class="muted"></span>
    </div>`;
  document.getElementById("back").onclick = ()=> teacherClassView(classId);
  pageView = new HamsterView("#smEditHost", { mode:"solve", model:assignment.territory, code:(assignment.starter_code||DEFAULT_STARTER), fill:true, goal:assignment.goal });
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
  let a, history=[], comments=[], samples=[];
  try{
    a = await api.getAssignment(assignmentId);
    history = await api.mySubmissions(assignmentId);
    comments = await api.myComments(history.map(s=>s.id));
    samples = await api.releasedSamples(assignmentId);
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const current = history.find(s=>s.is_current) || null;
  const code = current ? current.code : (a.starter_code || DEFAULT_STARTER);
  solveState = { a, history, comments, samples, current, viewingId: current?current.id:null };
  const statusHtml = current ? (current.passed===true?`<span class="badge">bestanden ✓</span>`:`<span class="badge gold">abgegeben</span>`) : `<span class="badge gray">offen</span>`;
  const curComment = current ? comments.find(c=>c.submission_id===current.id && c.released) : null;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück</button></div>
    <div class="page-head" style="margin-top:0"><h2>${esc(a.title)}</h2><div class="spacer"></div><span id="solveStatus">${statusHtml}</span></div>
    ${a.description?`<div class="card" style="margin-bottom:12px"><b>Aufgabe:</b> ${esc(a.description)}${a.goal?`<div class="muted" style="margin-top:6px;font-size:13px">🎯 Ziel: ${esc(goalLabel(a.goal))}</div>`:""}</div>`:""}
    ${a.hint?`<div style="margin-bottom:12px"><button class="btn btn-ghost btn-sm" id="btnHint">💡 Tipp anzeigen</button><div id="hintBox" class="card" style="display:none;margin-top:8px;background:#fffaf0">💡 ${esc(a.hint)}</div></div>`:""}
    <div id="curComment" style="margin-bottom:12px">${curComment?`<div class="card" style="background:#eef6ff;border-color:#bcd9f5"><b>💬 Rückmeldung deiner Lehrkraft:</b><div style="margin-top:4px;white-space:pre-wrap">${esc(curComment.body)}</div></div>`:""}</div>
    <div id="editNote" class="editnote" style="display:none"></div>
    <div id="solveHost" style="height:82vh;min-height:600px"></div>
    <div style="display:flex;gap:10px;margin-top:14px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary btn-lg" id="btnSubmit" style="max-width:240px">📤 Abgeben</button>
      <button class="btn btn-ghost" id="btnToLive" style="display:none">↺ Zur aktuellen Version</button>
      ${samples.length?`<button class="btn btn-ghost" id="btnSamples">🏆 Musterlösung${samples.length>1?"en":""} ansehen</button>`:""}
      <span id="submitMsg" class="muted"></span>
    </div>
    <div id="histCard"></div>`;
  document.getElementById("back").onclick = ()=> studentClassView(a.class_id);
  if(a.hint){ const hb=document.getElementById("hintBox"), bh=document.getElementById("btnHint"); bh.onclick=()=>{ const show=hb.style.display==="none"; hb.style.display=show?"block":"none"; bh.textContent=show?"💡 Tipp verbergen":"💡 Tipp anzeigen"; }; }
  pageView = new HamsterView("#solveHost", { mode:"solve", model:a.territory, code, fill:true, goal:a.goal });
  renderHistoryCard();
  const sb2=document.getElementById("btnSamples"); if(sb2) sb2.onclick=()=> openSamplesViewer(a, samples);
  document.getElementById("btnToLive").onclick = ()=> loadVersion(solveState.current);
  document.getElementById("btnSubmit").onclick = submitSolution;
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
function loadVersion(sub){
  if(!sub||!solveState) return;
  solveState.viewingId = sub.id;
  if(pageView) pageView.setCode(sub.code);
  setEditNote();
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
    setEditNote(); renderHistoryCard();
    btn.disabled=false; btn.textContent="📤 Erneut abgeben";
    toast("Abgegeben!","ok");
  }catch(e){ btn.disabled=false; btn.textContent="📤 Abgeben"; toast(e.message||"Fehler","err"); }
}
function openSamplesViewer(a, samples){
  let idx=0; const nav = samples.length>1;
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>🏆 Musterlösung${samples.length>1?"en":""}</h3>
    ${nav?`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><button class="btn btn-ghost btn-sm" id="smPrev">←</button><span id="smTitle" style="font-weight:800;flex:1;text-align:center"></span><button class="btn btn-ghost btn-sm" id="smNext">→</button></div>`:`<div id="smTitle" style="font-weight:800;margin-bottom:8px"></div>`}
    <p class="muted" style="font-size:12px;margin:0 0 8px">Du kannst die Lösung laufen lassen und Schritt für Schritt nachvollziehen.</p>
    <div id="smHost" style="height:64vh;min-height:460px"></div>`, true);
  const show=()=>{ const sm=samples[idx]; document.getElementById("smTitle").textContent=sm.title||("Musterlösung "+(idx+1)); if(modalView){ try{ modalView.destroy(); }catch(e){} } modalView=new HamsterView("#smHost",{mode:"solve", model:a.territory, code:sm.code, fill:true, goal:a.goal}); };
  if(nav){ document.getElementById("smPrev").onclick=()=>{ idx=(idx-1+samples.length)%samples.length; show(); }; document.getElementById("smNext").onclick=()=>{ idx=(idx+1)%samples.length; show(); }; }
  show();
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
   ADMIN-ANSICHT (alle Klassen & Nutzer:innen verwalten)
   ============================================================================ */
let adminState=null;
async function adminHome(){
  shell(`<div class="center-load"><span class="spin"></span>Admin lädt…</div>`);
  let classes=[], users=[];
  try{
    const c=await sb.from("classes").select("*, teacher:teacher_id(display_name,username)").order("created_at",{ascending:false}); if(c.error) throw c.error; classes=c.data||[];
    const u=await sb.from("profiles").select("id,username,display_name,role").order("role"); if(u.error) throw u.error; users=u.data||[];
  }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  adminState={classes, users};
  const tN=users.filter(u=>u.role==="teacher").length, sN=users.filter(u=>u.role==="student").length, aN=users.filter(u=>u.role==="admin").length;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><h2>🛠️ Admin</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewClass">+ Neue Klasse</button></div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">📚 Klassen <span class="badge gray">${classes.length}</span></h3><div style="flex:1"></div>
        <input class="input" id="admClsSearch" placeholder="🔍 Klasse · Code · Lehrkraft" style="max-width:260px"></div>
      <div id="admClasses" style="margin-top:12px"></div></div>
    <div class="card">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">👥 Nutzer:innen <span class="badge gray">${users.length}</span> <span class="muted" style="font-weight:600;font-size:12px">· ${tN} Lehrkräfte · ${sN} Schüler:innen${aN?" · "+aN+" Admin":""}</span></h3><div style="flex:1"></div>
        <input class="input" id="admUsrSearch" placeholder="🔍 Name · Benutzername" style="max-width:260px"></div>
      <div id="admUsers" style="margin-top:12px"></div></div>`;
  document.getElementById("btnNewClass").onclick = newClassDialog;
  const cs=document.getElementById("admClsSearch"), us=document.getElementById("admUsrSearch");
  cs.oninput=()=> renderAdminClasses(cs.value); us.oninput=()=> renderAdminUsers(us.value);
  renderAdminClasses(""); renderAdminUsers("");
}
function renderAdminClasses(q){
  const el=document.getElementById("admClasses"); if(!el||!adminState) return;
  q=(q||"").trim().toLowerCase();
  const tname=c=>(c.teacher&&(c.teacher.display_name||c.teacher.username))||"";
  const list=adminState.classes.filter(c=> !q || (c.name||"").toLowerCase().includes(q)||(c.code||"").toLowerCase().includes(q)||tname(c).toLowerCase().includes(q));
  el.innerHTML = list.length ? `<div class="grid">${list.map(c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b> · 👩‍🏫 ${esc(tname(c)||"–")}${c.sandbox_enabled?" · 🧪":""}</div></div>`).join("")}</div>`
    : `<div class="empty" style="padding:14px"><span class="ic">🔍</span>Keine Klasse gefunden.</div>`;
  el.querySelectorAll(".card.click").forEach(c=> c.onclick=()=> teacherClassView(c.dataset.id));
}
function renderAdminUsers(q){
  const el=document.getElementById("admUsers"); if(!el||!adminState) return;
  q=(q||"").trim().toLowerCase();
  const list=adminState.users.filter(u=> !q || (u.display_name||"").toLowerCase().includes(q)||(u.username||"").toLowerCase().includes(q));
  const rows=list.map(u=>`<tr><td class="stu">${esc(u.display_name||u.username)}</td><td><code>${esc(u.username)}</code></td>
      <td>${u.role==="admin"?'<span class="badge" style="background:#ffe0b2;color:#b35900">Admin</span>':u.role==="teacher"?'<span class="badge blue">Lehrkraft</span>':'<span class="badge gray">Schüler:in</span>'}</td>
      <td style="white-space:nowrap">${u.role==="admin"?"":`<button class="btn btn-sm btn-ghost" data-role="${u.id}" data-to="${u.role==="teacher"?"student":"teacher"}" data-nm="${esc(u.display_name||u.username)}">${u.role==="teacher"?"→ Schüler:in":"→ Lehrkraft"}</button>${u.role==="student"?` <button class="btn btn-sm btn-ghost" data-delusr="${u.id}" data-nm="${esc(u.display_name||u.username)}" title="Account löschen">🗑️</button>`:""}`}</td></tr>`).join("");
  el.innerHTML = list.length ? `<div style="overflow:auto"><table class="matrix" style="width:100%"><thead><tr><th class="stu">Name</th><th>Benutzername</th><th>Rolle</th><th>Aktionen</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty" style="padding:14px"><span class="ic">🔍</span>Niemand gefunden.</div>`;
  el.querySelectorAll("[data-role]").forEach(b=> b.onclick=async()=>{ if(!confirm("Rolle von "+b.dataset.nm+" auf „"+(b.dataset.to==="teacher"?"Lehrkraft":"Schüler:in")+"“ ändern?")) return; try{ await sb.rpc("set_user_role",{p_user:b.dataset.role, p_role:b.dataset.to}); toast("Rolle geändert ✓","ok"); adminHome(); }catch(e){ toast(e.message||"Fehler","err"); } });
  el.querySelectorAll("[data-delusr]").forEach(b=> b.onclick=async()=>{ if(!confirm("Account von "+b.dataset.nm+" WIRKLICH löschen? Alle Abgaben & Daten werden entfernt – nicht umkehrbar.")) return; try{ await api.adminDeleteStudent(b.dataset.delusr); toast("Account gelöscht","ok"); adminHome(); }catch(e){ toast(e.message||"Fehler","err"); } });
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
        <button class="btn btn-sm btn-ghost" data-stu="${m.student_id}" data-nm="${esc(nm)}" title="Passwort zurücksetzen">🔑</button>
        <button class="btn btn-sm btn-ghost" data-rmstu="${m.student_id}" data-nm="${esc(nm)}" title="aus Klasse entfernen">🗑️</button></div>`;
    }).join("")}</div>`
    : `<div class="empty"><span class="ic">🎒</span>Noch keine Schüler:innen. Teile den Code <b>${esc(cls.code)}</b>!</div>`;

  let assignments=[], subs=[];
  try{ assignments = await api.listAssignments(classId); subs = await api.classSubmissions(assignments.map(a=>a.id)); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }

  const assignHtml = assignments.length ? `<div class="list">${assignments.map(a=>`
      <div class="row"><span class="grow"><span class="t">${esc(a.title)} ${a.published?"":'<span class="badge gold">Entwurf</span>'}</span><span class="s">${a.goal?`🎯 ${esc(goalLabel(a.goal))}`:"kein Auto-Check"}</span></span>
        <span class="acts">
          <button class="abtn" data-up="${a.id}" title="nach oben">↑</button>
          <button class="abtn" data-down="${a.id}" title="nach unten">↓</button>
          <button class="abtn" data-pub="${a.id}" data-on="${a.published?1:0}" title="${a.published?'verbergen (Entwurf)':'veröffentlichen'}">${a.published?'👁️':'🚀'}</button>
          <button class="abtn" data-sample="${a.id}" title="Musterlösungen verwalten">★</button>
          <button class="abtn" data-edit="${a.id}" title="bearbeiten">✏️</button>
          <button class="abtn" data-del="${a.id}" title="löschen">🗑️</button>
        </span></div>`).join("")}</div>`
    : `<div class="empty" style="padding:16px"><span class="ic">📝</span>Noch keine Aufgaben.</div>`;
  const matrixHtml = (assignments.length && roster.length) ? buildMatrix(roster, assignments, subs)
    : `<div class="empty"><span class="ic">📊</span>${!assignments.length?"Stelle Aufgaben – dann erscheint hier, wer was abgegeben hat.":"Noch keine Schüler:innen in der Klasse."}</div>`;

  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0">
      <h2>${esc(cls.name)} <button class="btn btn-ghost btn-sm" id="btnRename" title="Klasse umbenennen" style="vertical-align:middle">✏️</button></h2>
      <div class="spacer"></div>
      <span class="codechip" title="Einlade-Code">🔑 ${esc(cls.code)} <button class="btn btn-sm btn-ghost" id="copyCode" style="margin-left:4px">Kopieren</button></span>
      <button class="btn btn-ghost btn-sm" id="btnSandbox" style="margin-left:8px" title="Freien Sandbox-Modus für Schüler:innen an/aus">${cls.sandbox_enabled?"🧪 Sandbox: an":"🧪 Sandbox: aus"}</button>
      ${ME.role==="admin"?`<button class="btn btn-ghost btn-sm" id="btnTeachers" style="margin-left:8px" title="Lehrkräfte dieser Klasse zuweisen">👩‍🏫 Lehrkräfte</button>`:""}
    </div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">🎒 Schüler:innen <span class="badge gray">${roster.length}</span></h3><div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="btnImport">📥 Importieren</button></div>
      <div style="margin-top:12px">${rosterHtml}</div></div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0">📝 Aufgaben <span class="badge gray">${assignments.length}</span></h3>
        <div style="flex:1"></div><button class="btn btn-blue btn-sm" id="btnNewAssign">+ Aufgabe stellen</button></div>
      <div style="margin-top:12px">${assignHtml}</div></div>
    <h3 style="margin:0 0 10px">📊 Abgabe-Matrix</h3>
    ${matrixHtml}`;
  document.getElementById("back").onclick = ()=> (ME.role==="admin"?adminHome():teacherHome());
  document.getElementById("copyCode").onclick = ()=>{ if(navigator.clipboard) navigator.clipboard.writeText(cls.code); toast("Code kopiert: "+cls.code,"ok"); };
  document.getElementById("btnSandbox").onclick = async ()=>{ try{ await api.setSandboxEnabled(classId, !cls.sandbox_enabled); toast(cls.sandbox_enabled?"Sandbox deaktiviert":"Sandbox aktiviert 🧪","ok"); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } };
  document.getElementById("btnRename").onclick = ()=> renameClassDialog(classId, cls.name);
  document.getElementById("btnImport").onclick = ()=> importStudentsDialog(classId, cls.code, ()=>teacherClassView(classId));
  { const bt=document.getElementById("btnTeachers"); if(bt) bt.onclick=()=> classTeachersDialog(classId, cls); }
  document.querySelectorAll("[data-rmstu]").forEach(b=> b.onclick=async()=>{ if(!confirm(b.dataset.nm+" aus dieser Klasse entfernen? (Der Account bleibt bestehen.)")) return; try{ await api.removeMembership(classId, b.dataset.rmstu); toast("Entfernt","ok"); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.getElementById("btnNewAssign").onclick = ()=> newAssignmentDialog(classId, ()=>teacherClassView(classId));
  document.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=>{ const a=assignments.find(x=>x.id===b.dataset.edit); newAssignmentDialog(classId, ()=>teacherClassView(classId), a); });
  document.querySelectorAll("[data-sample]").forEach(b=> b.onclick=()=>{ const a=assignments.find(x=>x.id===b.dataset.sample); sampleManager(a, classId); });
  document.querySelectorAll("[data-up]").forEach(b=> b.onclick=async()=>{ await moveAssignment(assignments, b.dataset.up, -1); teacherClassView(classId); });
  document.querySelectorAll("[data-down]").forEach(b=> b.onclick=async()=>{ await moveAssignment(assignments, b.dataset.down, 1); teacherClassView(classId); });
  document.querySelectorAll("[data-pub]").forEach(b=> b.onclick=async()=>{ try{ await api.updateAssignment(b.dataset.pub, { published: b.dataset.on!=="1" }); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{ if(!confirm("Aufgabe wirklich löschen?")) return; try{ await api.deleteAssignment(b.dataset.del); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } });
  document.querySelectorAll(".cell[data-aid]").forEach(c=> c.onclick=()=>{
    const aid=c.dataset.aid, sid=c.dataset.sid;
    const a=assignments.find(x=>x.id===aid);
    const hist=subs.filter(x=>x.assignment_id===aid && x.student_id===sid);
    if(!a||!hist.length) return;
    const stu=roster.find(r=>r.student_id===sid);
    const nm=(stu&&stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?";
    reviewSubmission(a, hist, nm, classId);
  });
  document.querySelectorAll("[data-stu]").forEach(b=> b.onclick=()=> resetStudentPw(b.dataset.stu, b.dataset.nm));
}
function buildMatrix(roster, assignments, subs){
  const head = assignments.map(a=>`<th title="${esc(a.title)}">${esc(a.title.length>14?a.title.slice(0,13)+"…":a.title)}</th>`).join("");
  const rows = roster.map(stu=>{
    const nm=(stu.profiles&&(stu.profiles.display_name||stu.profiles.username))||"?";
    const cells = assignments.map(a=>{
      const mine=subs.filter(x=>x.assignment_id===a.id && x.student_id===stu.student_id);
      const cur=mine.find(z=>z.is_current) || mine[0];
      if(!cur) return `<td><span class="cell none">·</span></td>`;
      const cl=cur.passed===true?"pass":"done"; const ic=cur.passed===true?"★":"✓";
      const cnt=mine.length>1?`<sup style="font-size:9px;font-weight:800">${mine.length}</sup>`:"";
      return `<td><span class="cell ${cl}" data-aid="${a.id}" data-sid="${stu.student_id}" title="${mine.length} Abgabe(n) – ansehen">${ic}${cnt}</span></td>`;
    }).join("");
    return `<tr><td class="stu">${esc(nm)}</td>${cells}</tr>`;
  }).join("");
  return `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="stu">Schüler:in</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
/* ---------- Lehrer: Schüler:innen per Liste importieren (Accounts + Passwörter) ---------- */
function parseStudents(text){
  return String(text||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(line=>{
    let parts = line.indexOf(",")>=0 ? line.split(",") : line.split(/\t+|\s{2,}|\s/);
    parts = parts.map(p=>p.trim()).filter(Boolean);
    const first=parts[0]||""; const last=parts.slice(1).join(" ");
    return { first, last, name:(first+" "+last).trim() };
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
    <p class="muted" style="margin:2px 0 12px">Eine Person pro Zeile als <b>Vorname,Nachname</b> (Komma oder Tab, z. B. aus Excel kopiert). Benutzernamen &amp; Passwörter werden automatisch erzeugt – ohne E-Mail-Versand.</p>
    <div class="field"><textarea class="input" id="impText" style="min-height:150px;font-family:monospace;font-size:13px" placeholder="Max,Mustermann&#10;Erika,Musterfrau"></textarea></div>
    <div id="impMsg" class="auth-msg" style="display:none"></div>
    <div style="display:flex;gap:10px"><button class="btn btn-ghost" id="impCancel" style="flex:none">Abbrechen</button><button class="btn btn-primary" id="impParse" style="flex:1">Weiter</button></div>
    <div id="impStage" style="margin-top:14px"></div>`, true);
  document.getElementById("impCancel").onclick = closeModal;
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
    const stu=list[i]; let base=slugUser(stu.first,stu.last), uname=base, k=1;
    while(used.has(uname)) uname=base+(++k);
    const pass=genPass(); let res=null, ok=false, lastErr="";
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
    const je = await imp.rpc("join_class",{ p_code:classCode });
    try{ await imp.auth.signOut(); }catch(e){}
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
function renameClassDialog(classId, current){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>Klasse umbenennen</h3>
    <div class="field"><label>Klassenname</label><input class="input" id="rnName" maxlength="60"></div>
    <button class="btn btn-primary btn-lg" id="rnSave">Speichern</button>`);
  const inp=document.getElementById("rnName"); inp.value=current; inp.focus(); inp.select();
  const go=async()=>{ const name=inp.value.trim(); if(!name){inp.focus();return;}
    const btn=document.getElementById("rnSave"); btn.disabled=true; btn.textContent="Speichere…";
    const { error } = await sb.from("classes").update({ name }).eq("id", classId);
    if(error){ btn.disabled=false; btn.textContent="Speichern"; toast(error.message||"Fehler","err"); return; }
    closeModal(); toast("Umbenannt ✓","ok"); teacherClassView(classId); };
  document.getElementById("rnSave").onclick=go;
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}

/* ---------- Admin: Lehrkräfte einer Klasse zuweisen ---------- */
async function classTeachersDialog(classId, cls){
  openModal(`<button class="x" onclick="closeModal()">✕</button>
    <h3>👩‍🏫 Lehrkräfte – ${esc(cls.name)}</h3>
    <p class="muted" style="margin:2px 0 12px">Mehrere Lehrkräfte können dieselbe Klasse betreuen. Die Ersteller-Lehrkraft bleibt immer dabei.</p>
    <div id="ctList" class="list" style="margin-bottom:12px"><div class="center-load"><span class="spin"></span></div></div>
    <div class="field"><label>Lehrkraft hinzufügen</label>
      <div style="display:flex;gap:8px"><select class="input" id="ctSelect" style="flex:1"><option value="">– wählen –</option></select>
      <button class="btn btn-primary" id="ctAdd" style="flex:none">Hinzufügen</button></div></div>`);
  async function refresh(){
    let cot=[], teachers=[];
    try{ cot=await api.listClassTeachers(classId); teachers=await api.listTeachers(); }
    catch(e){ toast(e.message||"Fehler","err"); }
    const ow=teachers.find(t=>t.id===cls.teacher_id);
    const ownerName=ow?(ow.display_name||ow.username):"Ersteller:in";
    const coIds=new Set(cot.map(c=>c.teacher_id));
    const ownerRow=`<div class="row"><span class="grow"><span class="t">${esc(ownerName)}</span><span class="s">Ersteller:in</span></span><span class="badge blue">Eigentümer</span></div>`;
    const coRows=cot.map(c=>{ const p=c.profiles||{}; const nm=p.display_name||p.username||"?"; return `<div class="row"><span class="grow"><span class="t">${esc(nm)}</span><span class="s">Co-Lehrkraft</span></span><button class="btn btn-sm btn-ghost" data-rmteacher="${c.teacher_id}" title="entfernen">🗑️</button></div>`; }).join("");
    const lst=document.getElementById("ctList"); if(lst) lst.innerHTML=ownerRow+coRows;
    const sel=document.getElementById("ctSelect");
    if(sel){ const avail=teachers.filter(t=> t.id!==cls.teacher_id && !coIds.has(t.id)); sel.innerHTML='<option value="">– wählen –</option>'+avail.map(t=>`<option value="${t.id}">${esc(t.display_name||t.username)}</option>`).join(""); }
    document.querySelectorAll("[data-rmteacher]").forEach(b=> b.onclick=async()=>{ try{ await api.removeClassTeacher(classId, b.dataset.rmteacher); toast("Entfernt","ok"); refresh(); }catch(e){ toast(e.message||"Fehler","err"); } });
  }
  document.getElementById("ctAdd").onclick=async()=>{ const sel=document.getElementById("ctSelect"); if(!sel.value) return; try{ await api.addClassTeacher(classId, sel.value); toast("Hinzugefügt ✓","ok"); refresh(); }catch(e){ toast(e.message||"Fehler","err"); } };
  refresh();
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
    if(assignments.length){ const { data:s } = await sb.from("submissions").select("*").in("assignment_id",assignments.map(a=>a.id)).eq("student_id",ME.id).eq("is_current",true); mySubs=s||[]; }
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
    <div class="page-head" style="margin-top:0"><h2>${esc(cls?cls.name:"Klasse")}</h2><div class="spacer"></div>${(cls&&cls.sandbox_enabled)?'<button class="btn btn-ghost" id="btnSandbox">🧪 Sandbox</button>':''}</div>
    ${list}`;
  document.getElementById("back").onclick = studentHome;
  const sbx=document.getElementById("btnSandbox"); if(sbx) sbx.onclick=()=> sandboxHome(classId);
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=()=> solveAssignment(r.dataset.id));
}

/* ============================================================================
   SANDBOX (freier Modus) – Schüler:innen bauen Welt + Code, speicherbar
   ============================================================================ */
async function sandboxHome(classId){
  shell(`<div class="center-load"><span class="spin"></span>Sandbox…</div>`);
  let cls, projects=[];
  try{ const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data; projects=await api.listSandboxProjects(classId); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const list = projects.length ? `<div class="list">${projects.map(p=>`
      <div class="row clickrow" data-id="${p.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(fmtDateTime(p.updated_at))}</span></span>
        <button class="btn btn-sm btn-ghost" data-del="${p.id}" title="löschen">🗑️</button><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🧪</span>Noch keine Projekte. Leg dein erstes an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück</button></div>
    <div class="page-head" style="margin-top:0"><h2>🧪 Sandbox – ${esc(cls?cls.name:"")}</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNew">+ Neues Projekt</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Hier kannst du frei eine Welt bauen und programmieren – ganz ohne Aufgabe. Deine Projekte werden gespeichert.</span></div>
    ${list}`;
  document.getElementById("back").onclick = ()=> studentClassView(classId);
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
    <div id="sbxHost" style="height:80vh;min-height:600px"></div>`;
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
  if(s.sub==="code") pageView=new HamsterView("#sbxHost",{mode:"solve", model:s.territory, code:s.code, fill:true});
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

/* ---------- Footer: Version (letztes Update) + Copyright ---------- */
const APP_BUILD = "2026-06-05 19:25";
(function(){ const f=document.getElementById("appfoot"); if(f) f.innerHTML='© 2026 <b>Laurens Offinger</b> &middot; Version '+APP_BUILD+' Uhr'; })();

boot();
