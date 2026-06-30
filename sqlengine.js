"use strict";
/* ============================================================================
   SQL-Engine (sql.js / SQLite WebAssembly) – lazy geladen
   Wird NUR geladen/initialisiert, wenn das SQL-Tool wirklich genutzt wird.
   - SqlEngine.ensure()            -> lädt sql-wasm.js + .wasm beim ersten Bedarf
   - SqlEngine.run(dbText)         -> frische Datenbank aus SQL-Text
   - SqlEngine.schema(db)          -> [{name, cols:[{name,type,pk}]}]
   - SqlEngine.normalize(out,ord)  -> Ergebnis-Signatur (für späteres Grading)
   - SqlEngine.resultsEqual(a,b,ord)
   - SqlEngine.samples()           -> Beispiel-Datenbanken (aus sqldata.js)
   - new SqlView("#host",{dbText,query,readonly}) -> Editor + Ausführen + Schema
   ============================================================================ */
(function(){
  var SQLMOD=null, loadingP=null;
  var VER=""; try{ var cs=document.currentScript; var m=cs&&cs.src&&cs.src.match(/[?&]v=([^&]+)/); if(m) VER="?v="+m[1]; }catch(e){}

  function loadScript(src){ return new Promise(function(res,rej){
    var s=document.createElement("script"); s.src=src; s.onload=function(){res();}; s.onerror=function(){rej(new Error("Konnte "+src+" nicht laden"));}; document.head.appendChild(s);
  }); }

  var SqlEngine = {
    ensure: function(){
      if(SQLMOD) return Promise.resolve(SQLMOD);
      if(loadingP) return loadingP;
      loadingP = (async function(){
        if(typeof initSqlJs==="undefined") await loadScript("sql-wasm.js");          // immutable, ohne Cache-Buster
        SQLMOD = await initSqlJs({ locateFile: function(){ return "sql-wasm.wasm"; } });
        return SQLMOD;
      })();
      loadingP.catch(function(){ loadingP=null; });   // bei Fehler zurücksetzen -> erneuter Versuch möglich (sonst SQL-Tool bis Reload tot)
      return loadingP;
    },
    run: async function(dbText){ var SQL=await SqlEngine.ensure(); var db=new SQL.Database(); try{ db.run(dbText||""); }catch(e){ try{ db.close(); }catch(_){} throw e; } return db; },
    schema: function(db){
      var out=[], t;
      try{ t=db.exec("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"); }catch(e){ return out; }
      if(!t.length) return out;
      t[0].values.forEach(function(row){
        var name=row[0], cols=[];
        try{ var info=db.exec("PRAGMA table_info('"+String(name).replace(/'/g,"''")+"')");
          if(info.length) info[0].values.forEach(function(c){ cols.push({name:c[1], type:c[2], pk:c[5]!=0}); });
        }catch(e){}
        out.push({name:name, cols:cols});
      });
      return out;
    },
    samples: function(){ return window.SQL_SAMPLE_DBS||[]; },
    /* ---- Grading-Helfer (für spätere Phasen vorbereitet) ---- */
    normalize: function(out, ordered){
      if(!out||!out.length) return {columns:[], rows:[], empty:true};
      var last=out[out.length-1];
      var columns=last.columns.map(function(c){ return String(c).trim().toLowerCase(); });
      var rows=last.values.map(function(r){ return r.map(normCell); }).map(function(r){ return JSON.stringify(r); });
      if(!ordered) rows=rows.sort();
      return {columns:columns, rows:rows, ordered:!!ordered, empty: last.values.length===0};
    },
    resultsEqual: function(a,b,ordered){
      var na=SqlEngine.normalize(a,ordered), nb=SqlEngine.normalize(b,ordered);
      return JSON.stringify(na.columns)===JSON.stringify(nb.columns) && JSON.stringify(na.rows)===JSON.stringify(nb.rows);
    }
  };
  function normCell(v){ if(v===null||v===undefined) return null; if(typeof v==="number") return Number.isInteger(v)?v:Math.round(v*1e6)/1e6; return String(v).trim(); }
  window.SqlEngine = SqlEngine;

  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function injectStyles(){
    if(document.getElementById("sqv-styles")) return;
    var st=document.createElement("style"); st.id="sqv-styles";
    st.textContent =
      ".sqv{display:flex;flex-direction:column;gap:12px}"
      +".sqv-schema{border:2px solid var(--line);border-radius:12px;background:var(--card)}"
      +".sqv-schema summary{cursor:pointer;padding:10px 14px;font-weight:800;color:var(--muted);user-select:none}"
      +".sqv-schbody{padding:0 14px 12px;display:flex;flex-direction:column;gap:6px}"
      +".sqv-schtab{font-size:13px;line-height:1.9}"
      +".sqv-col{display:inline-block;background:var(--line2);border-radius:7px;padding:2px 8px;margin:0 4px 2px 0;font-family:'JetBrains Mono',Consolas,monospace;font-size:12px}"
      +".sqv-col.pk{background:#fff2cf;color:var(--gold-d);font-weight:800}"
      +".sqv-input{width:100%;min-height:130px;resize:vertical;border:2px solid var(--line);border-radius:12px;padding:12px 14px;font-family:'JetBrains Mono',Consolas,monospace;font-size:14px;line-height:1.5;background:var(--card);color:var(--ink)}"
      +".sqv-input:focus{outline:none;border-color:var(--blue)}"
      +".sqv-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}"
      +".sqv-msg{color:var(--muted);font-size:13px;font-weight:700}"
      +".sqv-tablewrap{overflow:auto;border:2px solid var(--line);border-radius:12px;background:var(--card);max-height:52vh}"
      +".sqv-table{border-collapse:collapse;width:100%;font-size:13.5px}"
      +".sqv-table th,.sqv-table td{border:1px solid var(--line);padding:6px 11px;text-align:left;white-space:nowrap}"
      +".sqv-table th{background:var(--line2);position:sticky;top:0;font-weight:800;color:var(--ink)}"
      +".sqv-count{color:var(--muted);font-size:12px;font-weight:700;margin:6px 2px}"
      +".sqv-err{background:#ffecec;color:var(--red-d);border:1px solid #ffc9c9;border-radius:10px;padding:10px 13px;font-weight:700;font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;white-space:pre-wrap}"
      +".sqv-note{color:var(--muted);font-size:13px;padding:8px 2px}"
      +".sqv-null{color:var(--muted);font-style:italic}"
      +":root[data-theme='dark'] .sqv-col.pk{background:#3a3214;color:var(--gold)}"
      +":root[data-theme='dark'] .sqv-err{background:#3a1f22;color:#ff9b9b;border-color:#5a2a2e}";
    document.head.appendChild(st);
  }

  function resultToTable(results){
    if(!results||!results.length) return '<div class="sqv-note">Kein Tabellen-Ergebnis (z. B. nach CREATE/INSERT/UPDATE) – die Abfrage lief fehlerfrei. ✓</div>';
    return results.map(function(r){
      var th=r.columns.map(function(c){ return "<th>"+esc(c)+"</th>"; }).join("");
      var rows=r.values.map(function(row){ return "<tr>"+row.map(function(v){ return "<td>"+(v===null?'<span class="sqv-null">NULL</span>':esc(v))+"</td>"; }).join("")+"</tr>"; }).join("");
      return '<div class="sqv-tablewrap"><table class="sqv-table"><thead><tr>'+th+"</tr></thead><tbody>"+rows+"</tbody></table></div><div class=\"sqv-count\">"+r.values.length+" Zeile(n)</div>";
    }).join("");
  }
  function schemaHtml(db){
    var s=SqlEngine.schema(db); if(!s.length) return '<div class="sqv-note">Keine Tabellen in dieser Datenbank.</div>';
    return s.map(function(t){
      var cols=t.cols.map(function(c){ return '<span class="sqv-col'+(c.pk?" pk":"")+'" title="'+esc(c.type||"")+(c.pk?" · Primärschlüssel":"")+'">'+esc(c.name)+"</span>"; }).join("");
      return '<div class="sqv-schtab"><b>'+esc(t.name)+"</b> &nbsp;"+cols+"</div>";
    }).join("");
  }

  SqlEngine.ensureStyles = injectStyles;                                   // Styles laden (für eigenständige SQL-Editoren)
  SqlEngine.schemaHtml = function(db){ injectStyles(); return schemaHtml(db); };

  class SqlView {
    constructor(host, opts){
      opts=opts||{};
      injectStyles();
      this.host = typeof host==="string"?document.querySelector(host):host;
      this.dbText = opts.dbText||"";
      this.query = opts.query||"";
      this.readonly = !!opts.readonly;
      this.onQuery = opts.onQuery||null;
      this.autofill = opts.autofill !== false;   // Standard: leere Abfrage automatisch mit "SELECT * FROM …" vorbelegen
      this.schemaOpen = !!opts.schemaOpen;        // Schema-Klappbox standardmäßig geöffnet?
      this.onSchemaToggle = opts.onSchemaToggle||null;  // Callback(open) wenn Nutzer auf-/zuklappt
      this.autorun = !!opts.autorun;              // gespeicherte Abfrage nach DB-Laden automatisch ausführen
      this.db = null;
      this._build();
    }
    _build(){
      var ro=this.readonly?" readonly":"";
      this.host.innerHTML =
        '<div class="sqv">'
        + '<details class="sqv-schema"'+(this.schemaOpen?" open":"")+'><summary>🗂️ Datenbank-Schema</summary><div class="sqv-schbody">Lade…</div></details>'
        + '<textarea class="sqv-input" spellcheck="false" placeholder="SQL-Abfrage, z. B. SELECT * FROM …  (Strg+Enter führt aus)"'+ro+"></textarea>"
        + '<div class="sqv-bar"><button class="btn btn-primary btn-sm sqv-run">▶ Ausführen</button><span class="sqv-msg"></span></div>'
        + '<div class="sqv-result"></div>'
        + "</div>";
      this.$ = (sel)=> this.host.querySelector(sel);
      this.input=this.$(".sqv-input"); this.input.value=this.query;
      this.$(".sqv-run").onclick=()=> this.runQuery();
      this.input.addEventListener("keydown",(e)=>{ if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){ e.preventDefault(); this.runQuery(); } });
      this.details=this.$(".sqv-schema");
      if(this.details && this.onSchemaToggle) this.details.addEventListener("toggle",()=>{ this.onSchemaToggle(this.details.open); });
      this._init();
    }
    async _init(){
      var sb=this.$(".sqv-schbody"), msg=this.$(".sqv-msg");
      try{
        if(this.db){ try{ this.db.close(); }catch(e){} }
        this.db = await SqlEngine.run(this.dbText);
        if(sb) sb.innerHTML=schemaHtml(this.db);
        if(this.autofill && !this.getQuery().trim()){ var s=SqlEngine.schema(this.db); if(s.length) this.setQuery("SELECT * FROM "+s[0].name+";"); }
        if(msg) msg.textContent="";
        if(this.autorun && this.getQuery().trim()) this.runQuery();   // gespeicherte Abfrage direkt anzeigen
      }catch(e){
        if(sb) sb.textContent="Fehler beim Laden der Datenbank: "+(e.message||e);
        if(msg) msg.innerHTML='<span style="color:var(--red-d)">⚠ Datenbank konnte nicht geladen werden.</span>';
      }
    }
    getQuery(){ return this.input?this.input.value:this.query; }
    setQuery(q){ this.query=q||""; if(this.input) this.input.value=this.query; }
    async setDb(dbText){ this.dbText=dbText||""; this.query=""; if(this.input) this.input.value=""; var r=this.$(".sqv-result"); if(r) r.innerHTML=""; await this._init(); }
    runQuery(){
      var res=this.$(".sqv-result"), msg=this.$(".sqv-msg");
      if(!this.db){ if(msg) msg.textContent="⏳ Datenbank wird noch geladen…"; return null; }
      var q=(this.getQuery()||"").trim();
      if(!q){ res.innerHTML=""; msg.textContent="Bitte eine SQL-Abfrage eingeben."; return null; }
      try{
        var out=this.db.exec(q);
        res.innerHTML=resultToTable(out); msg.textContent="";
        if(/\b(create|drop|alter)\b/i.test(q)){ var sb=this.$(".sqv-schbody"); if(sb) sb.innerHTML=schemaHtml(this.db); }
        if(this.onQuery) this.onQuery(q,out);
        return out;
      }catch(e){ res.innerHTML='<div class="sqv-err">Fehler: '+esc(e.message||e)+"</div>"; msg.textContent=""; return null; }
    }
    destroy(){ try{ if(this.db) this.db.close(); }catch(e){} this.db=null; if(this.host) this.host.innerHTML=""; }
  }
  window.SqlView = SqlView;
})();
