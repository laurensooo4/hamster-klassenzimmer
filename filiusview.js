"use strict";
/* ============================================================================
   FiliusView — originalgetreuer Web-Nachbau der FILIUS-Oberfläche
   (Uni Siegen / lernsoftware-filius.de, GPL). Reine Neu-Implementierung fürs
   Web; nutzt die Original-Grafiken aus ./filius-gfx/ und die Logik aus
   window.FiliusEngine (filiusengine.js).

   Öffentliche API (wie zuvor, damit app.js unverändert bleibt):
     new FiliusView(hostEl|selector, {data, readonly, height, onChange, mode})
     .getData()  .setData(d)  .setReadonly(bool)  .destroy()
     FiliusView.ensureStyles()
   ============================================================================ */
(function(){
  var E = window.FiliusEngine;
  var GFX = "filius-gfx/";
  function hw(name){ return GFX+"hardware/"+name; }
  function ag(name){ return GFX+"allgemein/"+name; }
  function dg(name){ return GFX+"desktop/"+name; }

  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function uid(pre){ return (pre||"f")+Math.random().toString(36).slice(2,9); }
  function el(tag, cls, html){ var e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; }

  // Erlaubt einfaches HTML in der Webbrowser-Vorschau, entfernt Skripte/Events
  function escHtmlSafe(html){
    var d=document.createElement("div"); d.innerHTML=String(html||"");
    (function clean(x){ Array.prototype.slice.call(x.querySelectorAll("*")).forEach(function(n){
      if(/^(script|style|iframe|object|embed|link|meta|svg|math|base|template|form|button|input|textarea|select|frame|frameset|applet)$/i.test(n.tagName)){ n.remove(); return; }
      Array.prototype.slice.call(n.attributes).forEach(function(at){ var nm=(at.name||"").toLowerCase();
        if(/^on/i.test(nm) || nm==="style" || nm.indexOf("xlink")===0 || nm==="xmlns" || ((/(href|src|action)$/i.test(nm))&&/^\s*(javascript|data|vbscript):/i.test(at.value))) n.removeAttribute(at.name);
      }); }); })(d);
    return d.innerHTML;
  }

  /* ---- Hardware-Typen (Palette + Canvas) ---- */
  var TYPES = {
    rechner:  { label:"Rechner",            icon:"server.png",  host:true },
    notebook: { label:"Notebook",           icon:"laptop.png",  host:true },
    switch:   { label:"Switch",             icon:"switch.png" },
    gateway:  { label:"Heimrouter",         icon:"gateway.png", router:true, gateway:true },
    router:   { label:"Vermittlungsrechner",icon:"router.png",  router:true },
    text:     { label:"Textfeld",           icon:null, text:true }
  };
  function typeIcon(n){ if(n.type==="switch"&&n.cloud) return hw("cloud.png"); var t=TYPES[n.type]; return t&&t.icon?hw(t.icon):null; }
  function isHost(t){ return t==="notebook"||t==="rechner"; }
  function isRouter(t){ return t==="router"||t==="gateway"; }

  /* ---- Desktop-Anwendungsregistrierung (Reihenfolge wie config/Desktop_de_DE.txt) ---- */
  var APPS = [
    { key:"terminal",   name:"Befehlszeile",     icon:"icon_terminal.png" },
    { key:"imageviewer",name:"Bildbetrachter",   icon:"icon_imageviewer.png" },
    { key:"fileexplorer",name:"Datei-Explorer",  icon:"icon_filebrowser.png" },
    { key:"dns",        name:"DNS-Server",       icon:"icon_dns.png" },
    { key:"emailclient",name:"E-Mail-Programm",  icon:"icon_emailprogramm.png" },
    { key:"mailserver", name:"E-Mail-Server",    icon:"icon_emailserver.png" },
    { key:"echo",       name:"Echo-Server",      icon:"icon_serverbaustein.png" },
    { key:"client",     name:"Einfacher Client", icon:"icon_clientbaustein.png" },
    { key:"firewall",   name:"Firewall",         icon:"icon_firewall.png" },
    { key:"gnutella",   name:"Gnutella",         icon:"icon_peertopeer.png" },
    { key:"texteditor", name:"Text-Editor",      icon:"icon_texteditor.png" },
    { key:"webserver",  name:"Webserver",        icon:"icon_webserver.png" },
    { key:"webbrowser", name:"Webbrowser",       icon:"icon_browser.png" }
  ];
  function appByKey(k){ for(var i=0;i<APPS.length;i++) if(APPS[i].key===k) return APPS[i]; return null; }

  function normalizeNet(d){ d=d||{}; if(typeof d==="string"){ try{ d=JSON.parse(d); }catch(e){ d={}; } }
    return { nodes:(d.nodes||[]).map(function(n){ return n; }), links:(d.links||[]).slice() }; }

  /* ============================== Styles ================================== */
  function injectStyles(){
    if(document.getElementById("fv2-styles")) return;
    var s=el("style"); s.id="fv2-styles";
    s.textContent = [
".fv{display:flex;flex-direction:column;height:var(--fvH,560px);border:2px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card);position:relative;font-family:inherit}",
/* Toolbar */
".fv-tb{display:flex;align-items:center;gap:4px;padding:6px 8px;background:linear-gradient(#f7f9fc,#eef2f7);border-bottom:1px solid var(--line);flex-wrap:wrap}",
":root[data-theme='dark'] .fv-tb{background:linear-gradient(#232a36,#1c222c)}",
".fv-tbtn{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:5px 8px;font:inherit;font-weight:800;font-size:12.5px;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:5px;line-height:1}",
".fv-tbtn:hover{border-color:var(--blue);background:var(--line2)}",
".fv-tbtn.on{background:var(--blue);color:#fff;border-color:var(--blue)}",
".fv-tbtn img{width:18px;height:18px;display:block;pointer-events:none}",
".fv-tbsep{width:1px;align-self:stretch;background:var(--line);margin:2px 4px}",
".fv-modeseg{display:inline-flex;background:var(--line2);border-radius:9px;padding:3px;gap:2px}",
".fv-modeseg button{border:none;background:transparent;font:inherit;font-weight:800;font-size:12.5px;color:var(--muted);padding:5px 10px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}",
".fv-modeseg button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.15)}",
".fv-modeseg img{width:16px;height:16px}",
".fv-speed{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);font-weight:700}",
".fv-speed input{width:90px}",
".fv-spacer{flex:1}",
/* Main = sidebar + canvas */
".fv-main{flex:1;display:flex;min-height:0;position:relative}",
".fv-side{width:96px;flex:0 0 96px;overflow-y:auto;overflow-x:hidden;background:linear-gradient(#eef1f6,#e4e9f1);border-right:1px solid var(--line);padding:6px 0}",
":root[data-theme='dark'] .fv-side{background:linear-gradient(#242b37,#1b212b)}",
".fv-side.hide{display:none}",
".fv-palitem{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 4px;cursor:grab;user-select:none;border-radius:8px;margin:2px 5px}",
".fv-palitem:hover{background:rgba(28,140,246,.12)}",
".fv-palitem img{width:40px;height:34px;object-fit:contain;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.2))}",
".fv-palitem .cabimg{width:40px;height:24px}",
".fv-palitem span{font-size:10px;font-weight:800;color:var(--ink);text-align:center;line-height:1.1}",
/* Canvas */
".fv-cvwrap{flex:1;overflow:auto;position:relative;background:var(--bg)}",
".fv-cv{position:relative;width:2000px;height:1500px;background-repeat:repeat}",
".fv-cv.design{background-image:url('"+ag("entwurfshg.png")+"')}",
".fv-cv.sim{background-image:url('"+ag("simulationshg.png")+"')}",
".fv-svg{position:absolute;inset:0;width:2000px;height:1500px;pointer-events:none;overflow:visible}",
".fv-cable{fill:none;stroke:rgb(64,64,64);stroke-width:2}",
".fv-cable.wl{stroke:rgb(150,150,150);stroke-dasharray:8 6}",
".fv-cable.live{stroke:rgb(0,205,70);stroke-width:3}",
".fv-cable.sel{stroke:var(--blue);stroke-width:3}",
".fv-cablehit{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke;cursor:pointer}",
".fv-packet{fill:#12b0ff;stroke:#fff;stroke-width:2;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))}",
/* Node */
".fv-node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:1px;width:84px;cursor:pointer;user-select:none;padding:4px;border-radius:8px;will-change:left,top}",
".fv-node img{width:44px;height:38px;object-fit:contain;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.22))}",
".fv-node .lbl{font-size:11px;font-weight:800;color:var(--ink);text-align:center;line-height:1.15;max-width:96px;word-break:break-word}",
".fv-node .ip{font-size:9.5px;color:var(--muted);font-weight:700;line-height:1}",
".fv-node.sel{outline:1px dashed #222;background:rgba(205,235,255,.35)}",
":root[data-theme='dark'] .fv-node.sel{outline-color:#9cc7ff;background:rgba(60,110,180,.28)}",
".fv-node.text{width:auto}",
".fv-node.text .txt{background:#fff7e6;border:1px solid #ffcf76;border-radius:8px;padding:5px 9px;color:#6b5100;font-weight:700;font-size:12.5px;white-space:pre-wrap;max-width:240px;text-align:left}",
":root[data-theme='dark'] .fv-node.text .txt{background:#2a2410;color:#e7c980;border-color:#5a4a1a}",
".fv-node.pending img{animation:fv2pulse .8s infinite}",
"@keyframes fv2pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}",
/* Marquee */
".fv-marquee{position:absolute;border:1px dashed #2b6fd6;background:rgba(43,111,214,.12);pointer-events:none;z-index:5}",
/* Cable-tool cursor */
".fv-cursorimg{position:absolute;width:22px;height:22px;pointer-events:none;z-index:40;transform:translate(-2px,-2px)}",
/* Status */
".fv-status{font-size:11.5px;color:var(--muted);font-weight:700;padding:0 6px}",
/* Config panel (bottom) */
".fv-cfg{border-top:1px solid var(--line);background:linear-gradient(#eef1f6,#e6ebf2);flex:0 0 auto;transition:none}",
":root[data-theme='dark'] .fv-cfg{background:linear-gradient(#232a36,#1b212b)}",
".fv-cfg-bar{display:flex;align-items:center;gap:8px;height:20px;padding:1px 8px;cursor:pointer;font-size:11.5px;font-weight:800;color:var(--muted)}",
".fv-cfg-bar img{width:40px;height:11px}",
".fv-cfg-body{height:230px;overflow:auto;padding:10px 12px;display:none}",
".fv-cfg.max .fv-cfg-body{display:block}",
".fv-cfg-title{font-weight:900;font-size:14px;margin:0 0 8px;display:flex;align-items:center;gap:7px}",
".fv-cfg-title img{width:22px;height:20px}",
".fv-frow{display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap}",
".fv-frow label.cap{width:150px;flex:0 0 150px;text-align:right;font-size:12.5px;font-weight:700;color:var(--ink)}",
".fv-in{border:1px solid var(--line);border-radius:7px;padding:5px 8px;font:inherit;font-size:12.5px;background:var(--card);color:var(--ink);min-width:150px}",
".fv-in.bad{color:rgb(255,20,20)}",
".fv-in[disabled]{opacity:.55}",
".fv-chk{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--ink);cursor:pointer}",
".fv-cols{display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start}",
".fv-col{display:flex;flex-direction:column;gap:2px}",
".fv-btn{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:6px 11px;font:inherit;font-weight:800;font-size:12.5px;color:var(--ink);cursor:pointer}",
".fv-btn:hover{border-color:var(--blue);background:var(--line2)}",
".fv-btn.primary{background:var(--blue);color:#fff;border-color:var(--blue)}",
".fv-tabs{display:flex;gap:3px;border-bottom:1px solid var(--line);margin-bottom:10px;flex-wrap:wrap}",
".fv-tab{border:1px solid var(--line);border-bottom:none;background:var(--line2);border-radius:8px 8px 0 0;padding:5px 11px;font:inherit;font-weight:800;font-size:12px;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:5px}",
".fv-tab.on{background:var(--card);color:var(--ink)}",
".fv-tab img{width:13px;height:13px}",
".fv-tbl{width:100%;border-collapse:collapse;font-size:12px}",
".fv-tbl th{text-align:left;color:var(--muted);font-weight:800;padding:3px 6px;border-bottom:1px solid var(--line)}",
".fv-tbl td{padding:2px 4px;border-bottom:1px solid var(--line2)}",
".fv-tbl td input{width:100%;border:1px solid var(--line);border-radius:5px;padding:3px 5px;font:inherit;font-size:11.5px;background:var(--card);color:var(--ink)}",
".fv-tbl tr.auto td{color:var(--muted);font-style:normal;opacity:.7}",
".fv-hint{font-size:11.5px;color:var(--muted);font-weight:600}",
/* Context menu */
".fv-ctx{position:fixed;z-index:120;background:var(--card);border:1px solid var(--line);border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.28);padding:5px;min-width:170px}",
".fv-ctx button{display:block;width:100%;text-align:left;border:none;background:transparent;font:inherit;font-size:12.5px;color:var(--ink);padding:7px 10px;border-radius:6px;cursor:pointer}",
".fv-ctx button:hover{background:var(--blue);color:#fff}",
".fv-ctx .sep{height:1px;background:var(--line);margin:4px 2px}",
/* Modal dialog (config sub-dialogs) */
".fv-dlgbg{position:fixed;inset:0;background:rgba(24,34,50,.5);display:flex;align-items:center;justify-content:center;padding:16px;z-index:130}",
".fv-dlg{background:var(--card);color:var(--ink);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.35);max-width:760px;width:100%;max-height:92vh;overflow:auto;padding:20px}",
".fv-dlg h3{margin:0 0 12px;font-size:17px;display:flex;align-items:center;gap:8px}",
/* Desktop windows */
".fv-desk{position:absolute;width:640px;height:490px;background:var(--card);border:1px solid #333;border-radius:8px;box-shadow:0 16px 50px rgba(0,0,0,.4);z-index:60;overflow:hidden;display:flex;flex-direction:column}",
".fv-desk-tb{height:30px;flex:0 0 30px;background:#2f3a4a;color:#eef;display:flex;align-items:center;gap:8px;padding:0 8px;cursor:move;font-size:12.5px;font-weight:800}",
".fv-desk-tb img{width:18px;height:18px}",
".fv-desk-tb .x{margin-left:auto;cursor:pointer;font-size:16px;padding:0 6px;border-radius:5px}",
".fv-desk-tb .x:hover{background:#e0533a}",
".fv-desk-body{flex:1;position:relative;overflow:hidden;background:#3a5a80}",
".fv-desk-screen{position:absolute;inset:0}",
".fv-desk-bg{width:100%;height:100%;background:url('"+dg("hintergrundbild.png")+"') center/cover;position:absolute;inset:0}",
".fv-desk-apps{position:absolute;inset:0;display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px 2px;padding:10px 6px}",
".fv-dicon{width:118px;height:92px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;border-radius:8px}",
".fv-dicon:hover{background:rgba(255,255,255,.14)}",
".fv-dicon img{width:42px;height:42px;object-fit:contain}",
".fv-dicon span{color:#fff;font-size:11px;font-weight:700;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.7);line-height:1.05}",
".fv-taskbar{height:30px;flex:0 0 30px;background:rgb(180,180,180);display:flex;align-items:center;position:relative}",
".fv-taskbar .home{margin:0 auto;border:1px solid #888;background:#e8e8e8;border-radius:6px;padding:3px 14px;font:inherit;font-weight:800;font-size:12px;cursor:pointer;color:#222}",
".fv-taskbar .net{position:absolute;right:6px;width:44px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer}",
".fv-taskbar .net img{width:24px;height:16px}",
/* App window (card inside desktop) */
".fv-appwin{position:absolute;inset:0;background:var(--card);color:var(--ink);display:flex;flex-direction:column}",
".fv-appwin-tb{height:30px;flex:0 0 30px;background:rgb(64,64,64);color:rgb(225,225,225);display:flex;align-items:center;gap:8px;padding:0 8px;font-size:12.5px;font-weight:800}",
".fv-appwin-tb img{width:16px;height:16px}",
".fv-appwin-body{flex:1;overflow:auto;padding:8px}",
".fv-term{background:#000;color:#dedede;font-family:'Courier New',monospace;font-size:12px;height:100%;display:flex;flex-direction:column}",
".fv-term-out{flex:1;overflow:auto;white-space:pre-wrap;padding:6px 8px;line-height:1.35}",
".fv-term-in{display:flex;align-items:center;gap:4px;padding:2px 8px 6px}",
".fv-term-in span{color:#dedede;font-family:'Courier New',monospace;font-size:12px;white-space:pre}",
".fv-term-in input{flex:1;background:transparent;border:none;color:#dedede;font-family:'Courier New',monospace;font-size:12px;outline:none}",
".fv-modular{position:absolute;left:0;right:0;top:0;bottom:0;z-index:20}",
".fv-modular-veil{position:absolute;inset:0;background:rgba(0,0,0,.15)}",
".fv-modular-win{position:absolute;left:50%;transform:translateX(-50%);top:30px;background:var(--card);border:2px groove #999;min-width:300px;max-width:600px}",
".fv-modular-tt{height:30px;background:rgb(100,100,100);color:rgb(250,250,250);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12.5px}",
".fv-modular-bd{padding:10px}",
".fv-net-info{position:absolute;right:6px;bottom:36px;background:var(--card);border:2px groove #aaa;border-radius:4px;padding:8px;font-size:11.5px;z-index:30}",
".fv-net-info div{display:flex;gap:6px;margin-bottom:3px}",
".fv-net-info b{display:inline-block;width:92px;color:var(--muted)}",
/* generic small table used by apps */
".fv-atbl{width:100%;border-collapse:collapse;font-size:12px}",
".fv-atbl th{background:var(--line2);text-align:left;padding:4px 6px;font-weight:800}",
".fv-atbl td{border-bottom:1px solid var(--line2);padding:3px 6px}",
".fv-atbl tr.sel td{background:rgba(28,140,246,.18)}",
".fv-list{border:1px solid var(--line);border-radius:8px;overflow:auto}",
".fv-list .it{padding:6px 9px;border-bottom:1px solid var(--line2);cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:7px}",
".fv-list .it:hover{background:var(--line2)}",
".fv-list .it.sel{background:rgba(28,140,246,.18)}"
].join("");
    document.head.appendChild(s);
  }

  /* ============================== Constructor ============================= */
  function FiliusView(host, opts){
    opts=opts||{};
    injectStyles();
    this.host = typeof host==="string" ? document.querySelector(host) : host;
    this.data = normalizeNet(opts.data);
    this.readonly = !!opts.readonly;
    this.onChange = opts.onChange||null;
    this.height = opts.height||"560px";
    this.mode = (opts.mode==="sim")?"sim":"design";   // 'design' | 'sim' | 'doku'
    this.tool = "select";
    this.sel = [];            // ausgewählte Knoten-IDs
    this.selLink = null;
    this.cable = null;        // {from} während Kabelwerkzeug
    this.cfgNode = null;      // Knoten im unteren Konfig-Panel
    this.cfgTab = 0;
    this.cfgMax = false;
    this._els = {};           // nodeId -> DOM
    this._cableEls = {};      // linkId -> {path, hit}
    this._desks = {};         // hostId -> desktop-window state
    this._sim = { sat:{}, log:{}, no:0, t0:0, layers:null, arp:{} };
    this._raf = null;
    this._speed = (101-90)/90;   // passend zum Slider-Default 90 %
    this._build();
  }

  FiliusView.prototype.$ = function(s){ return this.host.querySelector(s); };
  FiliusView.prototype._node = function(id){ for(var i=0;i<this.data.nodes.length;i++) if(this.data.nodes[i].id===id) return this.data.nodes[i]; return null; };
  FiliusView.prototype._changed = function(){ if(this.onChange){ try{ this.onChange(this.data); }catch(e){} } };
  FiliusView.prototype._linksOf = function(id){ return this.data.links.filter(function(l){ return l.a===id||l.b===id; }); };
  FiliusView.prototype._freeCablePartner = function(){ return true; };

  /* ============================== Build UI =============================== */
  FiliusView.prototype._stopSim=function(){ if(this._anim){ clearInterval(this._anim); this._anim=null; } if(this._pingTimer){ clearInterval(this._pingTimer); this._pingTimer=null; } };
  FiliusView.prototype._build = function(){
    var self=this, ro=this.readonly;
    // vorherige globale Listener sauber entfernen (bei Re-Build via setReadonly), sonst Leak/Doppelverarbeitung
    try{ if(this._keyh) document.removeEventListener("keydown", this._keyh); }catch(e){}
    try{ if(this._docDown) document.removeEventListener("pointerdown", this._docDown, true); }catch(e){}
    this._removeCursorImg&&this._removeCursorImg();
    this.host.innerHTML="";
    var root=el("div","fv"); root.style.setProperty("--fvH", this.height);
    // --- Toolbar ---
    var tb=el("div","fv-tb");
    var seg=el("div","fv-modeseg");
    seg.innerHTML =
      '<button data-mode="design" class="'+(this.mode==="design"?"on":"")+'"><img src="'+ag("entwurfsmodus.png")+'">Entwurf</button>'+
      '<button data-mode="sim" class="'+(this.mode==="sim"?"on":"")+'"><img src="'+ag("aktionsmodus.png")+'">Simulation</button>'+
      '<button data-mode="doku" class="'+(this.mode==="doku"?"on":"")+'"><img src="'+ag("dokumodus.png")+'">Doku</button>';
    tb.appendChild(seg);
    tb.appendChild(el("div","fv-tbsep"));
    var speed=el("div","fv-speed",'🐢<input type="range" min="1" max="100" value="90" title="Simulationsgeschwindigkeit">🐇<b class="pct">90%</b>');
    tb.appendChild(speed);
    tb.appendChild(el("div","fv-spacer"));
    var status=el("div","fv-status"); tb.appendChild(status);
    root.appendChild(tb);
    // --- Main (sidebar + canvas) ---
    var main=el("div","fv-main");
    var side=el("div","fv-side"+((this.mode==="design"&&!ro)?"":" hide"));
    var pal=[["cable","Kabel","kabel.png"],["rechner","Rechner","server.png"],["notebook","Notebook","laptop.png"],
             ["switch","Switch","switch.png"],["gateway","Heimrouter","gateway.png"],["router","Vermittlungs&shy;rechner","router.png"]];
    pal.forEach(function(p){ var it=el("div","fv-palitem"); it.dataset.type=p[0];
      it.innerHTML='<img class="'+(p[0]==="cable"?"cabimg":"")+'" src="'+hw(p[2])+'"><span>'+p[1]+'</span>';
      side.appendChild(it); });
    main.appendChild(side);
    var cvwrap=el("div","fv-cvwrap");
    var cv=el("div","fv-cv "+(this.mode==="sim"?"sim":"design"));
    cv.innerHTML='<svg class="fv-svg" viewBox="0 0 2000 1500"></svg>';
    cvwrap.appendChild(cv); main.appendChild(cvwrap);
    root.appendChild(main);
    // --- Config panel (bottom) ---
    var cfg=el("div","fv-cfg");
    cfg.innerHTML='<div class="fv-cfg-bar"><img src="'+ag("maximieren.png")+'"><span class="ttl">Konfiguration</span></div><div class="fv-cfg-body"></div>';
    root.appendChild(cfg);

    this.host.appendChild(root);
    this.root=root; this.side=side; this.cvwrap=cvwrap; this.cv=cv; this.svg=cv.querySelector(".fv-svg");
    this.cfg=cfg; this.status=status;

    // Toolbar events
    seg.querySelectorAll("[data-mode]").forEach(function(b){ b.onclick=function(){ self.setMode(b.dataset.mode); }; });
    var sp=speed.querySelector("input"); sp.oninput=function(){ var v=+sp.value; speed.querySelector(".pct").textContent=v+"%"; self._speed=(101-v)/90; };
    // Palette drag / cable
    if(!ro) side.querySelectorAll(".fv-palitem").forEach(function(it){ it.addEventListener("pointerdown", function(e){ self._paletteDown(e, it.dataset.type); }); });
    // Canvas events
    cv.addEventListener("pointerdown", function(e){ if(e.target===cv||e.target===self.svg) self._canvasDown(e); });
    cvwrap.addEventListener("scroll", function(){ if(self._cursorImg){ /* keep */ } });
    // Config bar toggle
    cfg.querySelector(".fv-cfg-bar").onclick=function(){ self.cfgMax=!self.cfgMax; self._applyCfg(); };
    // Keyboard
    this._keyh=function(e){ self._onKey(e); };
    document.addEventListener("keydown", this._keyh);
    // close context menu on outside click
    this._docDown=function(e){ if(self._ctx && !self._ctx.contains(e.target)){ self._closeCtx(); } };
    document.addEventListener("pointerdown", this._docDown, true);

    this._applyCfg();
    this.render();
    this._setStatus(this.mode==="design"?"Ziehe Komponenten aus der Leiste auf die Fläche. Doppelklick = konfigurieren.":
                    this.mode==="sim"?"Simulation: Klick auf einen Rechner öffnet den Desktop.":"Dokumentationsmodus.");
  };

  FiliusView.prototype._setStatus=function(s){ if(this.status) this.status.textContent=s||""; };
  FiliusView.prototype._applyCfg=function(){
    this.cfg.classList.toggle("max", this.cfgMax);
    this.cfg.querySelector(".fv-cfg-bar img").src = this.cfgMax?ag("minimieren.png"):ag("maximieren.png");
  };

  /* ------------------------------ Modi ---------------------------------- */
  FiliusView.prototype.setMode=function(m){
    if(m===this.mode) return;
    this._closeAllDesks();
    this.mode=m; this.tool="select"; this.cable=null; this.sel=[]; this.selLink=null;
    this._removeCursorImg();
    this.root.querySelectorAll("[data-mode]").forEach(function(b){ b.classList.toggle("on", b.dataset.mode===m); });
    this.side.classList.toggle("hide", !(m==="design"&&!this.readonly));
    this.cv.classList.toggle("sim", m==="sim");
    this.cv.classList.toggle("design", m!=="sim");
    if(m==="sim"){ this._sim={ sat:{}, log:{}, no:0, t0:Date.now(), layers:null, arp:{} }; }
    // Konfig-Panel nur im Entwurf sinnvoll
    if(m!=="design"){ this.cfgNode=null; this.cfgMax=false; this._applyCfg(); this.cfg.querySelector(".fv-cfg-body").innerHTML=""; this.cfg.querySelector(".ttl").textContent="Konfiguration"; }
    this._setStatus(m==="design"?"Entwurfsmodus – Netz aufbauen und konfigurieren.":
                    m==="sim"?"Simulation – Klick auf Rechner: Desktop · Switch: SAT · Router: Weiterleitungstabelle.":"Dokumentationsmodus – Textfelder platzieren.");
    this.render();
  };

  /* --------------------------- Rendering -------------------------------- */
  FiliusView.prototype.render=function(){
    var self=this, data=this.data;
    // Links (SVG)
    var svg=this.svg, ids={};
    data.links.forEach(function(l){ ids[l.id]=1; var a=self._node(l.a), b=self._node(l.b); if(!a||!b) return;
      var d=self._cableD(a,b), rec=self._cableEls[l.id];
      if(!rec){ var hit=document.createElementNS("http://www.w3.org/2000/svg","path"); hit.setAttribute("class","fv-cablehit"); hit.setAttribute("data-link",l.id);
        var p=document.createElementNS("http://www.w3.org/2000/svg","path"); p.setAttribute("class","fv-cable");
        svg.appendChild(p); svg.appendChild(hit); rec={path:p,hit:hit}; self._cableEls[l.id]=rec;
        hit.addEventListener("pointerdown", function(e){ e.stopPropagation(); if(self.mode!=="design"||self.readonly) return;
          if(self.tool==="delete"){ self._removeLink(l.id); } else { self.selLink=l.id; self.sel=[]; self.render(); } });
        hit.addEventListener("contextmenu", function(e){ e.preventDefault(); if(self.mode!=="design"||self.readonly) return; self._linkMenu(e, l.id); });
      }
      rec.path.setAttribute("d", d); rec.hit.setAttribute("d", d);
      rec.path.setAttribute("class","fv-cable"+((a.wifi||b.wifi)?" wl":"")+(self.selLink===l.id?" sel":""));
    });
    // entfernte Links weg
    Object.keys(this._cableEls).forEach(function(id){ if(!ids[id]){ var r=self._cableEls[id]; r.path.remove(); r.hit.remove(); delete self._cableEls[id]; } });
    // Packet-Kreis sicherstellen
    if(!this._packet){ this._packet=document.createElementNS("http://www.w3.org/2000/svg","circle"); this._packet.setAttribute("class","fv-packet"); this._packet.setAttribute("r","7"); this._packet.style.display="none"; svg.appendChild(this._packet); }

    // Nodes (persistente DOM-Elemente)
    var nids={};
    data.nodes.forEach(function(n){ nids[n.id]=1; var e=self._els[n.id];
      if(!e){ e=el("div","fv-node"); e.dataset.id=n.id; self.cv.appendChild(e); self._els[n.id]=e; self._wireNode(e,n); }
      self._paintNode(e,n);
    });
    Object.keys(this._els).forEach(function(id){ if(!nids[id]){ self._els[id].remove(); delete self._els[id]; } });
  };

  FiliusView.prototype._paintNode=function(e,n){
    e.className="fv-node"+(n.type==="text"?" text":"")+(this.sel.indexOf(n.id)>=0?" sel":"")+(this.cable&&this.cable.from===n.id?" pending":"");
    e.style.left=n.x+"px"; e.style.top=n.y+"px";
    if(n.type==="text"){ e.innerHTML='<div class="txt">'+esc(n.text||"Notiz")+'</div>'; return; }
    var ic=typeIcon(n), showIp=isHost(n.type)&&n.ipAsName&&n.ip;
    var name = showIp ? n.ip : (n.name||TYPES[n.type].label);
    var ipLine = (isHost(n.type)&&!n.ipAsName&&n.ip) ? '<div class="ip">'+esc(n.ip)+'</div>' : '';
    e.innerHTML='<img src="'+ic+'" alt=""><div class="lbl">'+esc(name)+'</div>'+ipLine;
  };

  // Kabel-Pfad (leichte Kurve wie Filius; SYMBOL=gerade)
  FiliusView.prototype._cableD=function(a,b){
    var x1=a.x,y1=a.y,x2=b.x,y2=b.y;
    var cx=(x1+x2)/2, cy=(y1+y2)/2;
    var dx=x2-x1, dy=y2-y1;
    // dezente Krümmung
    cx = x1 + dx*0.5; cy = y1 + dy*0.25;
    return "M "+x1+" "+y1+" Q "+cx+" "+cy+" "+x2+" "+y2;
  };

  /* --------------------- Node-Interaktion / Drag ------------------------ */
  FiliusView.prototype._wireNode=function(e,n){
    var self=this;
    e.addEventListener("pointerdown", function(ev){ ev.stopPropagation();
      if(self.mode==="sim"){ self._simNodeClick(n); return; }
      if(self.mode==="doku"){ if(n.type==="text"){ self._selectOnly(n.id); self._startDrag(e,n,ev); } return; }
      if(self.readonly) return;
      if(self.tool==="cable"){ self._cableClick(n.id); return; }
      if(self.tool==="delete"){ self._removeNode(n.id); return; }
      // Auswahl
      if(self.sel.indexOf(n.id)<0){ if(!ev.shiftKey) self.sel=[]; self.sel.push(n.id); }
      self.selLink=null;
      self._openConfig(n.id, true);
      self._paintAllSel();
      self._startDrag(e,n,ev);
    });
    e.addEventListener("dblclick", function(ev){ ev.stopPropagation();
      if(self.mode==="sim"){ self._simNodeClick(n); return; }
      if(self.mode==="doku"){ if(n.type==="text"){ var t=prompt("Text bearbeiten:", n.text||""); if(t!=null){ n.text=t; self._changed(); var el2=self._els[n.id]; if(el2) self._paintNode(el2,n); } } return; }
      if(self.readonly) return; self._openConfig(n.id, true);
    });
    e.addEventListener("contextmenu", function(ev){ ev.preventDefault();
      if(self.readonly) return;
      if(self.mode==="design"){ if(self.cable){ self.cable=null; self._removeCursorImg(); self.render(); return; } self._nodeMenu(ev,n); }
      else if(self.mode==="sim"){ self._simNodeMenu(ev,n); }
      else if(self.mode==="doku" && n.type==="text"){ self._menu(ev.clientX, ev.clientY, [{label:"Löschen", fn:function(){ self._removeNode(n.id); }}]); }
    });
  };
  FiliusView.prototype._paintAllSel=function(){ var self=this; this.data.nodes.forEach(function(n){ var e=self._els[n.id]; if(e) e.classList.toggle("sel", self.sel.indexOf(n.id)>=0); }); };
  FiliusView.prototype._selectOnly=function(id){ this.sel=id?[id]:[]; this.selLink=null; this._paintAllSel(); };

  FiliusView.prototype._startDrag=function(e,n,ev){
    var self=this, rect=this.cv.getBoundingClientRect();
    var scale = rect.width/2000;  // Canvas ist 2000 breit, evtl. skaliert (nein: feste px) → scale=1
    var moving = (this.sel.indexOf(n.id)>=0 && this.sel.length>1) ? this.sel.slice() : [n.id];
    var start={}; moving.forEach(function(id){ var nd=self._node(id); start[id]={x:nd.x,y:nd.y}; });
    var ox = ev.clientX, oy = ev.clientY, movedFlag=false;
    e.setPointerCapture&&e.setPointerCapture(ev.pointerId);
    var pending=null;
    function mm(mv){ movedFlag=true;
      var dx=(mv.clientX-ox)/scale, dy=(mv.clientY-oy)/scale;
      pending={dx:dx,dy:dy};
      if(!self._raf) self._raf=requestAnimationFrame(apply);
    }
    function apply(){ self._raf=null; if(!pending) return; var dx=pending.dx, dy=pending.dy;
      moving.forEach(function(id){ var nd=self._node(id); if(!nd) return;
        var nx=Math.max(24,Math.min(1976, start[id].x+dx)), ny=Math.max(20,Math.min(1480, start[id].y+dy));
        nd.x=Math.round(nx); nd.y=Math.round(ny);
        var el2=self._els[id]; if(el2){ el2.style.left=nd.x+"px"; el2.style.top=nd.y+"px"; }
      });
      self._updateCablesFor(moving);
    }
    function mu(){ e.removeEventListener("pointermove",mm); e.removeEventListener("pointerup",mu);
      try{ e.releasePointerCapture(ev.pointerId); }catch(_){}
      if(movedFlag) self._changed();
    }
    e.addEventListener("pointermove",mm); e.addEventListener("pointerup",mu);
  };
  FiliusView.prototype._updateCablesFor=function(ids){ var self=this, set={}; ids.forEach(function(i){ set[i]=1; });
    this.data.links.forEach(function(l){ if(!set[l.a]&&!set[l.b]) return; var a=self._node(l.a), b=self._node(l.b); if(!a||!b) return;
      var rec=self._cableEls[l.id]; if(rec){ var d=self._cableD(a,b); rec.path.setAttribute("d",d); rec.hit.setAttribute("d",d); } });
  };

  /* --------------------------- Canvas / Marquee ------------------------- */
  FiliusView.prototype._canvasDown=function(ev){
    if(this.readonly) { this._selectOnly(null); this.selLink=null; this.render(); return; }
    if(this.mode==="doku"){ var rect=this.cv.getBoundingClientRect(); var x=ev.clientX-rect.left, y=ev.clientY-rect.top;
      var t=prompt("Text für das neue Textfeld:", "Notiz"); if(t==null) return;
      var nd={ id:uid("n"), type:"text", x:Math.round(x), y:Math.round(y), name:"", text:t }; this.data.nodes.push(nd); this._changed(); this.render(); return; }
    if(this.mode!=="design"){ return; }
    if(this.cable){ /* Klick ins Leere bricht Kabel ab */ this.cable=null; this._removeCursorImg(); this.render(); return; }
    // Auswahl aufheben + Marquee starten
    this.sel=[]; this.selLink=null; this._paintAllSel(); this.render();
    this._closeConfig();
    var self=this, rect=this.cv.getBoundingClientRect();
    var sx=ev.clientX-rect.left, sy=ev.clientY-rect.top;
    var mq=el("div","fv-marquee"); this.cv.appendChild(mq);
    function mm(mv){ var x=mv.clientX-rect.left, y=mv.clientY-rect.top;
      var l=Math.min(sx,x), t=Math.min(sy,y), w=Math.abs(x-sx), h=Math.abs(y-sy);
      mq.style.left=l+"px"; mq.style.top=t+"px"; mq.style.width=w+"px"; mq.style.height=h+"px"; }
    function mu(mv){ document.removeEventListener("pointermove",mm); document.removeEventListener("pointerup",mu);
      var x=mv.clientX-rect.left, y=mv.clientY-rect.top; var l=Math.min(sx,x), t=Math.min(sy,y), r=Math.max(sx,x), bt=Math.max(sy,y);
      mq.remove();
      if(Math.abs(r-l)<4&&Math.abs(bt-t)<4) return;
      self.sel=[]; self.data.nodes.forEach(function(n){ if(n.x>=l&&n.x<=r&&n.y>=t&&n.y<=bt) self.sel.push(n.id); });
      self._paintAllSel();
    }
    document.addEventListener("pointermove",mm); document.addEventListener("pointerup",mu);
  };

  /* ----------------------------- Palette -------------------------------- */
  FiliusView.prototype._paletteDown=function(ev, type){
    ev.preventDefault();
    var self=this;
    if(type==="cable"){ this.tool=(this.tool==="cable")?"select":"cable"; this.cable=null; this._removeCursorImg();
      if(this.tool==="cable"){ this._setStatus("Kabel: erst die eine, dann die andere Komponente anklicken (ESC bricht ab)."); this._showCursorImg(ag("ziel1.png")); }
      else this._setStatus(""); return; }
    // Drag-Ghost
    var ghost=el("div"); ghost.style.cssText="position:fixed;z-index:200;pointer-events:none;opacity:.85;transform:translate(-50%,-50%)";
    ghost.innerHTML='<img src="'+hw(TYPES[type].icon)+'" style="width:44px;height:38px">';
    document.body.appendChild(ghost);
    function mm(mv){ ghost.style.left=mv.clientX+"px"; ghost.style.top=mv.clientY+"px"; }
    mm(ev);
    function mu(mv){ document.removeEventListener("pointermove",mm); document.removeEventListener("pointerup",mu); ghost.remove();
      var rect=self.cv.getBoundingClientRect();
      if(mv.clientX>=rect.left && mv.clientX<=rect.right && mv.clientY>=rect.top && mv.clientY<=rect.bottom){
        var x=mv.clientX-rect.left, y=mv.clientY-rect.top; self._addNode(type, x, y);
      }
    }
    document.addEventListener("pointermove",mm); document.addEventListener("pointerup",mu);
  };

  FiliusView.prototype._addNode=function(type, x, y){
    var n={ id:uid("n"), type:type, x:Math.round(Math.max(24,Math.min(1976,x))), y:Math.round(Math.max(20,Math.min(1480,y))), name:this._defaultName(type) };
    if(TYPES[type].host){ n.ip=""; n.mask="255.255.255.0"; n.gateway=""; n.dns=""; n.useDhcp=false; n.ipAsName=false; n.apps={}; }
    if(TYPES[type].router){ n.ifs={}; n.autoRoute=true; n.routes=[]; if(type==="gateway"){ n.autoRoute=false; n.nat=true; n.portForward=[]; } }
    if(type==="text"){ n.text="Notiz"; n.name=""; }
    // Schnittstellen entstehen dynamisch pro Kabel (eine NIC je Verbindung) – kein fester Anschluss-Zähler nötig.
    this.data.nodes.push(n);
    this.sel=[n.id]; this.selLink=null;
    this._changed(); this.render(); this._paintAllSel();
    if(type!=="text") this._openConfig(n.id, true); else this._openConfig(n.id,true);
  };
  FiliusView.prototype._defaultName=function(type){
    var pre = type==="notebook"?"Notebook":type==="rechner"?"Rechner":type==="switch"?"Switch":type==="gateway"?"Heimrouter":type==="router"?"Vermittlungsrechner":"Text";
    var used={}; this.data.nodes.forEach(function(n){ used[String(n.name||"")]=1; });
    var k=1; while(used[pre+" "+k]) k++; return pre+" "+k;
  };

  /* ----------------------------- Kabel ---------------------------------- */
  FiliusView.prototype._cableClick=function(id){
    if(!this.cable){ this.cable={from:id}; this._showCursorImg(ag("ziel2.png")); this._setStatus("Kabel: jetzt die zweite Komponente anklicken."); this.render(); return; }
    if(this.cable.from===id){ this.cable=null; this._showCursorImg(ag("ziel1.png")); this.render(); return; }
    var a=this.cable.from, b=id; this.cable=null; this._showCursorImg(ag("ziel1.png"));
    this._addLink(a,b);
  };
  FiliusView.prototype._addLink=function(a,b){
    if(a===b) return;
    var na=this._node(a), nb=this._node(b); if(!na||!nb) return;
    if(na.type==="text"||nb.type==="text"){ this._setStatus("Textfelder lassen sich nicht verkabeln."); return; }
    if(this.data.links.some(function(l){ return (l.a===a&&l.b===b)||(l.a===b&&l.b===a); })){ this._setStatus("Diese beiden sind bereits verbunden."); return; }
    this.data.links.push({ id:uid("l"), a:a, b:b });
    this._changed(); this.render(); this._setStatus("Kabel: nächste Verbindung ziehen oder ESC.");
  };
  FiliusView.prototype._removeLink=function(id){ this.data.links=this.data.links.filter(function(l){ return l.id!==id; }); if(this.selLink===id) this.selLink=null; this._changed(); this.render(); };

  FiliusView.prototype._showCursorImg=function(src){
    this._removeCursorImg();
    var img=el("img","fv-cursorimg"); img.src=src; this.cv.appendChild(img); this._cursorImg=img;
    var self=this, rect=this.cv.getBoundingClientRect();
    this._cursorMove=function(mv){ if(mv.clientX<rect.left||mv.clientX>rect.right||mv.clientY<rect.top||mv.clientY>rect.bottom){ img.style.display="none"; return; }
      img.style.display=""; img.style.left=(mv.clientX-rect.left)+"px"; img.style.top=(mv.clientY-rect.top)+"px"; };
    document.addEventListener("pointermove", this._cursorMove);
  };
  FiliusView.prototype._removeCursorImg=function(){ if(this._cursorImg){ this._cursorImg.remove(); this._cursorImg=null; } if(this._cursorMove){ document.removeEventListener("pointermove", this._cursorMove); this._cursorMove=null; } };

  /* --------------------------- Löschen / Keys --------------------------- */
  FiliusView.prototype._removeNode=function(id){
    this.data.nodes=this.data.nodes.filter(function(n){ return n.id!==id; });
    this.data.links=this.data.links.filter(function(l){ return l.a!==id&&l.b!==id; });
    this.sel=this.sel.filter(function(x){ return x!==id; });
    if(this.cfgNode===id) this._closeConfig();
    this._changed(); this.render();
  };
  FiliusView.prototype._deleteSelected=function(){
    var self=this;
    if(this.selLink){ this._removeLink(this.selLink); return; }
    if(this.sel.length){ var ids=this.sel.slice(); ids.forEach(function(id){ self.data.nodes=self.data.nodes.filter(function(n){ return n.id!==id; }); self.data.links=self.data.links.filter(function(l){ return l.a!==id&&l.b!==id; }); });
      this.sel=[]; this._closeConfig(); this._changed(); this.render(); }
  };
  FiliusView.prototype._onKey=function(e){
    if(this.readonly) return;
    if(e.key==="Escape"){ if(this.cable||this.tool==="cable"){ this.cable=null; this.tool="select"; this._removeCursorImg(); this._setStatus(""); this.render(); } return; }
    if((e.key==="Delete"||e.key==="Backspace") && this.mode==="design"){
      if(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if(this.sel.length||this.selLink){ e.preventDefault(); this._deleteSelected(); }
    }
  };

  /* --------------------------- Kontextmenüs ----------------------------- */
  FiliusView.prototype._closeCtx=function(){ if(this._ctx){ this._ctx.remove(); this._ctx=null; } };
  FiliusView.prototype._menu=function(x,y,items){
    this._closeCtx(); var m=el("div","fv-ctx"); var self=this;
    items.forEach(function(it){ if(it==="sep"){ m.appendChild(el("div","sep")); return; } var b=el("button",null,esc(it.label)); b.onclick=function(){ self._closeCtx(); it.fn(); }; m.appendChild(b); });
    document.body.appendChild(m); this._ctx=m;
    var w=m.offsetWidth, h=m.offsetHeight; m.style.left=Math.min(x, innerWidth-w-6)+"px"; m.style.top=Math.min(y, innerHeight-h-6)+"px";
  };
  FiliusView.prototype._nodeMenu=function(ev,n){
    var self=this, items=[{label:"Konfigurieren", fn:function(){ self._openConfig(n.id,true); }}];
    items.push({label:(isHost(n.type)?"Verbindung entfernen":"Verbindungen entfernen"), fn:function(){ self.data.links=self.data.links.filter(function(l){ return l.a!==n.id&&l.b!==n.id; }); self._changed(); self.render(); }});
    items.push("sep");
    items.push({label:"Löschen", fn:function(){ self._removeNode(n.id); }});
    this._menu(ev.clientX, ev.clientY, items);
  };
  FiliusView.prototype._linkMenu=function(ev,id){ var self=this; this._menu(ev.clientX, ev.clientY, [{label:"Verbindung entfernen", fn:function(){ self._removeLink(id); }}]); };

  /* ======================= Konfig-Panel (unten) ========================= */
  FiliusView.prototype._closeConfig=function(){ this.cfgNode=null; this.cfgMax=false; this._applyCfg(); this.cfg.querySelector(".fv-cfg-body").innerHTML=""; this.cfg.querySelector(".ttl").textContent="Konfiguration"; };
  FiliusView.prototype._openConfig=function(id, forceMax){
    if(this.mode!=="design"){ return; }
    var n=this._node(id); if(!n){ this._closeConfig(); return; }
    this.cfgNode=id; if(forceMax) this.cfgMax=true;
    this._applyCfg(); this._renderConfig();
  };
  FiliusView.prototype._cfgBody=function(){ return this.cfg.querySelector(".fv-cfg-body"); };
  FiliusView.prototype._renderConfig=function(){
    var n=this._node(this.cfgNode); if(!n){ this._closeConfig(); return; }
    var t=TYPES[n.type]; this.cfg.querySelector(".ttl").textContent=(t?t.label:"Komponente")+" konfigurieren";
    if(n.type==="text") return this._cfgText(n);
    if(n.type==="switch") return this._cfgSwitch(n);
    if(isRouter(n.type)) return this._cfgRouter(n);
    return this._cfgHost(n);
  };
  FiliusView.prototype._afterCommit=function(n){ this._changed(); var e=this._els[n.id]; if(e) this._paintNode(e,n); };

  // Validierungs-Helfer (rote Schrift bei ungültig)
  function chk(input, ok){ if(!input) return; input.classList.toggle("bad", !ok); }

  /* ---- Textfeld ---- */
  FiliusView.prototype._cfgText=function(n){
    var self=this, b=this._cfgBody();
    b.innerHTML='<div class="fv-cfg-title"><span>📝</span>Textfeld</div>'
      +'<textarea class="fv-in" id="cText" style="width:100%;min-height:120px">'+esc(n.text||"")+'</textarea>';
    var ta=b.querySelector("#cText");
    function commit(){ n.text=ta.value; self._afterCommit(n); }
    ta.addEventListener("blur",commit); ta.addEventListener("input",function(){ n.text=ta.value; var e=self._els[n.id]; if(e) self._paintNode(e,n); });
  };

  /* ---- Switch ---- */
  FiliusView.prototype._cfgSwitch=function(n){
    var self=this, b=this._cfgBody();
    b.innerHTML='<div class="fv-cfg-title"><img src="'+hw("switch.png")+'">Switch</div>'
      +'<div class="fv-frow"><label class="cap">Name</label><input class="fv-in" id="cN" value="'+esc(n.name||"")+'"></div>'
      +'<div class="fv-frow"><label class="cap">SSID (WLAN)</label><input class="fv-in" id="cSsid" placeholder="optional" value="'+esc(n.ssid||"")+'"></div>'
      +'<div class="fv-frow"><label class="cap"></label><label class="fv-chk"><input type="checkbox" id="cCloud" '+(n.cloud?"checked":"")+'> als Wolke darstellen</label></div>'
      +'<div class="fv-frow"><label class="cap">SAT-Gültigkeit (Sek.)</label><input class="fv-in" id="cRet" style="min-width:90px" value="'+esc(n.retention||300)+'"></div>'
      +'<div class="fv-hint">Ein Switch verbindet Geräte in einem Netz und lernt die MAC-Adressen automatisch.</div>';
    function commit(){ n.name=b.querySelector("#cN").value.trim()||n.name; n.ssid=b.querySelector("#cSsid").value.trim();
      n.cloud=b.querySelector("#cCloud").checked; var r=parseInt(b.querySelector("#cRet").value,10); if(r>0) n.retention=r; self._afterCommit(n); }
    ["#cN","#cSsid","#cRet"].forEach(function(s){ var i=b.querySelector(s); i.addEventListener("blur",commit); i.addEventListener("keydown",function(e){ if(e.key==="Enter") commit(); }); });
    b.querySelector("#cCloud").addEventListener("change",commit);
  };

  /* ---- Host (Rechner/Notebook) ---- */
  FiliusView.prototype._cfgHost=function(n){
    var self=this, b=this._cfgBody(); n.apps=n.apps||{};
    var mac=E.macFor(n.id);
    b.innerHTML='<div class="fv-cfg-title"><img src="'+hw(TYPES[n.type].icon)+'">'+esc(TYPES[n.type].label)+'</div>'
      +'<div class="fv-cols">'
        +'<div class="fv-col">'
          +'<div class="fv-frow"><label class="cap">Name</label><input class="fv-in" id="cN" value="'+esc(n.name||"")+'"></div>'
          +'<div class="fv-frow"><label class="cap">MAC-Adresse</label><input class="fv-in" value="'+esc(mac)+'" disabled></div>'
          +'<div class="fv-frow"><label class="cap">IP-Adresse</label><input class="fv-in" id="cIp" placeholder="192.168.0.10" value="'+esc(n.ip||"")+'"></div>'
          +'<div class="fv-frow"><label class="cap">Netzmaske</label><input class="fv-in" id="cMask" value="'+esc(n.mask||"255.255.255.0")+'"></div>'
          +'<div class="fv-frow"><label class="cap">Gateway</label><input class="fv-in" id="cGw" placeholder="optional" value="'+esc(n.gateway||"")+'"></div>'
          +'<div class="fv-frow"><label class="cap">DNS-Server</label><input class="fv-in" id="cDns" placeholder="optional" value="'+esc(n.dns||"")+'"></div>'
        +'</div>'
        +'<div class="fv-col">'
          +'<label class="fv-chk"><input type="checkbox" id="cIpName" '+(n.ipAsName?"checked":"")+'> IP-Adresse als Name verwenden</label>'
          +'<label class="fv-chk"><input type="checkbox" id="cDhcp" '+(n.useDhcp?"checked":"")+'> Konfiguration per DHCP beziehen</label>'
          +'<div style="height:6px"></div>'
          +'<button class="fv-btn" id="cDhcpSrv">DHCP-Server einrichten…</button>'
          +'<div class="fv-hint" style="margin-top:8px;max-width:230px">Programme (Webserver, DNS, E-Mail …) werden im <b>Simulationsmodus</b> auf dem <b>Desktop</b> über „Software-Installation" installiert und dort konfiguriert.</div>'
        +'</div>'
      +'</div>';
    function setDis(){ var d=b.querySelector("#cDhcp").checked; ["#cIp","#cMask","#cGw","#cDns"].forEach(function(s){ b.querySelector(s).disabled=d; }); b.querySelector("#cDhcpSrv").disabled=d; }
    function commit(){
      if(!b.querySelector("#cIpName").checked) n.name=b.querySelector("#cN").value.trim()||n.name;
      n.ip=b.querySelector("#cIp").value.trim(); n.mask=b.querySelector("#cMask").value.trim()||"255.255.255.0";
      n.gateway=b.querySelector("#cGw").value.trim(); n.dns=b.querySelector("#cDns").value.trim();
      n.useDhcp=b.querySelector("#cDhcp").checked; n.ipAsName=b.querySelector("#cIpName").checked;
      if(n.ipAsName && n.ip) n.name=n.ip;
      chk(b.querySelector("#cIp"), !n.ip||E.validIp(n.ip)); chk(b.querySelector("#cMask"), E.parseMask(n.mask)!=null);
      chk(b.querySelector("#cGw"), !n.gateway||E.validIp(n.gateway)); chk(b.querySelector("#cDns"), !n.dns||E.validIp(n.dns));
      b.querySelector("#cN").disabled=n.ipAsName;
      self._afterCommit(n);
    }
    ["#cN","#cIp","#cMask","#cGw","#cDns"].forEach(function(s){ var i=b.querySelector(s); i.addEventListener("blur",commit); i.addEventListener("keydown",function(e){ if(e.key==="Enter") commit(); }); i.addEventListener("input",function(){ if(s==="#cIp"||s==="#cMask"||s==="#cGw"||s==="#cDns") chk(i, !i.value.trim()||(s==="#cMask"?E.parseMask(i.value.trim())!=null:E.validIp(i.value.trim()))); }); });
    b.querySelector("#cIpName").addEventListener("change",commit);
    b.querySelector("#cDhcp").addEventListener("change",function(){ setDis(); commit(); });
    b.querySelector("#cDhcpSrv").onclick=function(){ self._dhcpDialog(n); };
    b.querySelector("#cN").disabled=n.ipAsName; setDis();
  };

  /* ---- DHCP-Server-Dialog ---- */
  FiliusView.prototype._dhcpDialog=function(n){
    var self=this;
    var body='<h3>📡 DHCP-Server einrichten – '+esc(n.name||"Rechner")+'</h3>'
      +'<div class="fv-frow"><label class="cap">Adress-Untergrenze</label><input class="fv-in" id="dFrom" placeholder="192.168.0.100" value="'+esc(n.dhcpFrom||"")+'"></div>'
      +'<div class="fv-frow"><label class="cap">Adress-Obergrenze</label><input class="fv-in" id="dTo" placeholder="192.168.0.200" value="'+esc(n.dhcpTo||"")+'"></div>'
      +'<div class="fv-frow"><label class="cap">Netzmaske</label><input class="fv-in" value="'+esc(n.mask||"255.255.255.0")+'" disabled></div>'
      +'<div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:8px 0">'
        +'<div class="fv-frow"><label class="cap">Gateway</label><input class="fv-in" id="dGw" placeholder="optional" value="'+esc(n.dhcpGw||"")+'"></div>'
        +'<div class="fv-frow"><label class="cap">DNS-Server</label><input class="fv-in" id="dDns" placeholder="optional" value="'+esc(n.dhcpDns||"")+'"></div>'
        +'<div class="fv-hint">Leer lassen = eigene Einstellungen des Rechners weitergeben.</div>'
      +'</div>'
      +'<label class="fv-chk"><input type="checkbox" id="dOn" '+((n.apps&&n.apps.dhcp)?"checked":"")+'> DHCP aktivieren</label>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="fv-btn" id="dX">Schließen</button><button class="fv-btn primary" id="dOk">OK</button></div>';
    this._dialog(body, function(bg,close){
      bg.querySelector("#dX").onclick=close;
      bg.querySelector("#dOk").onclick=function(){
        n.dhcpFrom=bg.querySelector("#dFrom").value.trim(); n.dhcpTo=bg.querySelector("#dTo").value.trim();
        n.dhcpGw=bg.querySelector("#dGw").value.trim(); n.dhcpDns=bg.querySelector("#dDns").value.trim();
        n.apps=n.apps||{}; n.apps.dhcp=bg.querySelector("#dOn").checked;
        self._afterCommit(n); close();
      };
    });
  };

  /* ---- Router / Heimrouter ---- */
  FiliusView.prototype._cfgRouter=function(n){
    var self=this, b=this._cfgBody(); n.ifs=n.ifs||{}; if(n.autoRoute===undefined) n.autoRoute=(n.type!=="gateway");
    var gw = n.type==="gateway";
    var myLinks=this._linksOf(n.id);
    if(this.cfgTab==null) this.cfgTab=0;
    var tabs=[{k:"gen",label:"Allgemein",img:null}];
    myLinks.forEach(function(l,i){ var other=self._node(l.a===n.id?l.b:l.a); var cfg=n.ifs[l.id]||{};
      var okc=cfg.ip&&E.validIp(cfg.ip); tabs.push({k:"if:"+l.id, label:(cfg.ip||("Anschluss "+(i+1))), img:okc?ag("conn_ok.png"):ag("conn_fail.png")}); });
    if(!gw) tabs.push({k:"fwt",label:"Weiterleitungstabelle"});
    if(gw) tabs.push({k:"pf",label:"Portfreigaben"});
    var cur=this.cfgTab; if(cur>=tabs.length) cur=0;
    var html='<div class="fv-cfg-title"><img src="'+hw(TYPES[n.type].icon)+'">'+esc(TYPES[n.type].label)+'</div><div class="fv-tabs">';
    tabs.forEach(function(t,i){ html+='<button class="fv-tab'+(i===cur?" on":"")+'" data-ti="'+i+'">'+(t.img?'<img src="'+t.img+'">':"")+esc(t.label)+'</button>'; });
    html+='</div><div id="cTabBody"></div>'; b.innerHTML=html;
    b.querySelectorAll("[data-ti]").forEach(function(bt){ bt.onclick=function(){ self.cfgTab=+bt.dataset.ti; self._cfgRouter(n); }; });
    var body=b.querySelector("#cTabBody"), tk=tabs[cur].k;
    if(tk==="gen") this._cfgRouterGen(n, body, gw);
    else if(tk.indexOf("if:")===0) this._cfgRouterIf(n, body, tk.slice(3));
    else if(tk==="fwt") this._cfgRouterFwt(n, body);
    else if(tk==="pf") this._cfgGatewayPf(n, body);
  };
  FiliusView.prototype._cfgRouterGen=function(n, body, gw){
    var self=this;
    body.innerHTML='<div class="fv-frow"><label class="cap">Name</label><input class="fv-in" id="rN" value="'+esc(n.name||"")+'"></div>'
      +(gw?'<div class="fv-frow"><label class="cap">Gateway (Uplink)</label><input class="fv-in" id="rGw" placeholder="z. B. 42.0.0.1" value="'+esc(n.gateway||"")+'"></div>'
           :'<div class="fv-frow"><label class="cap">Standardgateway</label><input class="fv-in" id="rGw" placeholder="optional" value="'+esc(n.gateway||"")+'"></div>')
      +(gw?'<div class="fv-frow"><label class="cap"></label><label class="fv-chk"><input type="checkbox" id="rNat" '+(n.nat!==false?"checked":"")+'> NAT aktivieren (Heimrouter maskiert das lokale Netz)</label></div>'
           :'<div class="fv-frow"><label class="cap"></label><label class="fv-chk"><input type="checkbox" id="rRip" '+(n.autoRoute!==false?"checked":"")+'> Automatisches Routing (RIP)</label></div>')
      +'<div class="fv-frow"><label class="cap"></label><button class="fv-btn" id="rFw">Firewall einrichten…</button></div>'
      +'<div class="fv-hint">'+(gw?'Der Heimrouter verbindet ein lokales Netz (LAN) mit dem Internet (WAN) und übersetzt die Adressen (NAT).':'Der Vermittlungsrechner verbindet mehrere Netze. Pro Kabel erscheint oben ein Schnittstellen-Reiter mit eigener IP.')+'</div>';
    function commit(){ n.name=body.querySelector("#rN").value.trim()||n.name; n.gateway=body.querySelector("#rGw").value.trim();
      if(gw){ n.nat=body.querySelector("#rNat").checked; } else { n.autoRoute=body.querySelector("#rRip").checked; }
      self._afterCommit(n); }
    ["#rN","#rGw"].forEach(function(s){ var i=body.querySelector(s); i.addEventListener("blur",commit); i.addEventListener("keydown",function(e){ if(e.key==="Enter") commit(); }); });
    var rc=body.querySelector("#rRip")||body.querySelector("#rNat"); if(rc) rc.addEventListener("change",commit);
    body.querySelector("#rFw").onclick=function(){ self._firewallDialog(n); };
  };
  FiliusView.prototype._cfgRouterIf=function(n, body, linkId){
    var self=this, l=this.data.links.filter(function(x){ return x.id===linkId; })[0]; if(!l){ body.innerHTML='<div class="fv-hint">Schnittstelle nicht mehr vorhanden.</div>'; return; }
    var other=this._node(l.a===n.id?l.b:l.a); var cfg=n.ifs[linkId]||{}; var mac=E.macFor(n.id+":"+linkId);
    body.innerHTML='<div class="fv-hint" style="margin-bottom:8px">Verbunden mit: <b>'+esc(other?(other.name||TYPES[other.type].label):"—")+'</b></div>'
      +'<div class="fv-frow"><label class="cap">IP-Adresse</label><input class="fv-in" id="ifIp" placeholder="192.168.0.1" value="'+esc(cfg.ip||"")+'"></div>'
      +'<div class="fv-frow"><label class="cap">Netzmaske</label><input class="fv-in" id="ifMask" value="'+esc(cfg.mask||"255.255.255.0")+'"></div>'
      +'<div class="fv-frow"><label class="cap">MAC-Adresse</label><input class="fv-in" value="'+esc(mac)+'" disabled></div>';
    function commit(){ var ip=body.querySelector("#ifIp").value.trim(), mk=body.querySelector("#ifMask").value.trim()||"255.255.255.0";
      chk(body.querySelector("#ifIp"), !ip||E.validIp(ip)); chk(body.querySelector("#ifMask"), E.parseMask(mk)!=null);
      if(ip) n.ifs[linkId]={ip:ip, mask:mk}; else delete n.ifs[linkId];
      self._afterCommit(n); self._cfgRouter(n); }
    ["#ifIp","#ifMask"].forEach(function(s){ var i=body.querySelector(s); i.addEventListener("blur",commit); i.addEventListener("keydown",function(e){ if(e.key==="Enter") commit(); }); });
  };
  FiliusView.prototype._cfgRouterFwt=function(n, body){
    var self=this; n.routes=n.routes||[];
    var A=E.analyze(this.data); var autoRows=E.forwardingTable(A, n.id);
    var showAll = this._fwtAll!==false;
    var rows='';
    if(showAll) autoRows.forEach(function(r){ if(r.kind==="direkt"||r.kind==="lokal"||r.kind==="auto"||r.kind==="default") rows+='<tr class="auto"><td>'+esc(r.ziel)+'</td><td>'+esc(r.maske)+'</td><td>'+esc(r.gateway)+'</td><td>'+esc(r.iface)+'</td><td></td></tr>'; });
    n.routes.forEach(function(ro,i){ rows+='<tr><td><input data-r="'+i+'" data-f="dest" value="'+esc(ro.dest||"")+'"></td><td><input data-r="'+i+'" data-f="mask" value="'+esc(ro.mask||"")+'"></td><td><input data-r="'+i+'" data-f="nextHop" value="'+esc(ro.nextHop||"")+'"></td><td><input value="—" disabled></td><td><button class="fv-btn" data-del="'+i+'">✕</button></td></tr>'; });
    body.innerHTML='<label class="fv-chk" style="margin-bottom:6px"><input type="checkbox" id="fwtAll" '+(showAll?"checked":"")+'> Alle Einträge anzeigen (inkl. automatischer)</label>'
      +'<table class="fv-tbl"><thead><tr><th>Ziel</th><th>Netzmaske</th><th>Nächstes Gateway</th><th>Schnittstelle</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" class="fv-hint">Keine Einträge.</td></tr>')+'</tbody></table>'
      +'<div style="margin-top:8px"><button class="fv-btn" id="fwtAdd">+ Neue Zeile</button></div>';
    body.querySelector("#fwtAll").onchange=function(){ self._fwtAll=this.checked; self._cfgRouterFwt(n, body); };
    body.querySelector("#fwtAdd").onclick=function(){ n.routes.push({dest:"",mask:"255.255.255.0",nextHop:""}); self._afterCommit(n); self._cfgRouterFwt(n, body); };
    body.querySelectorAll("[data-del]").forEach(function(bt){ bt.onclick=function(){ n.routes.splice(+bt.dataset.del,1); self._afterCommit(n); self._cfgRouterFwt(n,body); }; });
    body.querySelectorAll("input[data-r]").forEach(function(inp){ inp.addEventListener("blur",function(){ var i=+inp.dataset.r, f=inp.dataset.f; if(n.routes[i]){ n.routes[i][f]=inp.value.trim(); self._afterCommit(n); } }); });
  };
  FiliusView.prototype._cfgGatewayPf=function(n, body){
    var self=this; n.portForward=n.portForward||[];
    var rows=n.portForward.map(function(p,i){ return '<tr><td><input data-p="'+i+'" data-f="proto" value="'+esc(p.proto||"TCP")+'" style="width:56px"></td><td><input data-p="'+i+'" data-f="port" value="'+esc(p.port||"")+'" style="width:60px"></td><td><input data-p="'+i+'" data-f="lanIp" value="'+esc(p.lanIp||"")+'"></td><td><input data-p="'+i+'" data-f="lanPort" value="'+esc(p.lanPort||"")+'" style="width:60px"></td><td><button class="fv-btn" data-del="'+i+'">✕</button></td></tr>'; }).join("");
    body.innerHTML='<div class="fv-hint" style="margin-bottom:6px">Portfreigaben leiten eingehende Verbindungen aus dem Internet an einen Rechner im LAN weiter.</div>'
      +'<table class="fv-tbl"><thead><tr><th>Protokoll</th><th>Port (WAN)</th><th>LAN-Adresse</th><th>LAN-Port</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" class="fv-hint">Keine Freigaben.</td></tr>')+'</tbody></table>'
      +'<div style="margin-top:8px"><button class="fv-btn" id="pfAdd">+ Neue Freigabe</button></div>';
    body.querySelector("#pfAdd").onclick=function(){ n.portForward.push({proto:"TCP",port:"",lanIp:"",lanPort:""}); self._afterCommit(n); self._cfgGatewayPf(n,body); };
    body.querySelectorAll("[data-del]").forEach(function(bt){ bt.onclick=function(){ n.portForward.splice(+bt.dataset.del,1); self._afterCommit(n); self._cfgGatewayPf(n,body); }; });
    body.querySelectorAll("input[data-p]").forEach(function(inp){ inp.addEventListener("blur",function(){ var i=+inp.dataset.p, f=inp.dataset.f; if(n.portForward[i]){ n.portForward[i][f]=inp.value.trim(); self._afterCommit(n); } }); });
  };

  /* ---- Firewall-Dialog (Router/Gateway) ---- */
  FiliusView.prototype._firewallDialog=function(n){
    var self=this; n.fw=n.fw||{on:false, icmp:false, synOnly:true, defaultAction:"drop", rules:[]};
    var tab=this._fwTab||"gen";
    function render(bg){
      var f=n.fw;
      var head='<h3>🧱 Firewall – '+esc(n.name||"Router")+'</h3><div class="fv-tabs">'
        +'<button class="fv-tab'+(tab==="gen"?" on":"")+'" data-ft="gen">Allgemein</button>'
        +'<button class="fv-tab'+(tab==="rules"?" on":"")+'" data-ft="rules">Firewall-Regeln</button></div><div id="fwBody"></div>'
        +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="fv-btn primary" id="fwX">Schließen</button></div>';
      bg.querySelector(".fv-dlg").innerHTML=head;
      var body=bg.querySelector("#fwBody");
      if(tab==="gen"){
        body.innerHTML='<label class="fv-chk"><input type="checkbox" id="fOn" '+(f.on?"checked":"")+'> Firewall aktivieren</label>'
          +'<div class="fv-hint" style="margin:2px 0 10px">Erst bei aktivierter Firewall greifen die Regeln.</div>'
          +'<label class="fv-chk"><input type="checkbox" id="fIcmp" '+(f.icmp?"checked":"")+'> ICMP-Pakete filtern (Ping blockieren)</label>'
          +'<div style="height:8px"></div>'
          +'<label class="fv-chk"><input type="checkbox" id="fSyn" '+(f.synOnly!==false?"checked":"")+'> nur SYN-Pakete verwerfen (Rückkanal erlauben)</label>';
        body.querySelector("#fOn").onchange=function(){ f.on=this.checked; self._afterCommit(n); };
        body.querySelector("#fIcmp").onchange=function(){ f.icmp=this.checked; self._afterCommit(n); };
        body.querySelector("#fSyn").onchange=function(){ f.synOnly=this.checked; self._afterCommit(n); };
      } else {
        f.rules=f.rules||[];
        var rows=f.rules.map(function(r,i){ return '<tr><td>'+(i+1)+'</td>'
          +'<td><input data-i="'+i+'" data-f="srcIp" value="'+esc(r.srcIp||"")+'" style="width:100px"></td>'
          +'<td><input data-i="'+i+'" data-f="srcMask" value="'+esc(r.srcMask||"")+'" style="width:100px"></td>'
          +'<td><input data-i="'+i+'" data-f="dstIp" value="'+esc(r.dstIp||"")+'" style="width:100px"></td>'
          +'<td><input data-i="'+i+'" data-f="dstMask" value="'+esc(r.dstMask||"")+'" style="width:100px"></td>'
          +'<td><select data-i="'+i+'" data-f="proto"><option '+(r.proto==="TCP"?"selected":"")+'>TCP</option><option '+(r.proto==="UDP"?"selected":"")+'>UDP</option><option value="*" '+(!r.proto||r.proto==="*"?"selected":"")+'>*</option></select></td>'
          +'<td><input data-i="'+i+'" data-f="port" value="'+esc(r.port||"")+'" style="width:56px"></td>'
          +'<td><select data-i="'+i+'" data-f="action"><option value="accept" '+(r.action==="accept"?"selected":"")+'>akzeptieren</option><option value="drop" '+(r.action!=="accept"?"selected":"")+'>verwerfen</option></select></td>'
          +'<td><button class="fv-btn" data-del="'+i+'">✕</button></td></tr>'; }).join("");
        body.innerHTML='<div class="fv-frow"><label class="cap" style="width:auto">Standardaktion, wenn keine Regel greift:</label>'
          +'<select class="fv-in" id="fDef" style="min-width:130px"><option value="accept" '+(f.defaultAction==="accept"?"selected":"")+'>akzeptieren</option><option value="drop" '+(f.defaultAction!=="accept"?"selected":"")+'>verwerfen</option></select></div>'
          +'<table class="fv-tbl"><thead><tr><th>ID</th><th>Quell-IP</th><th>Maske</th><th>Ziel-IP</th><th>Maske</th><th>Protokoll</th><th>Port</th><th>Aktion</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" class="fv-hint">Keine Regeln.</td></tr>')+'</tbody></table>'
          +'<div style="margin-top:8px"><button class="fv-btn" id="fAdd">+ Neue Regel</button></div>';
        body.querySelector("#fDef").onchange=function(){ f.defaultAction=this.value; self._afterCommit(n); };
        body.querySelector("#fAdd").onclick=function(){ f.rules.push({srcIp:"",srcMask:"",dstIp:"",dstMask:"",proto:"TCP",port:"",action:"drop"}); self._afterCommit(n); render(bg); };
        body.querySelectorAll("[data-del]").forEach(function(bt){ bt.onclick=function(){ f.rules.splice(+bt.dataset.del,1); self._afterCommit(n); render(bg); }; });
        body.querySelectorAll("input[data-i],select[data-i]").forEach(function(inp){ inp.addEventListener("change",function(){ var i=+inp.dataset.i, fl=inp.dataset.f; if(f.rules[i]){ f.rules[i][fl]=inp.value.trim?inp.value.trim():inp.value; self._afterCommit(n); } }); });
      }
      bg.querySelectorAll("[data-ft]").forEach(function(bt){ bt.onclick=function(){ self._fwTab=bt.dataset.ft; tab=bt.dataset.ft; render(bg); }; });
      bg.querySelector("#fwX").onclick=function(){ bg._close(); };
    }
    var bg=this._dialog("<div></div>", function(bg){ render(bg); });
  };

  /* ---- Modal-Dialog-Helfer ---- */
  FiliusView.prototype._dialog=function(html, onOpen){
    var bg=el("div","fv-dlgbg"); bg.innerHTML='<div class="fv-dlg">'+html+'</div>';
    bg.addEventListener("pointerdown", function(e){ if(e.target===bg) close(); });
    document.body.appendChild(bg);
    function close(){ bg.remove(); } bg._close=close;
    if(onOpen) onOpen(bg, close);
    return bg;
  };

  /* ============================ Simulation ============================== */
  var DEFAULT_INDEX = '<html>\n  <head><title>Standardseite</title></head>\n  <body bgcolor="#ccddff" style="font-family:Verdana; text-align:center;">\n    <h2>FILIUS - Webserver</h2>\n    <p>Herzlich Willkommen auf dem Webserver!</p>\n    <p>Diese Seite wurde automatisch eingerichtet, es lassen sich aber auch eigene Seiten hinterlegen.</p>\n  </body>\n</html>';

  FiliusView.prototype._simNodeClick=function(n){
    if(isHost(n.type)) this._openDesk(n.id);
    else if(n.type==="switch") this._satViewer(n);
    else if(isRouter(n.type)) this._routerViewer(n);
  };

  FiliusView.prototype._closeAllDesks=function(){ var self=this; Object.keys(this._desks||{}).forEach(function(id){ var d=self._desks[id]; if(d&&d.win) d.win.remove(); }); this._desks={}; if(this._pingTimer){ clearInterval(this._pingTimer); this._pingTimer=null; } };
  FiliusView.prototype._openDesk=function(hostId){
    var self=this, n=this._node(hostId); if(!n) return;
    var d=this._desks[hostId];
    if(d&&d.win){ d.win.style.zIndex=String(70+ (this._zc=(this._zc||0)+1)); return; }
    var win=el("div","fv-desk");
    var count=Object.keys(this._desks).length;
    win.style.left=(30+count*22)+"px"; win.style.top=(16+count*22)+"px"; win.style.zIndex=String(70+(this._zc=(this._zc||0)+1));
    win.innerHTML='<div class="fv-desk-tb"><img src="'+hw(TYPES[n.type].icon)+'"><span class="t"></span><span class="x">✕</span></div><div class="fv-desk-body"></div>';
    this.root.appendChild(win);
    this._desks[hostId]={win:win, app:null};
    var self2=this;
    win.querySelector(".x").onclick=function(){ win.remove(); delete self2._desks[hostId]; };
    // Drag
    var tbEl=win.querySelector(".fv-desk-tb");
    tbEl.addEventListener("pointerdown", function(ev){ if(ev.target.classList.contains("x")) return; ev.preventDefault();
      var rr=self2.root.getBoundingClientRect(); var ox=ev.clientX-win.offsetLeft, oy=ev.clientY-win.offsetTop;
      win.style.zIndex=String(70+(self2._zc=(self2._zc||0)+1));
      function mm(mv){ win.style.left=Math.max(0,Math.min(rr.width-80, mv.clientX-ox))+"px"; win.style.top=Math.max(0,Math.min(rr.height-40, mv.clientY-oy))+"px"; }
      function mu(){ document.removeEventListener("pointermove",mm); document.removeEventListener("pointerup",mu); }
      document.addEventListener("pointermove",mm); document.addEventListener("pointerup",mu);
    });
    win.addEventListener("pointerdown", function(){ win.style.zIndex=String(70+(self2._zc=(self2._zc||0)+1)); });
    this._renderDesk(hostId);
  };
  FiliusView.prototype._deskTitle=function(n){ return n.ipAsName&&n.ip ? (n.name||n.ip) : (n.name||TYPES[n.type].label)+(n.ip?(" - "+n.ip):""); };
  FiliusView.prototype._renderDesk=function(hostId){
    var self=this, n=this._node(hostId), d=this._desks[hostId]; if(!n||!d) return;
    var win=d.win; win.querySelector(".fv-desk-tb .t").textContent=this._deskTitle(n);
    var body=win.querySelector(".fv-desk-body"); body.innerHTML="";
    var screen=el("div","fv-desk-screen");
    if(!d.app){
      // Startbildschirm mit App-Icons
      screen.innerHTML='<div class="fv-desk-bg"></div><div class="fv-desk-apps"></div>';
      var apps=screen.querySelector(".fv-desk-apps");
      var inst=el("div","fv-dicon"); inst.innerHTML='<img src="'+dg("icon_softwareinstallation.png")+'"><span>Software-Installation</span>'; inst.onclick=function(){ d.app="__install"; self._renderDesk(hostId); }; apps.appendChild(inst);
      n.apps=n.apps||{};
      APPS.forEach(function(a){ if(n.apps[a.key]){ var ic=el("div","fv-dicon"); ic.innerHTML='<img src="'+dg(a.icon)+'"><span>'+esc(a.name)+'</span>'; ic.onclick=function(){ d.app=a.key; self._renderDesk(hostId); }; apps.appendChild(ic); } });
    } else {
      // App-Fenster (Card mit Titelleiste)
      var appDef = d.app==="__install" ? {name:"Software-Installation", icon:"icon_softwareinstallation.png"} : appByKey(d.app);
      var card=el("div","fv-appwin");
      card.innerHTML='<div class="fv-appwin-tb"><img src="'+dg(appDef.icon)+'"><span class="t">'+esc(appDef.name)+'</span></div><div class="fv-appwin-body"></div>';
      screen.appendChild(card);
      var mount=card.querySelector(".fv-appwin-body");
      this._mountApp(d.app, n, mount, card);
    }
    // Taskbar
    var tb=el("div","fv-taskbar");
    tb.innerHTML='<button class="home">Startbildschirm</button><div class="net"><img src="'+dg("netzwek_aus.png")+'"></div>';
    tb.querySelector(".home").onclick=function(){ d.app=null; self._renderDesk(hostId); };
    var A=E.analyze(this.data); var ipv=(A.host[n.id]&&A.host[n.id].ip)||"(keine IP)";
    var net=tb.querySelector(".net"); net.title="IP: "+ipv;
    net.onclick=function(){ self._netInfo(n, screen); };
    d.net=net.querySelector("img");
    body.appendChild(screen); body.appendChild(tb);
  };
  FiliusView.prototype._netInfo=function(n, screen){
    var A=E.analyze(this.data), h=A.host[n.id]||{};
    var old=screen.querySelector(".fv-net-info"); if(old){ old.remove(); return; }
    var p=el("div","fv-net-info");
    p.innerHTML='<div><b>IP-Adresse</b> '+esc(h.ip||"—")+'</div><div><b>Netzmaske</b> '+esc(h.mask||"—")+'</div><div><b>Gateway</b> '+esc(h.gateway||"—")+'</div><div><b>DNS-Server</b> '+esc(h.dns||"—")+'</div><div><b>MAC</b> '+esc(A.mac[n.id]||"—")+'</div>';
    p.onclick=function(){ p.remove(); };
    screen.appendChild(p);
  };

  /* ---- App-Dispatch ---- */
  FiliusView.prototype._mountApp=function(key, n, mount, card){
    if(key==="__install") return this._appInstall(n, mount);
    if(key==="terminal") return this._appTerminal(n, mount);
    if(key==="fileexplorer") return this._appFiles(n, mount);
    if(key==="texteditor") return this._appTextEditor(n, mount, card);
    if(key==="imageviewer") return this._appImageViewer(n, mount, card);
    if(key==="webbrowser") return this._appBrowser(n, mount, card);
    if(key==="webserver") return this._appWebserver(n, mount);
    if(key==="dns") return this._appDns(n, mount);
    if(key==="emailclient") return this._appMailClient(n, mount, card);
    if(key==="mailserver") return this._appMailServer(n, mount);
    if(key==="gnutella") return this._appGnutella(n, mount);
    if(key==="client") return this._appClient(n, mount);
    if(key==="echo") return this._appEcho(n, mount);
    if(key==="firewall") return this._appFirewall(n, mount);
    mount.innerHTML='<div class="fv-hint">Diese Anwendung ist noch nicht verfügbar.</div>';
  };

  /* ---- Software-Installation ---- */
  FiliusView.prototype._appInstall=function(n, mount){
    var self=this; n.apps=n.apps||{};
    var pending=JSON.parse(JSON.stringify(n.apps));   // Arbeitskopie bis „Änderungen annehmen“
    function render(){
      var inst=APPS.filter(function(a){ return pending[a.key]; });
      var avail=APPS.filter(function(a){ return !pending[a.key]; });
      mount.innerHTML='<div style="display:flex;gap:14px;align-items:stretch;height:100%">'
        +'<div style="flex:1;display:flex;flex-direction:column"><div style="font-weight:800;margin-bottom:5px">Installiert:</div><div class="fv-list" id="lInst" style="flex:1"></div></div>'
        +'<div style="display:flex;flex-direction:column;justify-content:center;gap:10px"><button class="fv-btn" id="bAdd" title="installieren"><img src="'+ag("pfeil_links.png")+'" style="width:20px;height:14px"></button><button class="fv-btn" id="bRem" title="entfernen"><img src="'+ag("pfeil_rechts.png")+'" style="width:20px;height:14px"></button></div>'
        +'<div style="flex:1;display:flex;flex-direction:column"><div style="font-weight:800;margin-bottom:5px">Verfügbar:</div><div class="fv-list" id="lAvail" style="flex:1"></div></div>'
        +'</div><div style="text-align:center;margin-top:10px"><button class="fv-btn primary" id="bOk">Änderungen annehmen</button></div>';
      var selI=null, selA=null;
      var li=mount.querySelector("#lInst"), la=mount.querySelector("#lAvail");
      inst.forEach(function(a){ var it=el("div","it",'<img src="'+dg(a.icon)+'" style="width:20px;height:20px">'+esc(a.name)); it.onclick=function(){ selI=a.key; selA=null; render2(); }; it.ondblclick=function(){ pending[a.key]=false; render(); }; it.dataset.k=a.key; li.appendChild(it); });
      avail.forEach(function(a){ var it=el("div","it",'<img src="'+dg(a.icon)+'" style="width:20px;height:20px">'+esc(a.name)); it.onclick=function(){ selA=a.key; selI=null; render2(); }; it.ondblclick=function(){ pending[a.key]=true; render(); }; it.dataset.k=a.key; la.appendChild(it); });
      function render2(){ li.querySelectorAll(".it").forEach(function(x){ x.classList.toggle("sel", x.dataset.k===selI); }); la.querySelectorAll(".it").forEach(function(x){ x.classList.toggle("sel", x.dataset.k===selA); }); }
      mount.querySelector("#bAdd").onclick=function(){ if(selA){ pending[selA]=true; render(); } };
      mount.querySelector("#bRem").onclick=function(){ if(selI){ pending[selI]=false; render(); } };
      mount.querySelector("#bOk").onclick=function(){
        APPS.forEach(function(a){ var was=!!n.apps[a.key], now=!!pending[a.key]; if(now&&!was){ n.apps[a.key]=true; self._onInstall(n, a.key); } else if(!now&&was){ delete n.apps[a.key]; } });
        self._changed(); var d=self._deskOf(n.id); if(d) d.app=null; self._renderDesk(n.id);
      };
    }
    render();
  };
  FiliusView.prototype._deskOf=function(id){ return this._desks[id]; };
  FiliusView.prototype._onInstall=function(n, key){
    var fs=E.fs.of(n);
    if(key==="webserver"){ if(E.fs.read(fs,"/webserver/index.html")==null) E.fs.write(fs,"/webserver/index.html", DEFAULT_INDEX); }
    if(key==="gnutella"){ E.fs.mkdir(fs,"/peer2peer"); }
    if(key==="dns"){ n.dnsRecords=n.dnsRecords||[]; }
    if(key==="mailserver"){ n.maildomain=n.maildomain||"filius.de"; n.mailAccounts=n.mailAccounts||[]; }
  };

  /* ---- Datenaustausch / Ping-Simulation ---- */
  FiliusView.prototype._recordSim=function(sim){
    var self=this; if(!this._sim) this._sim={ sat:{}, log:{}, no:0, t0:Date.now(), layers:null };
    var t=Math.max(0, Date.now()-(this._sim.t0||Date.now()));
    Object.keys(sim.logs||{}).forEach(function(nid){ (sim.logs[nid]||[]).forEach(function(row){ self._sim.no++;
      (self._sim.log[nid]=self._sim.log[nid]||[]).push({no:self._sim.no, zeit:(t/1000).toFixed(2)+"s", proto:row.proto, schicht:row.schicht, quelle:row.quelle, ziel:row.ziel, bemerkung:row.bemerkung});
      if(self._sim.log[nid].length>400) self._sim.log[nid]=self._sim.log[nid].slice(-400); }); });
    (sim.sat||[]).forEach(function(e){ var m=self._sim.sat[e.switchId]=self._sim.sat[e.switchId]||{}; m[e.mac]={port:e.port, updated:(t/1000).toFixed(2)+"s"}; });
    if(sim.layers) this._sim.layers=sim.layers;
  };
  FiliusView.prototype._animatePath=function(path){
    if(!path||path.length<2) return; var self=this;
    var pts=path.map(function(id){ var n=self._node(id); return n?{x:n.x,y:n.y}:null; }).filter(Boolean); if(pts.length<2) return;
    for(var i=0;i<path.length-1;i++){ (function(a,b){ self.data.links.forEach(function(l){ if((l.a===a&&l.b===b)||(l.a===b&&l.b===a)){ var rec=self._cableEls[l.id]; if(rec){ rec.path.classList.add("live"); setTimeout(function(){ rec.path.classList.remove("live"); }, 1300); } } }); })(path[i],path[i+1]); }
    var pk=this._packet; if(!pk) return; pk.style.display="";
    var seg=0,t=0; if(this._anim) clearInterval(this._anim);
    this._anim=setInterval(function(){ t+=0.05/(self._speed||1); if(t>=1){ t=0; seg++; if(seg>=pts.length-1){ clearInterval(self._anim); self._anim=null; pk.style.display="none"; return; } }
      var A=pts[seg], B=pts[seg+1]; pk.setAttribute("cx", A.x+(B.x-A.x)*t); pk.setAttribute("cy", A.y+(B.y-A.y)*t);
    }, 16);
  };
  FiliusView.prototype._flashNet=function(hostId){ var d=this._desks[hostId]; if(d&&d.net){ d.net.src=dg("netzwek_c.png"); setTimeout(function(){ if(d.net) d.net.src=dg("netzwek_aus.png"); }, 1600); } };
  FiliusView.prototype._exchangeDialog=function(n){
    var self=this;
    function render(bg){
      var rows=(self._sim.log[n.id]||[]);
      var A=E.analyze(self.data);
      var body='<h3>📊 Datenaustausch – '+esc(n.name||TYPES[n.type].label)+'</h3>'
        +'<div class="fv-hint" style="margin-bottom:6px">MAC: <b>'+esc(A.mac[n.id]||"—")+'</b> · IP: <b>'+esc((A.host[n.id]&&A.host[n.id].ip)||"—")+'</b></div>'
        +'<div style="max-height:44vh;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="fv-tbl"><thead><tr><th>Nr.</th><th>Zeit</th><th>Quelle</th><th>Ziel</th><th>Protokoll</th><th>Schicht</th><th>Bemerkungen</th></tr></thead><tbody>'
        +(rows.length?rows.map(function(r){ var col={"Netzzugang":"#eef6ff","Vermittlung":"#eaffe9","Transport":"#fff7e6","Anwendung":"#f3e9ff"}[r.schicht]||""; return '<tr style="background:'+col+'"><td>'+r.no+'</td><td>'+esc(r.zeit)+'</td><td style="font-family:monospace;font-size:10px">'+esc(r.quelle)+'</td><td style="font-family:monospace;font-size:10px">'+esc(r.ziel)+'</td><td><b>'+esc(r.proto)+'</b></td><td>'+esc(r.schicht)+'</td><td>'+esc(r.bemerkung)+'</td></tr>'; }).join(""):'<tr><td colspan="7" class="fv-hint" style="padding:10px">Noch kein Datenverkehr. Führe z. B. auf einem Rechner einen <b>ping</b> aus.</td></tr>')
        +'</tbody></table></div>'
        +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="fv-btn" id="exClr">Tabelle löschen</button><button class="fv-btn primary" id="exX">Schließen</button></div>';
      bg.querySelector(".fv-dlg").innerHTML=body;
      bg.querySelector("#exX").onclick=bg._close;
      bg.querySelector("#exClr").onclick=function(){ self._sim.log[n.id]=[]; render(bg); };
    }
    this._dialog("<div></div>", function(bg){ render(bg); });
  };

  /* ---- SAT-Viewer (Switch) ---- */
  FiliusView.prototype._satViewer=function(n){
    var self=this; var ent=(this._sim.sat[n.id])||{}; var keys=Object.keys(ent);
    var body='<h3><img src="'+hw("switch.png")+'" style="width:22px;height:20px">SAT – '+esc(n.name||"Switch")+'</h3>'
      +'<p class="fv-hint">Der Switch merkt sich, über welchen Port er welche MAC-Adresse gesehen hat.</p>'
      +'<table class="fv-tbl"><thead><tr><th>MAC-Adresse</th><th>Port</th><th>Aktualisiert</th></tr></thead><tbody>'
      +(keys.length?keys.map(function(m){ return '<tr><td style="font-family:monospace">'+esc(m)+'</td><td>'+ent[m].port+'</td><td class="fv-hint">'+esc(ent[m].updated)+'</td></tr>'; }).join(""):'<tr><td colspan="3" class="fv-hint" style="padding:10px">Noch leer – Datenverkehr über diesen Switch füllt die Tabelle.</td></tr>')
      +'</tbody></table>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="fv-btn" id="sClr">Tabelle löschen</button><button class="fv-btn primary" id="sX">Schließen</button></div>';
    this._dialog(body, function(bg,close){ bg.querySelector("#sX").onclick=close; bg.querySelector("#sClr").onclick=function(){ delete self._sim.sat[n.id]; close(); self._satViewer(n); }; });
  };
  /* ---- Routing/NAT-Viewer (Router/Gateway) ---- */
  FiliusView.prototype._routerViewer=function(n){
    var A=E.analyze(this.data); var rows=E.forwardingTable(A, n.id);
    var body='<h3><img src="'+hw(TYPES[n.type].icon)+'" style="width:22px;height:20px">'+esc(n.name||TYPES[n.type].label)+' – Weiterleitungstabelle</h3>'
      +'<p class="fv-hint">'+(n.type==="gateway"?'Heimrouter mit NAT.':(n.autoRoute!==false?'Automatisches Routing (RIP) aktiv.':'Statisches Routing.'))+'</p>'
      +'<table class="fv-tbl"><thead><tr><th>Ziel</th><th>Netzmaske</th><th>Nächstes Gateway</th><th>Schnittstelle</th></tr></thead><tbody>'
      +(rows.length?rows.map(function(r){ return '<tr'+(r.kind==="auto"||r.kind==="default"?' class="auto"':'')+'><td>'+esc(r.ziel)+'</td><td>'+esc(r.maske)+'</td><td>'+esc(r.gateway)+'</td><td>'+esc(r.iface)+'</td></tr>'; }).join(""):'<tr><td colspan="4" class="fv-hint" style="padding:10px">Keine Schnittstellen konfiguriert.</td></tr>')
      +'</tbody></table>'
      +'<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="fv-btn primary" id="rX">Schließen</button></div>';
    this._dialog(body, function(bg,close){ bg.querySelector("#rX").onclick=close; });
  };

  /* ---- Terminal ---- */
  FiliusView.prototype._appTerminal=function(n, mount){
    var self=this; if(!this._cwd) this._cwd={}; var cwd=function(){ return self._cwd[n.id]||"/"; }, setCwd=function(p){ self._cwd[n.id]=p; };
    if(!this._termBuf) this._termBuf={}; var buf=this._termBuf[n.id]||["", "".padEnd(0), "Verwende 'help' für eine Liste der Befehle.",""];
    mount.style.padding="0";
    mount.innerHTML='<div class="fv-term"><div class="fv-term-out"></div><div class="fv-term-in"><span></span><input autocomplete="off" spellcheck="false"></div></div>';
    var out=mount.querySelector(".fv-term-out"), prompt=mount.querySelector(".fv-term-in span"), inp=mount.querySelector(".fv-term-in input");
    function paint(){ out.innerHTML=buf.map(function(l){ return esc(l); }).join("<br>"); out.scrollTop=out.scrollHeight; self._termBuf[n.id]=buf; prompt.textContent=cwd()+"> "; }
    function pr(s){ buf.push(s); if(buf.length>500) buf=buf.slice(-500); paint(); }
    paint();
    if(!this._termHist) this._termHist={}; var hist=this._termHist[n.id]=this._termHist[n.id]||[]; var hp=-1;
    function run(input){
      pr(cwd()+"> "+input); var raw=input.trim(); if(!raw){ return; } hist.push(raw);
      var parts=raw.split(/\s+/), c=parts[0].toLowerCase(), arg=parts[1], arg2=parts[2];
      var A=E.analyze(self.data), me=A.host[n.id]||{}, fs=E.fs.of(n), F=E.fs;
      switch(c){
        case "help":
          if(arg){ pr(arg+" - siehe unten"); break; }
          pr("Verfügbare Befehle:");
          pr("  Netz:    ping · ipconfig · host · nslookup · traceroute · arp · route · netstat · tcpdump");
          pr("  Dateien: ls · cd · pwd · mkdir · touch · cat · echo text > datei · cp · mv · rm");
          pr("  Sonstige: clear · exit · help"); break;
        case "clear": case "cls": buf=["Verwende 'help' für eine Liste der Befehle.",""]; paint(); break;
        case "exit": { var d=self._deskOf(n.id); if(d){ d.app=null; self._renderDesk(n.id); } return; }
        case "ipconfig": case "ifconfig":
          pr("  IP-Adresse . . . . . . : "+(me.ip||"(keine)"));
          pr("  Netzmaske. . . . . . . : "+(me.mask||"-"));
          pr("  Physische Adresse. . . : "+(A.mac[n.id]||"—"));
          pr("  Standardgateway. . . . : "+(me.gateway||"(keins)"));
          pr("  DNS-Server . . . . . . : "+(me.dns||"(keiner)")); break;
        case "host": case "nslookup": if(!arg){ pr("Aufruf: "+c+" <name>"); break; } { var ip=E.resolveName2(self.data, n.id, arg); if(c==="nslookup"){ pr("Server:  "+(me.dns||"-")); pr("Address: "+(me.dns||"-")); pr(""); } pr(ip?(arg+" hat die Adresse "+ip):(arg+": konnte nicht aufgelöst werden")); } break;
        case "ping": if(!arg){ pr("Aufruf: ping <ziel>"); break; } self._doPing(n, arg, pr); return;
        case "traceroute": case "tracert": if(!arg){ pr("Aufruf: traceroute <ziel>"); break; } { var r=E.pingByName(self.data, n.id, arg); if(!r.ok){ pr("Zieladresse nicht erreichbar ("+(r.error||"")+")"); } else { pr("Route zu "+r.target+" (max. 30 Stationen):"); (r.hops||[]).forEach(function(h,i){ pr("  "+(i+1)+"   "+h); }); pr(r.target+" nach "+(r.hops||[]).length+" Sprung/Sprüngen erreicht."); } } break;
        case "arp": { var tbl=(self._sim.log[n.id])||[]; var arp={}; tbl.forEach(function(x){ if(x.proto==="ARP"&&/liegt bei/.test(x.bemerkung||"")){ var m=x.bemerkung.match(/^(\S+) liegt bei (\S+)/); if(m) arp[m[1]]=m[2]; } }); var ks=Object.keys(arp); if(!ks.length){ pr("ARP-Tabelle ist leer. (Zuerst einen ping ausführen.)"); } else { pr("  Internetadresse       Physische Adresse"); ks.forEach(function(k){ pr("  "+(k+"                    ").slice(0,20)+"  "+arp[k]); }); } } break;
        case "route": { if(!me.ip){ pr("Keine IP-Adresse konfiguriert."); break; } pr("Weiterleitungstabelle:"); pr("  Ziel             Netzmaske         Gateway           Schnittstelle"); pr("  "+(E.intToIp(E.netAddr(me.ip,me.mask))+"                 ").slice(0,17)+(me.mask+"                  ").slice(0,18)+"auf Verbindung    "+me.ip); if(me.gateway) pr("  0.0.0.0           0.0.0.0           "+(me.gateway+"                  ").slice(0,18)+me.ip); pr("  127.0.0.0         255.0.0.0         127.0.0.1         127.0.0.1"); } break;
        case "netstat": pr("| Proto | Lokale Adresse      | Entfernte Adresse   | Zustand |"); pr("(keine aktiven Verbindungen)"); break;
        case "tcpdump": { var tbl2=(self._sim.log[n.id])||[]; if(!tbl2.length){ pr("(kein aufgezeichneter Verkehr – zuerst z. B. ping ausführen)"); } else tbl2.slice(-20).forEach(function(r){ pr("  "+r.zeit+" "+r.proto+" "+r.quelle+" > "+r.ziel+"  "+r.bemerkung); }); } break;
        case "pwd": pr(cwd()); break;
        case "ls": case "dir": { var dd=arg?F.resolve(cwd(),arg):cwd(); if(!F.isDir(fs,dd)){ pr("Kein Verzeichnis: "+arg); break; } var items=F.list(fs, dd); if(!items.length){ pr("  (leer)"); } items.forEach(function(it){ pr("  "+(it.dir?"[ORDNER]  ":"          ")+it.name+(it.dir?"":"   "+it.size+" B")); }); } break;
        case "cd": { if(!arg){ pr(cwd()); break; } var tt=(arg==="/")?"/":F.resolve(cwd(),arg); if(F.isDir(fs,tt)){ setCwd(tt); paint(); } else pr("Verzeichnis nicht gefunden: "+arg); } break;
        case "mkdir": if(!arg){ pr("Aufruf: mkdir <ordner>"); break; } pr(F.mkdir(fs, F.resolve(cwd(),arg))?"Ordner erstellt.":"Ordner bereits vorhanden."); self._changed(); break;
        case "touch": if(!arg){ pr("Aufruf: touch <datei>"); break; } { var p=F.resolve(cwd(),arg); if(F.exists(fs,p)) pr("Datei bereits vorhanden."); else { F.write(fs,p,""); pr("Datei erstellt."); self._changed(); } } break;
        case "cat": case "type": if(!arg){ pr("Aufruf: cat <datei>"); break; } { var cc=F.read(fs, F.resolve(cwd(),arg)); pr(cc==null?("Datei nicht vorhanden: "+arg):(cc||"(leer)")); } break;
        case "echo": { var m=raw.match(/^echo\s+(.*?)\s*>\s*(\S+)\s*$/i); if(m){ F.write(fs, F.resolve(cwd(),m[2]), m[1]); pr("Geschrieben nach "+m[2]); self._changed(); } else pr(raw.replace(/^echo\s?/i,"")); } break;
        case "rm": case "del": if(!arg){ pr("Aufruf: rm <pfad>"); break; } pr(F.rm(fs, F.resolve(cwd(),arg))?"Gelöscht.":"Nicht vorhanden."); self._changed(); break;
        case "cp": case "copy": if(!arg||!arg2){ pr("Aufruf: cp <quelle> <ziel>"); break; } { var sp=F.resolve(cwd(),arg), s=F.read(fs,sp); if(s==null){ pr("Quelle nicht vorhanden."); break; } var dp=F.resolve(cwd(),arg2); if(F.isDir(fs,dp)) dp=dp+"/"+F.base(sp); if(dp===sp){ pr("Quelle und Ziel identisch."); break; } F.write(fs,dp,s); pr("Kopiert."); self._changed(); } break;
        case "mv": case "move": if(!arg||!arg2){ pr("Aufruf: mv <quelle> <ziel>"); break; } { var sp2=F.resolve(cwd(),arg), s2=F.read(fs,sp2); if(s2==null){ pr("Quelle nicht vorhanden."); break; } var dp2=F.resolve(cwd(),arg2); if(F.isDir(fs,dp2)) dp2=dp2+"/"+F.base(sp2); if(dp2===sp2){ pr("Quelle und Ziel identisch."); break; } F.write(fs,dp2,s2); F.rm(fs,sp2); pr("Verschoben."); self._changed(); } break;
        case "": break;
        default: pr("Unbekannter Befehl: "+c); pr("Mit 'help' erhalten Sie eine Liste bekannter Befehle.");
      }
    }
    inp.addEventListener("keydown", function(e){
      if(e.key==="Enter"){ var v=inp.value; inp.value=""; hp=-1; if(v.trim()!=="") run(v); }
      else if(e.key==="ArrowUp"){ e.preventDefault(); if(hist.length){ hp=Math.min(hist.length-1, hp+1); inp.value=hist[hist.length-1-hp]||""; } }
      else if(e.key==="ArrowDown"){ e.preventDefault(); hp=Math.max(-1, hp-1); inp.value=hp<0?"":(hist[hist.length-1-hp]||""); }
    });
    setTimeout(function(){ inp.focus(); }, 30);
  };
  FiliusView.prototype._doPing=function(n, target, pr){
    var self=this; var sim=E.pingSim(self.data, n.id, target); self._recordSim(sim); self._flashNet(n.id);
    pr("PING "+(sim.dstIp||target)+":");
    if(!sim.ok){ if(sim.path) self._animatePath(sim.path); pr("  Fehler: "+(sim.error||"nicht erreichbar")); pr("  --- Statistik: 4 gesendet, 0 empfangen, 100% Verlust ---"); return; }
    self._animatePath(sim.path);
    if(self._pingTimer){ clearInterval(self._pingTimer); self._pingTimer=null; }
    var i=0; self._pingTimer=setInterval(function(){ i++; pr("  Antwort von "+sim.dstIp+": Bytes=32 Zeit≈"+(8+Math.round(i*1.7))+"ms TTL=64"); if(i>=4){ clearInterval(self._pingTimer); self._pingTimer=null; pr("  --- Statistik: 4 gesendet, 4 empfangen, 0% Verlust ---"); } }, Math.max(120, 360*(self._speed||1)));
  };

  /* ---- Datei-Explorer ---- */
  FiliusView.prototype._appFiles=function(n, mount){
    var self=this, F=E.fs, fs=F.of(n);
    if(!this._fcwd) this._fcwd={}; var dir=this._fcwd[n.id]||"/"; if(!F.isDir(fs,dir)){ dir="/"; this._fcwd[n.id]="/"; }
    function setDir(d){ self._fcwd[n.id]=d; self._appFiles(n,mount); }
    var items=F.list(fs,dir);
    mount.innerHTML='<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
      +(dir!=="/"?'<button class="fv-btn" id="fUp">⬆️ zurück</button>':'')
      +'<span class="fv-hint" style="font-family:monospace">📂 '+esc(dir)+'</span><span style="flex:1"></span>'
      +'<button class="fv-btn" id="fMk">📁 Ordner</button><button class="fv-btn" id="fNew">📄 Datei</button>'
      +'<input type="file" id="fImp" style="display:none"><button class="fv-btn" id="fImpB">📥 Import</button></div>'
      +'<div class="fv-list" id="fList" style="max-height:260px"></div><div id="fEdit" style="margin-top:8px"></div>';
    var list=mount.querySelector("#fList");
    list.innerHTML = items.length? items.map(function(it){ return '<div class="it" data-open="'+esc(it.path)+'" data-dir="'+(it.dir?1:0)+'">'+(it.dir?"📁 ":"📄 ")+esc(it.name)+(it.dir?"":'<span class="fv-hint" style="margin-left:auto">'+it.size+' B</span>')+'<button class="fv-btn" data-rm="'+esc(it.path)+'" style="padding:2px 7px">🗑️</button></div>'; }).join("") : '<div class="fv-hint" style="padding:8px">(leerer Ordner)</div>';
    if(dir!=="/") mount.querySelector("#fUp").onclick=function(){ setDir(F.parent(dir)); };
    mount.querySelector("#fMk").onclick=function(){ var nm=prompt("Ordnername:"); if(nm){ F.mkdir(fs, F.resolve(dir,nm)); self._changed(); setDir(dir); } };
    mount.querySelector("#fNew").onclick=function(){ var nm=prompt("Dateiname (z. B. seite.html):"); if(nm){ var p=F.resolve(dir,nm); if(!F.exists(fs,p)) F.write(fs,p,""); self._changed(); setDir(dir); } };
    var fi=mount.querySelector("#fImp"); mount.querySelector("#fImpB").onclick=function(){ fi.click(); }; fi.onchange=function(e){ var f=e.target.files[0]; if(!f)return; if(f.size>150000){ alert("Datei zu groß (max. 150 KB)."); return; } var rd=new FileReader(); var isImg=/^image\//.test(f.type)||F.fileType(f.name)==="image"; rd.onload=function(){ F.write(fs, F.resolve(dir,f.name), String(rd.result||"")); self._changed(); setDir(dir); }; if(isImg) rd.readAsDataURL(f); else rd.readAsText(f); };
    list.querySelectorAll("[data-open]").forEach(function(b){ b.onclick=function(ev){ if(ev.target.dataset.rm) return; if(b.dataset.dir==="1") setDir(b.dataset.open); else self._fileOpen(n, mount, b.dataset.open); }; });
    list.querySelectorAll("[data-rm]").forEach(function(b){ b.onclick=function(ev){ ev.stopPropagation(); if(confirm("„"+F.base(b.dataset.rm)+"“ löschen?")){ F.rm(fs,b.dataset.rm); self._changed(); setDir(dir); } }; });
  };
  FiliusView.prototype._fileOpen=function(n, mount, p){
    var self=this, F=E.fs, fs=F.of(n); var box=mount.querySelector("#fEdit"); if(!box) return; var c=F.read(fs,p); if(c==null) return;
    if(F.fileType(p)==="image"){ var okImg=/^data:image\//i.test(c);
      box.innerHTML='<div style="border:1px solid var(--line);border-radius:8px;overflow:hidden"><div style="background:var(--line2);padding:6px 9px;font-weight:800;font-size:12px">🖼️ '+esc(p)+'</div><div style="padding:10px;text-align:center">'+(okImg?'<img style="max-width:100%;max-height:220px">':'<span class="fv-hint">Kein anzeigbares Bild.</span>')+'</div></div>';
      if(okImg){ var im=box.querySelector("img"); if(im) im.src=c; } return; }
    box.innerHTML='<div style="border:1px solid var(--line);border-radius:8px;overflow:hidden"><div style="background:var(--line2);padding:6px 9px;font-weight:800;font-size:12px">📝 '+esc(p)+'</div><textarea id="feTa" spellcheck="false" style="width:100%;min-height:130px;border:none;padding:8px;font-family:monospace;font-size:12px;background:var(--card);color:var(--ink);display:block"></textarea><div style="padding:7px;text-align:right"><button class="fv-btn primary" id="feSave">💾 Speichern</button></div></div>';
    box.querySelector("#feTa").value=c;
    box.querySelector("#feSave").onclick=function(){ F.write(fs,p, box.querySelector("#feTa").value); self._changed(); var m=box.querySelector("#feSave"); m.textContent="✓ gespeichert"; setTimeout(function(){ m.textContent="💾 Speichern"; },1200); };
  };

  /* ---- Text-Editor ---- */
  FiliusView.prototype._appTextEditor=function(n, mount, card){
    var self=this, F=E.fs, fs=F.of(n); var state={file:null};
    function setTitle(){ card.querySelector(".fv-appwin-tb .t").textContent="Text-Editor"+(state.file?(" - "+F.base(state.file)):""); }
    mount.innerHTML='<div style="display:flex;gap:6px;margin-bottom:8px"><button class="fv-btn" id="tNew">Neu</button><button class="fv-btn" id="tOpen">Öffnen</button><button class="fv-btn" id="tSave">Speichern</button><button class="fv-btn" id="tSaveAs">Speichern unter</button></div>'
      +'<textarea id="tArea" spellcheck="false" style="width:100%;min-height:300px;font-family:\'Courier New\',monospace;font-size:12px;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card);color:var(--ink)"></textarea>';
    var ta=mount.querySelector("#tArea");
    mount.querySelector("#tNew").onclick=function(){ state.file=null; ta.value=""; setTitle(); };
    mount.querySelector("#tOpen").onclick=function(){ self._chooseFile(n,"open",function(path){ if(path==null) return; var c=F.read(fs,path); if(c==null){ alert("Datei nicht gefunden."); return; } state.file=path; ta.value=c; setTitle(); }); };
    mount.querySelector("#tSave").onclick=function(){ if(state.file){ F.write(fs,state.file,ta.value); self._changed(); } else mount.querySelector("#tSaveAs").click(); };
    mount.querySelector("#tSaveAs").onclick=function(){ self._chooseFile(n,"save",function(path){ if(!path) return; F.write(fs,path,ta.value); state.file=path; self._changed(); setTitle(); }); };
    setTitle();
  };
  /* ---- Bildbetrachter ---- */
  FiliusView.prototype._appImageViewer=function(n, mount, card){
    var self=this, F=E.fs, fs=F.of(n);
    mount.innerHTML='<div style="margin-bottom:8px"><button class="fv-btn" id="ivOpen" style="width:100%">Öffnen</button></div><div id="ivBox" style="text-align:center"></div>';
    mount.querySelector("#ivOpen").onclick=function(){ self._chooseFile(n,"open",function(path){ if(!path) return; var c=F.read(fs,path); if(c==null) return; card.querySelector(".fv-appwin-tb .t").textContent=F.base(path); var box=mount.querySelector("#ivBox"); if(/^data:image\//i.test(c)){ box.innerHTML='<img style="max-width:100%;max-height:320px">'; box.querySelector("img").src=c; } else box.innerHTML='<div class="fv-hint">Kein anzeigbares Bild (nur importierte Bilddateien).</div>'; }, "image"); };
  };
  // Einfacher Datei-Auswahldialog (DMTNFileChooser-Ersatz)
  FiliusView.prototype._chooseFile=function(n, mode, cb, filter){
    var self=this, F=E.fs, fs=F.of(n), dir="/";
    function render(bg){
      var items=F.list(fs,dir).filter(function(it){ return it.dir || !filter || F.fileType(it.name)===filter; });
      var body='<h3>'+(mode==="save"?"Datei speichern":"Datei öffnen")+'</h3>'
        +'<div class="fv-frow"><span class="fv-hint">Ordner: '+esc(dir)+'</span><span style="flex:1"></span>'+(dir!=="/"?'<button class="fv-btn" id="chUp">⬆️ aufwärts</button>':'')+'</div>'
        +'<div class="fv-list" style="max-height:220px">'+(items.length?items.map(function(it){ return '<div class="it" data-p="'+esc(it.path)+'" data-d="'+(it.dir?1:0)+'">'+(it.dir?"📁 ":"📄 ")+esc(it.name)+'</div>'; }).join(""):'<div class="fv-hint" style="padding:8px">(leer)</div>')+'</div>'
        +'<div class="fv-frow" style="margin-top:8px"><label class="cap" style="width:auto">Dateiname:</label><input class="fv-in" id="chName" value=""></div>'
        +'<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="fv-btn" id="chX">Abbrechen</button><button class="fv-btn primary" id="chOk">'+(mode==="save"?"Speichern":"Öffnen")+'</button></div>';
      bg.querySelector(".fv-dlg").innerHTML=body;
      if(dir!=="/") bg.querySelector("#chUp").onclick=function(){ dir=F.parent(dir); render(bg); };
      bg.querySelectorAll("[data-p]").forEach(function(it){ it.onclick=function(){ if(it.dataset.d==="1"){ dir=it.dataset.p; render(bg); } else { bg.querySelector("#chName").value=F.base(it.dataset.p); } }; });
      bg.querySelector("#chX").onclick=bg._close;
      bg.querySelector("#chOk").onclick=function(){ var nm=bg.querySelector("#chName").value.trim(); bg._close(); cb(nm?F.resolve(dir,nm):null); };
    }
    this._dialog("<div></div>", function(bg){ render(bg); });
  };

  /* ---- Webbrowser ---- */
  FiliusView.prototype._appBrowser=function(n, mount, card){
    var self=this;
    mount.innerHTML='<div style="display:flex;gap:6px;margin-bottom:8px"><input class="fv-in" id="brUrl" value="http://" style="flex:1"><button class="fv-btn primary" id="brGo">Start</button></div>'
      +'<div id="brView" style="border:1px solid var(--line);border-radius:8px;background:#fff;color:#111;min-height:260px;max-height:320px;overflow:auto;padding:12px"><div style="text-align:center;color:#888">Waterwolf – gib eine Adresse ein.</div></div>';
    function go(){ var url=mount.querySelector("#brUrl").value.trim(); var view=mount.querySelector("#brView"); if(!url||url==="http://"){ return; }
      var r=E.fetchWebByName(self.data, n.id, url); self._flashNet(n.id);
      if(r.ok){ view.innerHTML=escHtmlSafe(r.html); var m=String(r.html).match(/<title>([^<]*)<\/title>/i); card.querySelector(".fv-appwin-tb .t").textContent="Webbrowser"+(m?(" - "+m[1]):""); }
      else view.innerHTML='<div style="color:#b00"><h3>Fehler</h3><p>'+esc(r.error)+'</p></div>';
    }
    mount.querySelector("#brGo").onclick=go; mount.querySelector("#brUrl").addEventListener("keydown",function(e){ if(e.key==="Enter") go(); });
  };

  /* ---- DNS-Server ---- */
  FiliusView.prototype._appDns=function(n, mount){
    var self=this; n.dnsRecords=n.dnsRecords||[]; n.dnsMx=n.dnsMx||[]; n.dnsNs=n.dnsNs||[];
    var tab=this._dnsTab||"a";
    function render(){
      mount.innerHTML='<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><button class="fv-btn" id="dStart">'+(n.dnsActive?"Beenden":"Starten")+'</button><label class="fv-chk"><input type="checkbox" id="dRec" '+(n.dnsRecursive?"checked":"")+'> rekursive Auflösung</label></div>'
        +'<div class="fv-tabs"><button class="fv-tab'+(tab==="a"?" on":"")+'" data-t="a">Adressen (A)</button><button class="fv-tab'+(tab==="mx"?" on":"")+'" data-t="mx">Mailaustausch (MX)</button><button class="fv-tab'+(tab==="ns"?" on":"")+'" data-t="ns">Nameserver (NS)</button></div><div id="dBody"></div>';
      mount.querySelector("#dStart").onclick=function(){ n.dnsActive=!n.dnsActive; self._changed(); render(); };
      mount.querySelector("#dRec").onchange=function(){ n.dnsRecursive=this.checked; self._changed(); };
      mount.querySelectorAll("[data-t]").forEach(function(b){ b.onclick=function(){ self._dnsTab=b.dataset.t; tab=b.dataset.t; render(); }; });
      var body=mount.querySelector("#dBody");
      if(tab==="a") tblEditor(body, n.dnsRecords, [["name","Host-/Domainname","www.filius.de"],["ip","IP-Adresse","192.168.0.10"]]);
      else if(tab==="mx") tblEditor(body, n.dnsMx, [["domain","Maildomain","filius.de"],["server","Mailserver","mail.filius.de"]]);
      else tblEditor(body, n.dnsNs, [["domain","Domain","filius.de"],["ns","Nameserver","dns.filius.de"]]);
    }
    function tblEditor(body, arr, cols){
      var rows=arr.map(function(r,i){ return '<tr>'+cols.map(function(c){ return '<td>'+esc(r[c[0]]||"")+'</td>'; }).join("")+'<td><button class="fv-btn" data-del="'+i+'">✕</button></td></tr>'; }).join("");
      body.innerHTML='<table class="fv-tbl"><thead><tr>'+cols.map(function(c){ return '<th>'+c[1]+'</th>'; }).join("")+'<th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="'+(cols.length+1)+'" class="fv-hint">Keine Einträge.</td></tr>')+'</tbody></table>'
        +'<div class="fv-frow" style="margin-top:8px">'+cols.map(function(c){ return '<input class="fv-in" data-new="'+c[0]+'" placeholder="'+c[2]+'">'; }).join("")+'<button class="fv-btn primary" id="dAdd">Hinzufügen</button></div>';
      body.querySelector("#dAdd").onclick=function(){ var o={}; cols.forEach(function(c){ o[c[0]]=(body.querySelector('[data-new="'+c[0]+'"]').value||"").trim(); }); if(cols.every(function(c){ return o[c[0]]; })){ arr.push(o); self._changed(); render(); } };
      body.querySelectorAll("[data-del]").forEach(function(b){ b.onclick=function(){ arr.splice(+b.dataset.del,1); self._changed(); render(); }; });
    }
    render();
  };

  /* ---- Webserver ---- */
  FiliusView.prototype._appWebserver=function(n, mount){
    var self=this, F=E.fs, fs=F.of(n); if(F.read(fs,"/webserver/index.html")==null) F.write(fs,"/webserver/index.html", DEFAULT_INDEX);
    if(n.webActive===undefined) n.webActive=true; n.vhosts=n.vhosts||[];
    function render(){
      mount.innerHTML='<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><button class="fv-btn" id="wStart">'+(n.webActive?"Anhalten":"Starten")+'</button><label class="fv-chk"><input type="checkbox" id="wVh" '+(n.useVhost?"checked":"")+'> Verwende virtuelle Hosts</label></div>'
        +(n.useVhost?'<div id="wVhBox" style="margin-bottom:8px"></div>':'')
        +'<div class="fv-hint" style="margin-bottom:6px">Startseite: <code>/webserver/index.html</code></div>'
        +'<button class="fv-btn" id="wEdit">Startseite bearbeiten</button>'
        +'<div id="wEditBox" style="margin-top:8px"></div>';
      mount.querySelector("#wStart").onclick=function(){ n.webActive=!n.webActive; self._changed(); render(); };
      mount.querySelector("#wVh").onchange=function(){ n.useVhost=this.checked; self._changed(); render(); };
      if(n.useVhost){ var vb=mount.querySelector("#wVhBox"); n.vhosts=n.vhosts.length?n.vhosts:[{host:"",dir:""}];
        vb.innerHTML='<table class="fv-tbl"><thead><tr><th>Hostname</th><th>Unterverzeichnis</th><th></th></tr></thead><tbody>'+n.vhosts.map(function(v,i){ return '<tr><td><input data-v="'+i+'" data-f="host" value="'+esc(v.host||"")+'"></td><td><input data-v="'+i+'" data-f="dir" value="'+esc(v.dir||"")+'"></td><td><button class="fv-btn" data-vd="'+i+'">✕</button></td></tr>'; }).join("")+'</tbody></table><button class="fv-btn" id="wVhAdd" style="margin-top:6px">+ Host</button>';
        vb.querySelector("#wVhAdd").onclick=function(){ n.vhosts.push({host:"",dir:""}); self._changed(); render(); };
        vb.querySelectorAll("[data-vd]").forEach(function(b){ b.onclick=function(){ n.vhosts.splice(+b.dataset.vd,1); self._changed(); render(); }; });
        vb.querySelectorAll("input[data-v]").forEach(function(inp){ inp.addEventListener("blur",function(){ var i=+inp.dataset.v; n.vhosts[i][inp.dataset.f]=inp.value.trim(); self._changed(); }); });
      }
      mount.querySelector("#wEdit").onclick=function(){ var box=mount.querySelector("#wEditBox"); var c=F.read(fs,"/webserver/index.html")||"";
        box.innerHTML='<textarea id="wTa" spellcheck="false" style="width:100%;min-height:150px;font-family:monospace;font-size:12px;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card);color:var(--ink)"></textarea><div style="text-align:right;margin-top:6px"><button class="fv-btn primary" id="wSave">💾 Speichern</button></div>';
        box.querySelector("#wTa").value=c;
        box.querySelector("#wSave").onclick=function(){ F.write(fs,"/webserver/index.html", box.querySelector("#wTa").value); self._changed(); var m=box.querySelector("#wSave"); m.textContent="✓ gespeichert"; setTimeout(function(){ m.textContent="💾 Speichern"; },1200); };
      };
    }
    render();
  };

  /* ---- E-Mail-Server ---- */
  FiliusView.prototype._appMailServer=function(n, mount){
    var self=this; n.maildomain=n.maildomain||"filius.de"; n.mailAccounts=n.mailAccounts||[]; n.mailboxes=n.mailboxes||{};
    if(n.mailActive===undefined) n.mailActive=true;
    var tab=this._msTab||"acc";
    function count(u){ return (n.mailboxes[String(u).toLowerCase()]||[]).length; }
    function render(){
      mount.innerHTML='<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><button class="fv-btn" id="mStart">'+(n.mailActive?"Anhalten":"Starten")+'</button><label class="cap" style="width:auto">Maildomain:</label><input class="fv-in" id="mDom" value="'+esc(n.maildomain)+'" '+(n.mailActive?"disabled":"")+'></div>'
        +'<div class="fv-tabs"><button class="fv-tab'+(tab==="new"?" on":"")+'" data-t="new">Neues Konto</button><button class="fv-tab'+(tab==="acc"?" on":"")+'" data-t="acc">Konten-Liste</button></div><div id="msBody"></div>';
      mount.querySelector("#mStart").onclick=function(){ n.mailActive=!n.mailActive; self._changed(); render(); };
      var dom=mount.querySelector("#mDom"); dom.addEventListener("blur",function(){ n.maildomain=dom.value.trim()||"filius.de"; self._changed(); });
      mount.querySelectorAll("[data-t]").forEach(function(b){ b.onclick=function(){ self._msTab=b.dataset.t; tab=b.dataset.t; render(); }; });
      var body=mount.querySelector("#msBody");
      if(tab==="new"){
        body.innerHTML='<div class="fv-frow"><label class="cap">Benutzername</label><input class="fv-in" id="msUser"></div><div class="fv-frow"><label class="cap">Passwort</label><input class="fv-in" id="msPass"></div><button class="fv-btn primary" id="msAdd">Konto erstellen</button>';
        body.querySelector("#msAdd").onclick=function(){ var u=body.querySelector("#msUser").value.trim(), p=body.querySelector("#msPass").value; if(!u||!p){ alert("Benutzername und Passwort angeben!"); return; } if(/\s/.test(u)){ alert("Der Benutzername darf keine Leerzeichen enthalten!"); return; } n.mailAccounts.push({user:u,pass:p}); self._changed(); alert("Das Benutzerkonto "+u+" wurde angelegt."); self._msTab="acc"; tab="acc"; render(); };
      } else {
        var rows=n.mailAccounts.map(function(a,i){ return '<tr><td>'+esc(a.user)+"@"+esc(n.maildomain)+'</td><td>'+count(a.user)+'</td><td><button class="fv-btn" data-del="'+i+'">✕</button></td></tr>'; }).join("");
        body.innerHTML='<table class="fv-tbl"><thead><tr><th>E-Mail Adresse</th><th>Anzahl Mails</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="3" class="fv-hint">Keine Konten.</td></tr>')+'</tbody></table>';
        body.querySelectorAll("[data-del]").forEach(function(b){ b.onclick=function(){ var a=n.mailAccounts[+b.dataset.del]; if(confirm("Konto '"+a.user+"' wirklich entfernen?")){ n.mailAccounts.splice(+b.dataset.del,1); self._changed(); render(); } }; });
      }
    }
    render();
  };

  /* ---- E-Mail-Programm ---- */
  FiliusView.prototype._appMailClient=function(n, mount, card){
    var self=this; n.sentMail=n.sentMail||[];
    function setup(){
      var a=n.emailAccount||{};
      mount.innerHTML='<div class="fv-cfg-title">✉️ Konto einrichten</div>'
        +'<div class="fv-frow"><label class="cap">Name</label><input class="fv-in" id="eName" value="'+esc(a.name||"")+'"></div>'
        +'<div class="fv-frow"><label class="cap">E-Mail-Adresse</label><input class="fv-in" id="eAddr" placeholder="bob@filius.de" value="'+esc(a.address||"")+'"></div>'
        +'<div class="fv-frow"><label class="cap">Benutzername</label><input class="fv-in" id="eUser" value="'+esc(a.user||"")+'"></div>'
        +'<div class="fv-frow"><label class="cap">Passwort</label><input class="fv-in" id="ePass" value="'+esc(a.pass||"")+'"></div>'
        +'<button class="fv-btn primary" id="eSave">Speichern</button>';
      mount.querySelector("#eSave").onclick=function(){ var addr=mount.querySelector("#eAddr").value.trim(); if(!/^[^@\s]+@[^@\s]+$/.test(addr)){ alert("Bitte eine gültige E-Mail-Adresse angeben."); return; }
        n.emailAccount={ name:mount.querySelector("#eName").value.trim(), address:addr, user:mount.querySelector("#eUser").value.trim()||addr.split("@")[0], pass:mount.querySelector("#ePass").value };
        self._changed(); main(); };
    }
    function main(){
      var acc=n.emailAccount;
      mount.innerHTML='<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap"><button class="fv-btn" id="eFetch"><img src="'+dg("email_emails_abholen.png")+'" style="width:16px;height:16px;vertical-align:-3px"> E-Mails abrufen</button><button class="fv-btn" id="eNew"><img src="'+dg("email_email_verfassen.png")+'" style="width:16px;height:16px;vertical-align:-3px"> Verfassen</button><button class="fv-btn" id="eAcc">Konto</button><span class="fv-hint" style="margin-left:auto">'+esc(acc.address)+'</span></div>'
        +'<div class="fv-tabs"><button class="fv-tab on" data-mt="in"><img src="'+dg("email_ordner_posteingang.png")+'">Posteingang</button><button class="fv-tab" data-mt="out"><img src="'+dg("email_ordner_gesendet.png")+'">Gesendete</button></div>'
        +'<div id="eList" class="fv-list" style="max-height:150px"></div><div id="eView" style="margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:8px;min-height:60px;background:#fff;color:#111"></div>';
      var folder="in"; var fetched=[];
      function fill(){
        var list=mount.querySelector("#eList"); var msgs = folder==="in"?fetched:n.sentMail;
        list.innerHTML = msgs.length? msgs.map(function(m,i){ return '<div class="it" data-i="'+i+'"><b>'+esc(folder==="in"?m.from:m.to)+'</b><span style="margin-left:8px">'+esc(m.subject)+'</span></div>'; }).join("") : '<div class="fv-hint" style="padding:8px">(leer)</div>';
        list.querySelectorAll("[data-i]").forEach(function(it){ it.onclick=function(){ var m=msgs[+it.dataset.i]; mount.querySelector("#eView").innerHTML='<div style="font-weight:800">'+esc(m.subject)+'</div><div class="fv-hint">von '+esc(m.from)+' an '+esc(m.to)+'</div><div style="white-space:pre-wrap;margin-top:6px">'+esc(m.body)+'</div>'; }; });
      }
      mount.querySelectorAll("[data-mt]").forEach(function(b){ b.onclick=function(){ folder=b.dataset.mt; mount.querySelectorAll("[data-mt]").forEach(function(x){ x.classList.toggle("on", x===b); }); fill(); }; });
      mount.querySelector("#eFetch").onclick=function(){ var r=E.mailFetch(self.data, n); self._flashNet(n.id); if(!r.ok){ mount.querySelector("#eView").innerHTML='<span style="color:#b00">'+esc(r.error)+'</span>'; return; } fetched=r.msgs.slice(); folder="in"; fill(); };
      mount.querySelector("#eAcc").onclick=setup;
      mount.querySelector("#eNew").onclick=function(){ compose(); };
      function compose(){
        mount.querySelector("#eView").innerHTML='<div class="fv-frow"><label class="cap" style="width:60px">An</label><input class="fv-in" id="cTo" placeholder="bert@filius.de"></div><div class="fv-frow"><label class="cap" style="width:60px">Betreff</label><input class="fv-in" id="cSub"></div><textarea class="fv-in" id="cBody" style="width:100%;min-height:60px"></textarea><div style="text-align:right;margin-top:6px"><button class="fv-btn primary" id="cSend">Senden</button> <span id="cMsg" class="fv-hint"></span></div>';
        mount.querySelector("#cSend").onclick=function(){ var to=mount.querySelector("#cTo").value.trim(), sub=mount.querySelector("#cSub").value, bd=mount.querySelector("#cBody").value; var r=E.mailSend(self.data, n, to, sub, bd); self._flashNet(n.id); var msg=mount.querySelector("#cMsg"); if(r.ok){ n.sentMail.push({from:acc.address,to:to,subject:sub||"(kein Betreff)",body:bd}); self._changed(); msg.textContent="✓ gesendet"; msg.style.color="green"; } else { msg.textContent="⚠ "+(r.error||"Fehler"); msg.style.color="#b00"; } };
      }
      fill();
    }
    if(n.emailAccount&&n.emailAccount.address) main(); else setup();
  };

  /* ---- Gnutella (P2P) ---- */
  FiliusView.prototype._appGnutella=function(n, mount){
    var self=this, F=E.fs, fs=F.of(n); F.mkdir(fs,"/peer2peer");
    var tab=this._gnTab||"search";
    function render(){
      mount.innerHTML='<div class="fv-tabs">'
        +'<button class="fv-tab'+(tab==="net"?" on":"")+'" data-t="net">Netzwerk</button>'
        +'<button class="fv-tab'+(tab==="search"?" on":"")+'" data-t="search">Suche</button>'
        +'<button class="fv-tab'+(tab==="files"?" on":"")+'" data-t="files">Dateien</button>'
        +'<button class="fv-tab'+(tab==="set"?" on":"")+'" data-t="set">Einstellungen</button></div><div id="gnBody"></div>';
      mount.querySelectorAll("[data-t]").forEach(function(b){ b.onclick=function(){ self._gnTab=b.dataset.t; tab=b.dataset.t; render(); }; });
      var body=mount.querySelector("#gnBody");
      if(tab==="search"){
        body.innerHTML='<div style="display:flex;gap:6px;margin-bottom:8px"><input class="fv-in" id="gnQ" placeholder="Suchbegriff (leer = alle)" style="flex:1"><button class="fv-btn primary" id="gnGo">Suchen</button></div><div id="gnRes"></div>';
        body.querySelector("#gnGo").onclick=function(){ var q=body.querySelector("#gnQ").value.trim(); var res=E.gnutellaSearch(self.data, n.id, q); self._flashNet(n.id); var box=body.querySelector("#gnRes");
          box.innerHTML = res.length? '<table class="fv-tbl"><thead><tr><th>IP-Adresse</th><th>Dateiname</th><th></th></tr></thead><tbody>'+res.map(function(r,i){ return '<tr><td>'+esc(r.ip)+'</td><td>'+esc(r.name)+'</td><td><button class="fv-btn" data-dl="'+i+'">⬇️ Laden</button></td></tr>'; }).join("")+'</tbody></table>' : '<div class="fv-hint">Nichts gefunden.</div>';
          box.querySelectorAll("[data-dl]").forEach(function(b){ b.onclick=function(){ var r=res[+b.dataset.dl]; var src=self._node(r.id); var c=src?E.fs.read(E.fs.of(src), r.path):null; F.mkdir(fs,"/peer2peer"); F.write(fs,"/peer2peer/"+r.name, c==null?"":c); self._changed(); alert("„"+r.name+"“ heruntergeladen."); }; });
        };
      } else if(tab==="files"){
        var items=F.list(fs,"/peer2peer");
        body.innerHTML='<div class="fv-hint" style="margin-bottom:6px">Geteilter Ordner <code>/peer2peer</code>:</div><table class="fv-tbl"><thead><tr><th>Dateiname</th><th>Dateityp</th></tr></thead><tbody>'+(items.length?items.map(function(it){ return '<tr><td>'+esc(it.name)+'</td><td>'+esc(F.fileType(it.name))+'</td></tr>'; }).join(""):'<tr><td colspan="2" class="fv-hint">Keine Dateien. (Über den Datei-Explorer in /peer2peer ablegen.)</td></tr>')+'</tbody></table>';
      } else if(tab==="net"){
        body.innerHTML='<div class="fv-hint">Gnutella verbindet Rechner zu einem Tauschnetz. Alle erreichbaren Rechner mit installiertem Gnutella und Dateien in <code>/peer2peer</code> werden bei der Suche gefunden.</div>';
      } else {
        body.innerHTML='<div class="fv-frow"><label class="cap" style="width:auto">Maximale Anzahl direkter Nachbarn:</label><input class="fv-in" id="gnMax" style="min-width:60px" value="'+esc(n.gnMax||4)+'"><button class="fv-btn primary" id="gnSave">Speichern</button></div>';
        body.querySelector("#gnSave").onclick=function(){ var v=parseInt(body.querySelector("#gnMax").value,10); if(v>0){ n.gnMax=v; self._changed(); } };
      }
    }
    render();
  };

  /* ---- Einfacher Client ---- */
  FiliusView.prototype._appClient=function(n, mount){
    var self=this; var connected=false, log=[];
    function paint(){ mount.querySelector("#clLog").textContent=log.join("\n"); }
    mount.innerHTML='<div class="fv-frow"><label class="cap">Server-Adresse</label><input class="fv-in" id="clAddr"></div>'
      +'<div class="fv-frow"><label class="cap">Server-Port</label><input class="fv-in" id="clPort" value="55555" style="min-width:80px"></div>'
      +'<button class="fv-btn" id="clConn">Verbinden</button>'
      +'<div class="fv-frow" style="margin-top:8px"><label class="cap">Nachricht</label><input class="fv-in" id="clMsg" value="Hallo Echo!" style="flex:1"></div>'
      +'<button class="fv-btn primary" id="clSend" disabled>Senden</button>'
      +'<pre id="clLog" style="margin-top:8px;background:#111;color:#dedede;border-radius:8px;padding:8px;min-height:80px;font-size:12px;white-space:pre-wrap"></pre>';
    var addr=mount.querySelector("#clAddr"), send=mount.querySelector("#clSend"), conn=mount.querySelector("#clConn");
    conn.onclick=function(){ if(connected){ connected=false; send.disabled=true; conn.textContent="Verbinden"; log.push("Verbindung getrennt"); paint(); return; }
      var r=E.echoTest(self.data, n.id, addr.value.trim()); self._flashNet(n.id);
      if(r.ok){ connected=true; send.disabled=false; conn.textContent="Trennen"; log.push("Verbindung hergestellt zu "+r.dstIp); } else { log.push("Fehler beim Verbindungsaufbau: "+(r.error||"")); } paint(); };
    send.onclick=function(){ var m=mount.querySelector("#clMsg").value; log.push("<< "+m); log.push(">> "+m); paint(); };
  };

  /* ---- Echo-Server ---- */
  FiliusView.prototype._appEcho=function(n, mount){
    var self=this; if(n.echoActive===undefined) n.echoActive=true;
    mount.innerHTML='<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><button class="fv-btn" id="ecBtn">'+(n.echoActive?"Anhalten":"Starten")+'</button><label class="cap" style="width:auto">Port:</label><input class="fv-in" id="ecPort" value="'+esc(n.echoPort||7)+'" style="min-width:70px"></div><pre style="background:#111;color:#dedede;border-radius:8px;padding:8px;min-height:120px;font-size:12px">Echo-Server '+(n.echoActive?"läuft ● (Port "+(n.echoPort||7)+")":"angehalten")+'.\nSchickt eingehende Nachrichten unverändert zurück.</pre>';
    mount.querySelector("#ecBtn").onclick=function(){ n.echoActive=!n.echoActive; self._changed(); self._renderDesk(n.id); };
    mount.querySelector("#ecPort").addEventListener("blur",function(){ var v=parseInt(this.value,10); if(v>0){ n.echoPort=v; self._changed(); } });
  };

  /* ---- Personal Firewall ---- */
  FiliusView.prototype._appFirewall=function(n, mount){
    var self=this;
    // Legacy-Firewall {on,blockPing,denyPorts} NICHT ins neue Modell "kippen" (sonst Fehlbewertung alter Netze).
    var f=n.firewall;
    var isNew = f && (Array.isArray(f.rules) || f.allowIcmp!==undefined || f.filterUdp!==undefined);
    if(!f){ f={on:false, allowIcmp:true, filterUdp:false, rules:[]}; }
    else if(!isNew){ // Legacy -> neues Modell, Bedeutung erhalten: blockPing→allowIcmp invers; denyPorts hatte keine Erlaubnis-Semantik
      f={ on:!!f.on, allowIcmp:!f.blockPing, filterUdp:false, rules:[] };
    }
    n.firewall=f; f.rules=f.rules||[];
    function render(){
      mount.innerHTML='<label class="fv-chk"><input type="checkbox" id="fwOn" '+(f.on?"checked":"")+'> Firewall aktivieren</label>'
        +'<div class="fv-hint" style="margin:2px 0 8px">Blockiert bei Aktivierung alle eingehenden Pakete außer den unten erlaubten Ports.</div>'
        +'<label class="fv-chk"><input type="checkbox" id="fwIcmp" '+(f.allowIcmp?"checked":"")+'> ICMP (Ping) erlauben</label>'
        +'<div style="height:8px"></div>'
        +'<div style="font-weight:800;font-size:12px;margin-bottom:4px">Erlaubte Ports:</div>'
        +'<table class="fv-tbl"><thead><tr><th>Port</th><th>Absender</th><th></th></tr></thead><tbody>'+(f.rules.length?f.rules.map(function(r,i){ return '<tr><td>'+esc(r.port)+'</td><td>'+(r.scope==="lan"?"nur lokales Netz":"alle")+'</td><td><button class="fv-btn" data-del="'+i+'">✕</button></td></tr>'; }).join(""):'<tr><td colspan="3" class="fv-hint">Keine Ausnahmen.</td></tr>')+'</tbody></table>'
        +'<div class="fv-frow" style="margin-top:8px"><input class="fv-in" id="fwPort" placeholder="Port (z. B. 80)" style="min-width:110px"><select class="fv-in" id="fwScope"><option value="all">alle Absender</option><option value="lan">nur lokales Netz</option></select><button class="fv-btn primary" id="fwAdd">Hinzufügen</button></div>';
      mount.querySelector("#fwOn").onchange=function(){ f.on=this.checked; self._changed(); };
      mount.querySelector("#fwIcmp").onchange=function(){ f.allowIcmp=this.checked; self._changed(); };
      mount.querySelector("#fwAdd").onclick=function(){ var p=mount.querySelector("#fwPort").value.trim(); if(!p) return; f.rules.push({port:p, scope:mount.querySelector("#fwScope").value}); self._changed(); render(); };
      mount.querySelectorAll("[data-del]").forEach(function(b){ b.onclick=function(){ f.rules.splice(+b.dataset.del,1); self._changed(); render(); }; });
    }
    render();
  };

  /* ---- Kontextmenü im Simulationsmodus ---- */
  FiliusView.prototype._simNodeMenu=function(ev,n){
    var self=this, items=[];
    if(isHost(n.type)) items.push({label:"Desktop anzeigen", fn:function(){ self._openDesk(n.id); }});
    if(n.type==="switch") items.push({label:"SAT-Tabelle anzeigen", fn:function(){ self._satViewer(n); }});
    if(isRouter(n.type)) items.push({label:"Weiterleitungstabelle anzeigen", fn:function(){ self._routerViewer(n); }});
    items.push({label:"Datenaustausch anzeigen", fn:function(){ self._exchangeDialog(n); }});
    this._menu(ev.clientX, ev.clientY, items);
  };

  /* ============================ Öffentliche API ========================= */
  FiliusView.prototype.getData=function(){ return { nodes:this.data.nodes, links:this.data.links }; };
  FiliusView.prototype.setData=function(d){ this._stopSim(); this._closeAllDesks(); this._removeCursorImg(); this.tool="select"; this._setStatus&&this._setStatus("");
    this.data=normalizeNet(d); this.sel=[]; this.selLink=null; this.cable=null; this.cfgNode=null;
    this._els={}; this._cableEls={}; this._packet=null; if(this.svg) this.svg.innerHTML=""; this.cv&&this.cv.querySelectorAll(".fv-node").forEach(function(e){ e.remove(); });
    this._closeConfig&&this._closeConfig(); this.render(); };
  FiliusView.prototype.setReadonly=function(ro){ this._stopSim(); this._closeAllDesks(); this._packet=null; this.readonly=!!ro; this._build(); };
  FiliusView.prototype.destroy=function(){ try{ if(this._anim) clearInterval(this._anim); }catch(e){} try{ if(this._pingTimer) clearInterval(this._pingTimer); }catch(e){} this._closeAllDesks();
    try{ document.removeEventListener("keydown", this._keyh); }catch(e){} try{ document.removeEventListener("pointerdown", this._docDown, true); }catch(e){}
    this._removeCursorImg&&this._removeCursorImg(); this._closeCtx&&this._closeCtx(); if(this.host) this.host.innerHTML=""; };

  FiliusView.ensureStyles=injectStyles;
  window.FiliusView=FiliusView;
})();
