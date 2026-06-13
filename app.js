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
let viewFromAdmin=false;   // merkt sich, ob eine Klasse aus der Admin-Ansicht geöffnet wurde
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
  const roleBadge = ME.is_admin ? `<span class="badge" style="background:#ffe0b2;color:#b35900">Admin</span>` : ME.role==="teacher" ? `<span class="badge blue">Lehrkraft</span>` : `<span class="badge">Schüler:in</span>`;
  app().innerHTML = `
    <div class="topbar">
      <div class="brand"><span class="h">${HAMSTER}</span> Informatik am Gymnasium Wesermünde</div>
      <div class="spacer"></div>
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
  { const ub=document.getElementById("userBtn"), um=document.getElementById("userMenu");
    if(ub&&um){
      ub.onclick=(e)=>{ e.stopPropagation(); um.style.display = (um.style.display==="none"?"block":"none"); };
      um.querySelectorAll("[data-act]").forEach(b=> b.onclick=()=>{ const a=b.dataset.act; um.style.display="none"; if(a==="admin") adminHome(); else if(a==="pw") changePasswordDialog(); else if(a==="logout") signOut(); });
    }
  }
  if(!window._umClose){ window._umClose=true; document.addEventListener("click",(e)=>{ const um=document.getElementById("userMenu"); if(um && um.style.display!=="none" && !e.target.closest("#userMenu") && !e.target.closest("#userBtn")) um.style.display="none"; }); }
  { const bp=document.getElementById("btnPatch"); if(bp) bp.onclick = patchNotesDialog; }
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
  // Lehrer-Ansicht: NUR eigene + Klassen, in denen ich Co-Lehrkraft bin (auch als Admin)
  async myTeacherClasses(){
    const own = await sb.from("classes").select("*").eq("teacher_id", ME.id); if(own.error) throw own.error;
    const ct = await sb.from("class_teachers").select("class_id").eq("teacher_id", ME.id); if(ct.error) throw ct.error;
    const coIds = (ct.data||[]).map(r=>r.class_id);
    let co=[]; if(coIds.length){ const r = await sb.from("classes").select("*").in("id", coIds); if(r.error) throw r.error; co=r.data||[]; }
    const map=new Map(); [...(own.data||[]), ...co].forEach(c=> map.set(c.id, c));
    return [...map.values()].sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  },
  async deleteClass(id){ const { error } = await sb.from("classes").delete().eq("id", id); if(error) throw error; },
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
let solveState=null, reviewState=null, sampleState=null, sandboxState=null, assignEditState=null;
let classSecOpen={};   // pro Klasse {auf,mat,stu,leh}: Einklapp-Status, überlebt Re-Render, klassenspezifisch
let _classActivity=null;                                      // Cache {class_id: ms} für die Sortierung "letzte Änderung"
const DEFAULT_STARTER = "void main() {\n\t\n}";
api.listAssignments = async (classId)=>{ const {data,error}=await sb.from("assignments").select("*").eq("class_id",classId).order("position").order("created_at"); if(error) throw error; return data||[]; };
api.getAssignment = async (id)=>{ const {data,error}=await sb.from("assignments").select("*").eq("id",id).single(); if(error) throw error; return data; };
api.createAssignment = async (a)=>{ const {data:mx}=await sb.from("assignments").select("position").eq("class_id",a.class_id).order("position",{ascending:false}).limit(1); const position=(mx&&mx[0]?mx[0].position:0)+1; const {data,error}=await sb.from("assignments").insert(Object.assign({position},a)).select().single(); if(error) throw error; return data; };
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
    <div id="aeHost" style="height:74vh;min-height:560px"></div>
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
async function templatesPage(){
  shell(`<div class="center-load"><span class="spin"></span>Vorlagen…</div>`);
  let tpls=[];
  try{ tpls=await api.listTemplates(); }catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const list = tpls.length ? `<div class="list">${tpls.map(t=>`
      <div class="row"><span class="grow"><span class="t clickable" data-edit="${t.id}" title="Vorlage bearbeiten">${esc(t.title)}</span><span class="s">${t.description?esc(t.description.slice(0,80)):"keine Beschreibung"}${t.goal&&t.goal.type?` · 🎯 ${esc(goalLabel(t.goal))}`:""}</span></span>
        <span class="acts"><button class="abtn" data-edit="${t.id}" title="bearbeiten">✏️</button><button class="abtn" data-del="${t.id}" title="löschen">🗑️</button></span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">📋</span>Noch keine Vorlagen. Erstelle deine erste!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← Meine Klassen</button></div>
    <div class="page-head" style="margin-top:0"><h2>📋 Aufgaben-Vorlagen</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNewTpl">+ Neue Vorlage</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Vorlagen sind wiederverwendbare Aufgaben-Bausteine. Beim Erstellen einer Aufgabe kannst du oben „Aus Vorlage laden" wählen.</span></div>
    ${list}`;
  document.getElementById("back").onclick = teacherHome;
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
    <div id="reviewHost" style="height:76vh;min-height:560px"></div>
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
    <div id="smEditHost" style="height:74vh;min-height:560px"></div>
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
    <div id="solveHost" style="height:82vh;min-height:600px"></div>
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
  if(pageView) pageView.setCode(sub.code);
  setEditNote(); renderSolveComment(sub.id); renderMyNote(sub.id);
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
    <div id="smHost" style="height:64vh;min-height:460px"></div>`, true);
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
      <div id="admUsers" style="margin-top:12px"></div></div>`;
  document.getElementById("admBack").onclick = teacherHome;
  document.getElementById("btnNewClass").onclick = newClassDialog;
  const cs=document.getElementById("admClsSearch"), us=document.getElementById("admUsrSearch");
  cs.oninput=()=> renderAdminClasses(cs.value); us.oninput=()=> renderAdminUsers(us.value);
  document.getElementById("admImport").onclick = ()=> adminImportDialog();
  renderAdminClasses(""); renderAdminUsers("");
}
function renderAdminClasses(q){
  const el=document.getElementById("admClasses"); if(!el||!adminState) return;
  q=(q||"").trim().toLowerCase();
  const tname=c=>(c.teacher&&(c.teacher.display_name||c.teacher.username))||"";
  const list=adminState.classes.filter(c=> !q || (c.name||"").toLowerCase().includes(q)||(c.code||"").toLowerCase().includes(q)||tname(c).toLowerCase().includes(q));
  el.innerHTML = list.length ? `<div class="grid">${list.map(c=>`
      <div class="card click" data-id="${c.id}"><h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b> · 👩‍🏫 ${esc(tname(c)||"–")}</div></div>`).join("")}</div>`
    : `<div class="empty" style="padding:14px"><span class="ic">🔍</span>Keine Klasse gefunden.</div>`;
  el.querySelectorAll(".card.click").forEach(c=> c.onclick=()=>{ viewFromAdmin=true; teacherClassView(c.dataset.id); });
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
      const {data:ms}=await sb.from("memberships").select("joined_at, classes:class_id(id,name,code,teacher:teacher_id(display_name,username))").eq("student_id",userId);
      const rows=(ms||[]).map(m=>{ const c=m.classes||{}; const t=c.teacher||{}; return `<div class="row clickrow" data-cls="${c.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(c.name||"?")}</span><span class="s">Code: ${esc(c.code||"–")} · 👩‍🏫 ${esc(t.display_name||t.username||"–")}</span></span><span style="color:#7a8aa0">→</span></div>`; }).join("");
      classesHtml=`<h3 style="margin:0 0 10px">🎒 Klassen (Mitglied) <span class="badge gray">${(ms||[]).length}</span></h3><div class="list">${rows||'<div class="muted" style="font-size:13px">In keiner Klasse.</div>'}</div>`;
    } else {
      const own=await sb.from("classes").select("id,name,code").eq("teacher_id",userId).order("created_at",{ascending:false});
      const co=await sb.from("class_teachers").select("classes:class_id(id,name,code)").eq("teacher_id",userId);
      const ownRows=((own.data)||[]).map(c=>`<div class="row clickrow" data-cls="${c.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(c.name)}</span><span class="s">Code: ${esc(c.code)} · Eigentümer:in</span></span><span style="color:#7a8aa0">→</span></div>`).join("");
      const coRows=((co.data)||[]).map(x=>{ const c=x.classes||{}; return `<div class="row clickrow" data-cls="${c.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(c.name||"?")}</span><span class="s">Code: ${esc(c.code||"–")} · Co-Lehrkraft</span></span><span style="color:#7a8aa0">→</span></div>`; }).join("");
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
  document.querySelectorAll("[data-cls]").forEach(b=> b.onclick=()=>{ viewFromAdmin=true; teacherClassView(b.dataset.cls); });
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
      <button class="btn btn-ghost" id="btnSandbox">🧪 Sandbox</button>
      <button class="btn btn-ghost" id="btnTemplates" style="margin-left:8px">📋 Vorlagen</button>
      <button class="btn btn-primary" id="btnNewClass" style="margin-left:8px">+ Neue Klasse</button></div>
    ${classes.length>1?`<div class="page-head" style="margin:0 0 12px">${classSearchSortControls()}</div>`:""}
    <div id="clsHost"></div>`;
  document.getElementById("btnSandbox").onclick = ()=> sandboxHome(null);
  document.getElementById("btnTemplates").onclick = templatesPage;
  document.getElementById("btnNewClass").onclick = newClassDialog;
  wireClassOverview(classes, c=>`
      <div class="card click" data-id="${c.id}">
        <h3>${esc(c.name)}</h3>
        <div class="meta">Code: <b>${esc(c.code)}</b></div>
      </div>`, id=>{ viewFromAdmin=false; teacherClassView(id); },
    `<div class="empty"><span class="ic">📚</span>Noch keine Klassen. Erstelle deine erste Klasse!</div>`);
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
    <div class="page-head"><button class="crumb" id="back">${viewFromAdmin?"← Admin-Bereich":"← Meine Klassen"}</button></div>
    <div class="page-head" style="margin-top:0">
      <h2>${esc(cls.name)} <button class="btn btn-ghost btn-sm" id="btnRename" title="Klasse umbenennen" style="vertical-align:middle">✏️</button></h2>
      <div class="spacer"></div>
      <span class="codechip" title="Einlade-Code" style="${cls.join_open===false?'opacity:.55;':''}">🔑 ${esc(cls.code)}${cls.join_open===false?' <span class="badge gray" title="Beitritt mit diesem Code ist deaktiviert">aus</span>':''} <button class="btn btn-sm btn-ghost" id="copyCode" style="margin-left:4px">Kopieren</button></span>
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnCodeToggle" style="margin-left:8px" title="${cls.join_open===false?'Beitritt mit diesem Code wieder erlauben':'Beitritt mit diesem Code deaktivieren'}">${cls.join_open===false?'🔓 Aktivieren':'🚫 Code deaktivieren'}</button><button class="btn btn-ghost btn-sm" id="btnCodeNew" style="margin-left:6px" title="Neuen Code erzeugen – der alte wird ungültig">🔄 Neuer Code</button>`:''}
      ${canTeam?`<button class="btn btn-ghost btn-sm" id="btnDeleteClass" style="margin-left:8px;color:#e63a3a" title="Klasse löschen">🗑️ Löschen</button>`:(iAmCoTeacher?`<button class="btn btn-ghost btn-sm" id="btnLeaveClass" style="margin-left:8px;color:#e63a3a" title="Klasse verlassen">🚪 Klasse verlassen</button>`:"")}
    </div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="auf" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.auf?"▼":"▶"}</span><h3 style="margin:0">📝 Aufgaben <span class="badge gray">${assignments.length}</span></h3></span><div style="flex:1"></div><button class="btn btn-blue btn-sm" id="btnNewAssign">+ Aufgabe stellen</button></div>
      <div id="sec-auf" style="margin-top:12px${secOpen.auf?"":";display:none"}">${assignHtml}</div></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="mat" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.mat?"▼":"▶"}</span><h3 style="margin:0">📊 Abgabe-Matrix</h3></span><div style="flex:1"></div></div>
      <div id="sec-mat" style="margin-top:12px${secOpen.mat?"":";display:none"}">${(assignments.length&&roster.length)?`<div style="display:flex;margin-bottom:10px"><div style="flex:1"></div><input class="input" id="matrixSearch" placeholder="🔍 Schüler:in suchen" style="max-width:240px"></div>`:""}<div id="matrixHost"></div></div></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="stu" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.stu?"▼":"▶"}</span><h3 style="margin:0">🎒 Schüler:innen <span class="badge gray">${roster.length}</span></h3></span><div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="btnImport">📥 Importieren</button></div>
      <div id="sec-stu" style="margin-top:12px${secOpen.stu?"":";display:none"}">${rosterHtml}</div></div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="sectoggle" data-sec="leh" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none"><span class="secarrow">${secOpen.leh?"▼":"▶"}</span><h3 style="margin:0">👩‍🏫 Lehrkräfte <span class="badge gray">${teachers.length}</span></h3></span><div style="flex:1"></div>${canTeam?'<button class="btn btn-ghost btn-sm" id="btnTeachers">+ verwalten</button>':''}</div>
      <div id="sec-leh" class="list" style="margin-top:12px${secOpen.leh?"":";display:none"}">${teachers.length?teachers.map(t=>`<div class="row"><span class="chip"><span class="av">${esc(initials(t.display_name||t.username))}</span>${esc(t.display_name||t.username)}</span><div class="grow"></div>${t.is_owner?'<span class="badge blue">Ersteller:in</span>':'<span class="badge gray">Co-Lehrkraft</span>'}</div>`).join(""):'<div class="muted" style="font-size:13px">—</div>'}</div></div>`;
  document.getElementById("back").onclick = ()=> (viewFromAdmin?adminHome():teacherHome());
  document.getElementById("copyCode").onclick = ()=>{ if(navigator.clipboard) navigator.clipboard.writeText(cls.code); toast("Code kopiert: "+cls.code,"ok"); };
  document.getElementById("btnRename").onclick = ()=> renameClassDialog(classId, cls.name);
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
  const wireMatrixHost=()=>{ const host=document.getElementById("matrixHost"); if(!host) return;
    host.querySelectorAll(".cell[data-aid]").forEach(c=> c.onclick=()=>{ const aid=c.dataset.aid, sid=c.dataset.sid; const a=assignments.find(x=>x.id===aid); const hist=subs.filter(x=>x.assignment_id===aid && x.student_id===sid); if(!a||!hist.length) return; reviewSubmission(a, hist, nameOf(sid), classId); });
    host.querySelectorAll("[data-prof]").forEach(b=> b.onclick=()=> openProfile(b.dataset.prof));
  };
  const paintMatrix=(q)=>{ const host=document.getElementById("matrixHost"); if(!host) return;
    host.innerHTML = (assignments.length&&roster.length) ? buildMatrix(roster, assignments, subs, q)
      : `<div class="empty"><span class="ic">📊</span>${!assignments.length?"Stelle Aufgaben – dann erscheint hier, wer was abgegeben hat.":"Noch keine Schüler:innen in der Klasse."}</div>`;
    wireMatrixHost();
  };
  paintMatrix("");
  { const ms=document.getElementById("matrixSearch"); if(ms) ms.oninput=()=> paintMatrix(ms.value); }
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
    <p class="muted" style="margin:2px 0 12px">Eine Person pro Zeile (Komma oder Tab, z. B. aus Excel):<br><b>Vorname, Nachname</b> – optional zusätzlich <b>Benutzername</b> und <b>Passwort</b>. Leer gelassene Felder werden automatisch erzeugt. Kein E-Mail-Versand.</p>
    <div class="field"><textarea class="input" id="impText" style="min-height:150px;font-family:monospace;font-size:13px" placeholder="Max, Mustermann&#10;Erika, Musterfrau, erika.m&#10;Tom, Klein, tom.k, geheim123"></textarea></div>
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
    const je = await imp.from("memberships").insert({ class_id:classId, student_id:uid });   // Lehrer-Import trägt direkt ein (unabhängig von join_open)
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
  { const tb=document.getElementById("ctTransfer"); if(tb) tb.onclick=async()=>{ const sel=document.getElementById("ctTransferSel"); if(!sel.value) return; const nm=(sel.options[sel.selectedIndex]||{}).text||"diese Lehrkraft"; if(!confirm(`Klasse „${cls.name}" wirklich an ${nm} übergeben? ${nm} wird Eigentümer:in mit allen Rechten, du wirst Co-Lehrkraft.`)) return; try{ await api.transferClass(classId, sel.value); closeModal(); toast("Klasse übergeben ✓","ok"); teacherClassView(classId); }catch(e){ toast(e.message||"Fehler","err"); } }; }
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
    <div class="page-head" style="margin-top:0"><h2>${esc(cls?cls.name:"Klasse")}</h2></div>
    ${list}`;
  document.getElementById("back").onclick = studentHome;
  /* Sandbox ist jetzt klassenunabhängig und steht in der Klassenübersicht */
  document.querySelectorAll(".clickrow[data-id]").forEach(r=> r.onclick=()=> solveAssignment(r.dataset.id));
}

/* ============================================================================
   SANDBOX (freier Modus) – Schüler:innen bauen Welt + Code, speicherbar
   ============================================================================ */
async function sandboxHome(classId){
  shell(`<div class="center-load"><span class="spin"></span>Sandbox…</div>`);
  let cls, projects=[];
  try{ if(classId!=null){ const { data } = await sb.from("classes").select("*").eq("id",classId).single(); cls=data; } projects=await api.listSandboxProjects(classId); }
  catch(e){ document.getElementById("view").innerHTML=errBox(e); return; }
  const list = projects.length ? `<div class="list">${projects.map(p=>`
      <div class="row clickrow" data-id="${p.id}" style="cursor:pointer"><span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(fmtDateTime(p.updated_at))}</span></span>
        <button class="btn btn-sm btn-ghost" data-del="${p.id}" title="löschen">🗑️</button><span style="margin-left:8px;color:#7a8aa0">→</span></div>`).join("")}</div>`
    : `<div class="empty"><span class="ic">🧪</span>Noch keine Projekte. Leg dein erstes an!</div>`;
  document.getElementById("view").innerHTML = `
    <div class="page-head"><button class="crumb" id="back">← zurück</button></div>
    <div class="page-head" style="margin-top:0"><h2>${classId==null?"🧪 Meine Sandbox":("🧪 Sandbox – "+esc(cls?cls.name:""))}</h2><div class="spacer"></div><button class="btn btn-primary" id="btnNew">+ Neues Projekt</button></div>
    <div class="card" style="margin-bottom:12px;padding:12px 16px"><span class="muted" style="font-size:13px">Hier kannst du frei eine Welt bauen und programmieren – ganz ohne Aufgabe. Deine Projekte werden gespeichert.</span></div>
    ${list}`;
  document.getElementById("back").onclick = ()=> (classId==null ? (ME.role==="teacher"?teacherHome():studentHome()) : studentClassView(classId));
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
const PATCH_NOTES = [
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
const APP_BUILD = "2026-06-13 19:54";   // letztes Update (im Patch-Notes-Dialog angezeigt)
(function(){ const f=document.getElementById("appfoot"); if(f){ const v=(typeof PATCH_NOTES!=="undefined"&&PATCH_NOTES[0])?PATCH_NOTES[0].v:""; f.textContent='© 2026 Laurens Offinger · Version '+v; } })();

boot();
