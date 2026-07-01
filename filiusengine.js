"use strict";
/* ============================================================================
   Filius-Engine – Netzwerksimulator (Design + Simulation) im Browser
   Angelehnt an FILIUS (Uni Siegen). Reine Neu-Implementierung fürs Web,
   passend zum Design des Klassenzimmers – ohne Java/Applet.

   - FiliusEngine : reine Logik (IP-Rechnen, L2-Domänen, L3-Routing, Ping,
                    DNS, Webserver, DHCP, Prüfungen/Checks)
   - FiliusView   : Editor + Simulation (Canvas mit Drag&Drop, Kabel,
                    Konfigurations-Dialoge, Host-Konsole mit Befehlszeile)

   Netz-Datenmodell (JSON):
   {
     nodes: [ { id, type, x, y, name, ...typ-spezifisch } ],
     links: [ { id, a, b } ]
   }
   Typen: 'notebook' | 'rechner' | 'switch' | 'router' | 'text'
   Host  (notebook/rechner): ip, mask, gateway, dns, useDhcp, ipAsName,
         apps{webbrowser,webserver,dns,dhcp,echo}, web{pages}, dnsRecords[],
         dnsMx[], dhcpFrom,dhcpTo,dhcpGw,dhcpDns
   Router: ifs{ [linkId]:{ip,mask} }, autoRoute(bool), routes[{dest,mask,nextHop}]
   Text  : text
   ============================================================================ */
(function(){

  /* ---------------- IP-Hilfen ---------------- */
  function ipToInt(s){
    if(typeof s!=="string") return null;
    var m=s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if(!m) return null;
    var n=0;
    for(var i=1;i<=4;i++){ var o=+m[i]; if(o<0||o>255) return null; n=(n*256)+o; }
    return n>>>0;
  }
  function intToIp(n){ n=n>>>0; return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join("."); }
  function validIp(s){ return ipToInt(s)!==null; }
  function parseMask(m){
    if(m==null) return null;
    m=String(m).trim().replace(/^\//,"");
    if(/^\d{1,2}$/.test(m)){ var p=+m; if(p<0||p>32) return null; return p===0?0:((0xFFFFFFFF<<(32-p))>>>0); }
    var v=ipToInt(m); if(v===null) return null;
    // Gültige Maske? (zusammenhängende 1-Bits) – wir akzeptieren auch krumme, nutzen sie aber wie gegeben
    return v>>>0;
  }
  function maskLen(intMask){ var n=intMask>>>0, c=0; for(var i=0;i<32;i++){ if(n&0x80000000) c++; else break; n=(n<<1)>>>0; } return c; }
  function sameNet(ip1, ip2, mask){
    var a=ipToInt(ip1), b=ipToInt(ip2), m=parseMask(mask);
    if(a===null||b===null||m===null) return false;
    return ((a&m)>>>0)===((b&m)>>>0);
  }
  function netAddr(ip, mask){ var a=ipToInt(ip), m=parseMask(mask); if(a===null||m===null) return null; return (a&m)>>>0; }

  /* ---------------- DSU (Union-Find) für Broadcast-Domänen ---------------- */
  function DSU(){ this.p={}; }
  DSU.prototype.find=function(x){ if(this.p[x]===undefined) this.p[x]=x; while(this.p[x]!==x){ this.p[x]=this.p[this.p[x]]; x=this.p[x]; } return x; };
  DSU.prototype.union=function(a,b){ var ra=this.find(a), rb=this.find(b); if(ra!==rb) this.p[ra]=rb; };

  function isHost(t){ return t==="notebook"||t==="rechner"; }

  /* ---------------- Netz analysieren (Topologie, Domänen, DHCP) ---------------- */
  function analyze(net){
    net=net||{}; var nodes=net.nodes||[], links=net.links||[];
    var byId={}; nodes.forEach(function(n){ byId[n.id]=n; });
    // Endpunkt-Schlüssel: Router werden pro Kabel getrennt (L2-Grenze), Hosts/Switches je ein Knoten
    function epKey(nodeId, linkId){ var n=byId[nodeId]; if(n && n.type==="router") return "r:"+nodeId+":"+linkId; return "n:"+nodeId; }
    var dsu=new DSU();
    // sicherstellen, dass jeder Host/Switch als Domäne existiert
    nodes.forEach(function(n){ if(isHost(n.type)||n.type==="switch") dsu.find("n:"+n.id); });
    links.forEach(function(l){ if(!byId[l.a]||!byId[l.b]) return; dsu.union(epKey(l.a,l.id), epKey(l.b,l.id)); });

    // Router-Interfaces je Kabel
    var routerLinks={};   // routerId -> [linkId,...]
    links.forEach(function(l){ [l.a,l.b].forEach(function(id){ var n=byId[id]; if(n&&n.type==="router"){ (routerLinks[id]=routerLinks[id]||[]).push(l.id); } }); });

    var A={ net:net, byId:byId, links:links, hostDomain:{}, domHosts:{}, domRifs:{}, routerIfDom:{}, host:{}, routerLinks:routerLinks };

    // statische Host-Konfiguration
    nodes.forEach(function(n){ if(!isHost(n.type)) return;
      A.host[n.id]={ ip:(n.ip&&validIp(n.ip))?n.ip:null, mask:n.mask||"255.255.255.0", gateway:n.gateway||null, dns:n.dns||null, dhcp:!!n.useDhcp };
      var d=dsu.find("n:"+n.id); A.hostDomain[n.id]=d; (A.domHosts[d]=A.domHosts[d]||[]).push(n.id);
    });
    // Router-Interfaces den Domänen zuordnen
    Object.keys(routerLinks).forEach(function(rid){ var r=byId[rid]; var ifs=r.ifs||{};
      A.routerIfDom[rid]={};
      routerLinks[rid].forEach(function(linkId){ var d=dsu.find("r:"+rid+":"+linkId); A.routerIfDom[rid][linkId]=d;
        var cfg=ifs[linkId]||{}; if(cfg.ip&&validIp(cfg.ip)) (A.domRifs[d]=A.domRifs[d]||[]).push({router:rid, linkId:linkId, ip:cfg.ip, mask:cfg.mask||"255.255.255.0"});
      });
    });

    // DHCP: je Domäne einen laufenden DHCP-Server suchen, useDhcp-Hosts befüllen
    Object.keys(A.domHosts).forEach(function(dom){
      var members=A.domHosts[dom];
      var srv=null;
      members.forEach(function(hid){ var n=byId[hid]; if(n.apps&&n.apps.dhcp && A.host[hid].ip && n.dhcpFrom&&n.dhcpTo && validIp(n.dhcpFrom)&&validIp(n.dhcpTo)) srv=n; });
      if(!srv) return;
      var from=ipToInt(srv.dhcpFrom), to=ipToInt(srv.dhcpTo);
      var taken={}; members.forEach(function(hid){ var c=A.host[hid]; if(c.ip && !c.dhcp) taken[ipToInt(c.ip)]=1; });
      var cur=from;
      members.forEach(function(hid){ var c=A.host[hid]; if(!c.dhcp) return;
        while(cur<=to && taken[cur]) cur++;
        if(cur>to){ c.ip=null; return; }
        taken[cur]=1;
        c.ip=intToIp(cur); c.mask=srv.mask||"255.255.255.0";
        c.gateway=srv.dhcpGw||srv.gateway||null; c.dns=srv.dhcpDns||srv.dns||null;
        cur++;
      });
    });

    // Router-Nachbarschaftsgraph (für automatisches Routing)
    A.routerNeighbors={};   // rid -> [{router, viaIp}]
    Object.keys(A.domRifs).forEach(function(dom){
      var rifs=A.domRifs[dom];
      for(var i=0;i<rifs.length;i++) for(var j=0;j<rifs.length;j++){
        if(i===j) continue; if(rifs[i].router===rifs[j].router) continue;
        (A.routerNeighbors[rifs[i].router]=A.routerNeighbors[rifs[i].router]||[]).push({router:rifs[j].router, viaIp:rifs[j].ip});
      }
    });
    return A;
  }

  function findHostInDomain(A, dom, ip){ var arr=A.domHosts[dom]||[]; for(var i=0;i<arr.length;i++){ if(A.host[arr[i]].ip===ip) return arr[i]; } return null; }
  function findRifInDomain(A, dom, ip, exclude){ var arr=A.domRifs[dom]||[]; for(var i=0;i<arr.length;i++){ if(arr[i].ip===ip && arr[i].router!==exclude) return arr[i]; } return null; }
  // Ziel-Endpunkt in einer Domäne: Host ODER Router-Interface (Router antwortet auf seine Interface-IP)
  function findEndpointInDomain(A, dom, ip){ var h=findHostInDomain(A,dom,ip); if(h) return {id:h, isRouter:false}; var arr=A.domRifs[dom]||[]; for(var i=0;i<arr.length;i++){ if(arr[i].ip===ip) return {id:arr[i].router, isRouter:true}; } return null; }
  function routerHasNet(A, rid, dstIp){ var m=A.routerIfDom[rid]||{}, r=A.byId[rid], ifs=(r&&r.ifs)||{}; for(var lk in m){ var cfg=ifs[lk]; if(cfg&&cfg.ip&&sameNet(cfg.ip,dstIp,cfg.mask||"255.255.255.0")) return lk; } return null; }

  function autoNextHop(A, rid, dstIp){
    // BFS über Router-Nachbarn zum nächsten Router, der dstIp direkt anschließt
    var start=rid, seen={}; seen[rid]=true;
    var q=[{r:rid, first:null}];
    while(q.length){
      var cur=q.shift();
      if(cur.r!==start && routerHasNet(A, cur.r, dstIp)) return cur.first;
      var nb=A.routerNeighbors[cur.r]||[];
      for(var i=0;i<nb.length;i++){ if(seen[nb[i].router]) continue; seen[nb[i].router]=true;
        q.push({r:nb[i].router, first: cur.first||nb[i].viaIp}); }
    }
    return null;
  }

  function routerForward(A, rid, dstIp, hops, visited, depth){
    if(depth>32) return {ok:false, error:"Routing-Schleife"};
    if(visited[rid]) return {ok:false, error:"Routing-Schleife"};
    visited[rid]=true;
    var r=A.byId[rid], ifs=(r&&r.ifs)||{}, m=A.routerIfDom[rid]||{};
    // direkt angeschlossenes Netz?
    var direct=routerHasNet(A, rid, dstIp);
    if(direct){ var dom=m[direct]; var t=findEndpointInDomain(A, dom, dstIp); if(t){ hops.push(dstIp); return {ok:true, hops:hops, dstNodeId:t.id, isRouter:t.isRouter}; } return {ok:false, error:"Ziel im Zielnetz nicht gefunden"}; }
    // Route bestimmen
    var nextHop=null;
    if(r.autoRoute!==false){ nextHop=autoNextHop(A, rid, dstIp); }
    else { var routes=r.routes||[]; for(var i=0;i<routes.length;i++){ var ro=routes[i]; if(ro.dest&&ro.mask&&ro.nextHop&&sameNet(ro.dest,dstIp,ro.mask)){ nextHop=ro.nextHop; break; } } }
    if(!nextHop) return {ok:false, error:"Keine Route zum Zielnetz"};
    for(var lk in m){ var nb=findRifInDomain(A, m[lk], nextHop, rid); if(nb){ hops.push(nextHop); return routerForward(A, nb.router, dstIp, hops, visited, depth+1); } }
    return {ok:false, error:"Next-Hop nicht erreichbar"};
  }

  // L3-Erreichbarkeit von Host srcId zu dstIp
  function l3(A, srcId, dstIp){
    var src=A.host[srcId];
    if(!src||!src.ip) return {ok:false, error:"Quelle hat keine IP-Adresse"};
    if(dstIp===src.ip) return {ok:true, hops:[dstIp], dstNodeId:srcId};
    var dom=A.hostDomain[srcId];
    if(sameNet(src.ip, dstIp, src.mask)){
      var t=findEndpointInDomain(A, dom, dstIp);
      if(t) return {ok:true, hops:[dstIp], dstNodeId:t.id, isRouter:t.isRouter};
      return {ok:false, error:"Zielrechner im eigenen Netz nicht erreichbar"};
    }
    if(!src.gateway) return {ok:false, error:"Kein Gateway gesetzt"};
    if(!sameNet(src.ip, src.gateway, src.mask)) return {ok:false, error:"Gateway liegt nicht im eigenen Netz"};
    var gw=findRifInDomain(A, dom, src.gateway, null);
    if(!gw) return {ok:false, error:"Gateway nicht erreichbar"};
    var hops=[src.gateway];
    return routerForward(A, gw.router, dstIp, hops, {}, 0);
  }

  // Beidseitige Erreichbarkeit: Anfrage src->dst UND Antwort dst->src (Ziel braucht auch ein Gateway)
  function reach2(A, srcId, dstIp){
    var f=l3(A, srcId, dstIp);
    if(!f.ok) return f;
    if(f.dstNodeId===srcId || f.isRouter) return f;   // localhost oder Router (antwortet direkt auf seiner Interface-IP)
    var srcIp=A.host[srcId]?A.host[srcId].ip:null;
    if(!srcIp) return {ok:false, error:"Quelle hat keine IP-Adresse"};
    var back=l3(A, f.dstNodeId, srcIp);
    if(!back.ok) return {ok:false, error:"Rückweg nicht möglich ("+(back.error||"Gateway am Ziel fehlt?")+")", hops:f.hops, dstNodeId:f.dstNodeId};
    return f;
  }

  // physischer Pfad (für Animation): BFS über Kabel-Graph (ohne Textfelder)
  function physicalPath(A, srcId, dstId){
    if(srcId===dstId) return [srcId];
    var adj={}; A.links.forEach(function(l){ if(!A.byId[l.a]||!A.byId[l.b]) return; if(A.byId[l.a].type==="text"||A.byId[l.b].type==="text") return; (adj[l.a]=adj[l.a]||[]).push(l.b); (adj[l.b]=adj[l.b]||[]).push(l.a); });
    var prev={}, seen={}; seen[srcId]=true; var q=[srcId];
    while(q.length){ var c=q.shift(); if(c===dstId){ var path=[dstId], p=dstId; while(prev[p]!==undefined){ p=prev[p]; path.unshift(p); } return path; }
      (adj[c]||[]).forEach(function(nx){ if(!seen[nx]){ seen[nx]=true; prev[nx]=c; q.push(nx); } }); }
    return null;
  }

  /* ---------------- Namensauflösung / Dienste ---------------- */
  function nodeByName(net, name){ if(!name) return null; name=String(name).trim().toLowerCase(); var ns=net.nodes||[]; for(var i=0;i<ns.length;i++){ if(String(ns[i].name||"").trim().toLowerCase()===name) return ns[i]; } return null; }
  function hostIp(A, node){ return node? (A.host[node.id]?A.host[node.id].ip:null) : null; }

  // DNS-Auflösung von srcId aus: name -> ip (über konfigurierten DNS-Server)
  function resolveName(A, srcId, name){
    if(validIp(name)) return name;
    var src=A.host[srcId]; if(!src||!src.dns) return null;
    // DNS-Server erreichbar?
    var r=reach2(A, srcId, src.dns); if(!r.ok) return null;
    var srvNode=A.byId[r.dstNodeId];
    if(!srvNode||!(srvNode.apps&&srvNode.apps.dns)) return null;
    var recs=srvNode.dnsRecords||[];
    for(var i=0;i<recs.length;i++){ if(String(recs[i].name||"").trim().toLowerCase()===String(name).trim().toLowerCase() && validIp(recs[i].ip)) return recs[i].ip; }
    return null;
  }

  // Ping: {ok, error, path:[nodeIds], hops:[ip], target}
  function ping(A, srcId, target){
    var dstIp = validIp(target)? target : resolveName(A, srcId, target);
    if(!dstIp) return {ok:false, error:"Name konnte nicht aufgelöst werden", path:null, hops:[]};
    var r=reach2(A, srcId, dstIp);
    r.target=dstIp;
    if(r.ok) r.path=physicalPath(A, srcId, r.dstNodeId)||[srcId, r.dstNodeId];
    return r;
  }

  // Webseite abrufen: {ok, html, error}
  function fetchWeb(A, srcId, url){
    var m=String(url||"").trim().replace(/^https?:\/\//i,"");
    var slash=m.indexOf("/"); var hostPart=slash<0?m:m.slice(0,slash); var path=slash<0?"/":m.slice(slash);
    if(!hostPart) return {ok:false, error:"Ungültige URL"};
    var ip=validIp(hostPart)?hostPart:resolveName(A, srcId, hostPart);
    if(!ip) return {ok:false, error:"Server-Name konnte nicht aufgelöst werden"};
    var r=reach2(A, srcId, ip); if(!r.ok) return {ok:false, error:"Server nicht erreichbar ("+r.error+")"};
    var srv=A.byId[r.dstNodeId];
    if(!srv||!(srv.apps&&srv.apps.webserver)) return {ok:false, error:"Auf dem Zielrechner läuft kein Webserver"};
    var pages=(srv.web&&srv.web.pages)||{}; var page=pages[path]||pages[path.replace(/\/$/,"")]||pages["/"]||pages["/index.html"];
    if(page==null) return {ok:false, error:"Seite nicht gefunden (404)"};
    return {ok:true, html:page, ip:ip, server:srv.name};
  }

  /* ---------------- Prüfungen / Checks ---------------- */
  var CHECK_TYPES={
    ping:   { label:"Ping erreichbar", desc:"Von A wird B per Ping erreicht",
      fields:[{k:"from",label:"Von (Rechnername)",ph:"z. B. PC1"},{k:"to",label:"Nach (Name oder IP)",ph:"z. B. PC2 oder 192.168.0.11"}] },
    noping: { label:"NICHT erreichbar", desc:"A darf B NICHT per Ping erreichen",
      fields:[{k:"from",label:"Von (Rechnername)",ph:"z. B. PC1"},{k:"to",label:"Nach (Name oder IP)",ph:"z. B. Server"}] },
    count:  { label:"Anzahl Komponenten", desc:"mindestens N Komponenten eines Typs",
      fields:[{k:"ntype",label:"Typ",type:"select",opts:[["notebook","Notebook"],["rechner","Rechner"],["switch","Switch"],["router","Router"],["host","Rechner/Notebook"]]},{k:"min",label:"mindestens",type:"number",ph:"z. B. 3"}] },
    ip_in_net:{ label:"IP im Netz", desc:"Rechner hat eine IP im angegebenen Netz",
      fields:[{k:"node",label:"Rechnername",ph:"z. B. PC1"},{k:"net",label:"Netz (CIDR)",ph:"z. B. 192.168.0.0/24"}] },
    web:    { label:"Webseite erreichbar", desc:"Browser erreicht die Webseite",
      fields:[{k:"from",label:"Browser auf (Name)",ph:"z. B. PC1"},{k:"url",label:"URL",ph:"z. B. http://www.filius.de"}] },
    dns:    { label:"DNS löst auf", desc:"DNS-Server löst Namen zu IP auf",
      fields:[{k:"server",label:"DNS-Server (Name)",ph:"z. B. DNS"},{k:"name",label:"Domainname",ph:"z. B. www.filius.de"},{k:"ip",label:"soll-IP",ph:"z. B. 192.168.0.12"}] }
  };
  function checkLabel(c){
    var t=CHECK_TYPES[c.type]; var p=c.params||{};
    if(!t) return c.label||"Prüfung";
    if(c.type==="ping") return "Ping: "+(p.from||"?")+" → "+(p.to||"?");
    if(c.type==="noping") return "Keine Verbindung: "+(p.from||"?")+" ⇸ "+(p.to||"?");
    if(c.type==="count"){ var nm={notebook:"Notebooks",rechner:"Rechner",switch:"Switches",router:"Router",host:"Rechner/Notebooks"}; return "mind. "+(p.min||1)+" "+(nm[p.ntype]||"Komponenten"); }
    if(c.type==="ip_in_net") return (p.node||"?")+" hat IP in "+(p.net||"?");
    if(c.type==="web") return "Webseite "+(p.url||"?")+" (von "+(p.from||"?")+")";
    if(c.type==="dns") return "DNS: "+(p.name||"?")+" → "+(p.ip||"?");
    return t.label;
  }
  function evalCheck(net, A, c){
    var p=c.params||{};
    try{
      if(c.type==="count"){ var min=Math.max(1,+p.min||1); var cnt=0; (net.nodes||[]).forEach(function(n){ if(p.ntype==="host"){ if(isHost(n.type)) cnt++; } else if(n.type===p.ntype) cnt++; }); return cnt>=min; }
      if(c.type==="ip_in_net"){ var nd=nodeByName(net,p.node); if(!nd||!isHost(nd.type)) return false; var ip=hostIp(A,nd); if(!ip) return false; var parts=String(p.net||"").split("/"); var na=parts[0], mk=parts[1]||"24"; return sameNet(ip, na, mk) && ipToInt(ip)!==netAddr(ip,mk); }
      if(c.type==="ping"||c.type==="noping"){ var from=nodeByName(net,p.from); if(!from||!isHost(from.type)) return c.type==="noping"; var toIp=validIp(p.to)?p.to:hostIp(A,nodeByName(net,p.to)); if(!toIp){ toIp=resolveName(A, from.id, p.to); } if(!toIp) return c.type==="noping"; var r=ping(A, from.id, toIp); return c.type==="ping"? !!r.ok : !r.ok; }
      if(c.type==="web"){ var b=nodeByName(net,p.from); if(!b||!isHost(b.type)||!(b.apps&&b.apps.webbrowser)) return false; var w=fetchWeb(A, b.id, p.url); return !!w.ok; }
      if(c.type==="dns"){ var s=nodeByName(net,p.server); if(!s||!(s.apps&&s.apps.dns)) return false; var recs=s.dnsRecords||[]; for(var i=0;i<recs.length;i++){ if(String(recs[i].name||"").toLowerCase()===String(p.name||"").toLowerCase() && recs[i].ip===p.ip) return true; } return false; }
    }catch(e){ return false; }
    return false;
  }
  function evalChecks(net, checks){
    var A=analyze(net||{}); var out={};
    (checks||[]).forEach(function(c){ out[c.id]= evalCheck(net||{}, A, c) ? "correct" : "wrong"; });
    return out;
  }

  var FiliusEngine={
    blank:function(){ return {nodes:[], links:[]}; },
    ipToInt:ipToInt, intToIp:intToIp, validIp:validIp, parseMask:parseMask, maskLen:maskLen, sameNet:sameNet, netAddr:netAddr,
    analyze:analyze, l3:l3, ping:ping, resolveName:resolveName, fetchWeb:fetchWeb,
    CHECK_TYPES:CHECK_TYPES, checkLabel:checkLabel, evalCheck:function(net,c){ return evalCheck(net, analyze(net||{}), c); }, evalChecks:evalChecks,
    isHost:isHost,
    summary:function(net){ net=net||{}; var t={notebook:0,rechner:0,switch:0,router:0}; (net.nodes||[]).forEach(function(n){ if(t[n.type]!=null) t[n.type]++; }); return t; }
  };
  window.FiliusEngine=FiliusEngine;

  /* ============================================================================
     FiliusView – Editor + Simulation
     ============================================================================ */
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function escHtmlSafe(html){
    // Für die Webbrowser-Vorschau: erlaube einfache HTML-Tags, entferne script/style/on*-Attribute
    var d=document.createElement("div"); d.innerHTML=String(html||"");
    (function clean(el){ Array.prototype.slice.call(el.querySelectorAll("*")).forEach(function(x){
      if(/^(script|style|iframe|object|embed|link|meta|svg|math|base|form|input|button|template)$/i.test(x.tagName)){ x.remove(); return; }
      Array.prototype.slice.call(x.attributes).forEach(function(at){ var n=(at.name||"").toLowerCase();
        if(/^on/i.test(n) || n==="style" || n.indexOf("xlink")===0 || n==="xmlns" || (/(href|src)$/i.test(n) && /^\s*(javascript|data|vbscript):/i.test(at.value))) x.removeAttribute(at.name);
      });
    }); })(d);
    return d.innerHTML;
  }
  function uid(pre){ return (pre||"f")+Math.random().toString(36).slice(2,9); }

  var TYPES={
    notebook:{icon:"💻", label:"Notebook", host:true},
    rechner: {icon:"🖥️", label:"Rechner", host:true},
    switch:  {icon:"🔀", label:"Switch"},
    router:  {icon:"🌐", label:"Router"},
    text:    {icon:"📝", label:"Textfeld"}
  };

  function injectStyles(){
    if(document.getElementById("fv-styles")) return;
    var st=document.createElement("style"); st.id="fv-styles";
    st.textContent=
      ".fv{display:flex;flex-direction:column;gap:10px}"
      +".fv-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--card);border:2px solid var(--line);border-radius:14px;padding:8px 10px}"
      +".fv-tool{border:1.5px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:7px 10px;font-family:inherit;font-weight:800;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:.1s}"
      +".fv-tool:hover{border-color:#cdd5e0;background:var(--line2)}"
      +".fv-tool.on{background:var(--blue);color:#fff;border-color:var(--blue)}"
      +".fv-sep{width:1px;align-self:stretch;background:var(--line);margin:2px 4px}"
      +".fv-modeseg{display:inline-flex;background:var(--line2);border-radius:11px;padding:3px;gap:3px}"
      +".fv-modeseg button{border:none;background:transparent;font-family:inherit;font-weight:800;font-size:13px;color:var(--muted);padding:6px 12px;border-radius:9px;cursor:pointer}"
      +".fv-modeseg button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 4px rgba(0,0,0,.12)}"
      +".fv-canvaswrap{position:relative;border:2px solid var(--line);border-radius:16px;background:var(--bg);overflow:auto}"
      +".fv-canvas{position:relative;width:100%;height:var(--fvh,540px);min-width:100%}"
      +".fv-canvas.sim{background:linear-gradient(0deg,rgba(28,176,246,.04),rgba(28,176,246,.04))}"
      +".fv-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}"
      +".fv-link{stroke:var(--muted);stroke-width:3;opacity:.7}"
      +".fv-link.hit{stroke:transparent;stroke-width:14;opacity:1;pointer-events:stroke;cursor:pointer}"
      +".fv-link.sel{stroke:var(--blue);opacity:1}"
      +".fv-link.live{stroke:var(--green);opacity:1;stroke-width:4}"
      +".fv-packet{fill:var(--green);stroke:#fff;stroke-width:2}"
      +".fv-node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;user-select:none;width:78px}"
      +".fv-node .ic{font-size:30px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.18))}"
      +".fv-node .nm{font-weight:800;font-size:11.5px;color:var(--ink);background:var(--card);border:1.5px solid var(--line);border-radius:8px;padding:1px 7px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}"
      +".fv-node.sel .nm{border-color:var(--green);background:var(--green-l);color:var(--green-d)}"
      +".fv-node.pending .ic{animation:fvpulse .8s infinite}"
      +"@keyframes fvpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}"
      +".fv-node.text{transform:translate(-50%,-50%)}"
      +".fv-node.text .txt{background:#fff7e6;border:1.5px dashed #ffcf76;color:#6b5100;border-radius:10px;padding:6px 10px;font-weight:700;font-size:12.5px;max-width:200px;white-space:pre-wrap;text-align:left}"
      +":root[data-theme='dark'] .fv-node .nm{background:#1e2531}"
      +":root[data-theme='dark'] .fv-node.text .txt{background:#2a2410;color:#e7c980;border-color:#5a4a1a}"
      +".fv-hint{font-size:12.5px;color:var(--muted);font-weight:700;padding:2px 2px}"
      +".fv-console{border:2px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden}"
      +".fv-console-head{display:flex;align-items:center;gap:8px;padding:9px 13px;border-bottom:1px solid var(--line);font-weight:900;background:var(--line2)}"
      +".fv-tabs{display:flex;gap:5px;padding:8px 10px 0;flex-wrap:wrap}"
      +".fv-tab{border:1.5px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px 9px 0 0;padding:6px 12px;font-family:inherit;font-weight:800;font-size:12.5px;cursor:pointer}"
      +".fv-tab.on{background:var(--blue);color:#fff;border-color:var(--blue)}"
      +".fv-tabbody{padding:12px 13px}"
      +".fv-term{background:#0f1720;color:#d6f5c9;border-radius:10px;padding:10px 12px;font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;line-height:1.5;height:210px;overflow:auto;white-space:pre-wrap}"
      +".fv-termline{display:flex;gap:6px;align-items:center;margin-top:6px}"
      +".fv-termline input{flex:1;background:#0f1720;border:1px solid #2b3a2b;color:#d6f5c9;border-radius:8px;padding:7px 10px;font-family:'JetBrains Mono',Consolas,monospace;font-size:13px}"
      +".fv-web{border:1px solid var(--line);border-radius:10px;min-height:150px;background:#fff;color:#222;padding:12px 14px;overflow:auto;max-height:280px}"
      +".fv-dlg-bg{position:fixed;inset:0;background:rgba(30,42,60,.45);display:flex;align-items:center;justify-content:center;padding:18px;z-index:70}"
      +".fv-dlg{background:var(--card);color:var(--ink);border-radius:20px;box-shadow:0 20px 50px rgba(0,0,0,.3);width:100%;max-width:560px;max-height:92vh;overflow:auto;padding:22px}"
      +".fv-dlg h3{margin:0 0 12px;font-size:19px}"
      +".fv-row2{display:flex;gap:10px;flex-wrap:wrap}.fv-row2>*{flex:1;min-width:120px}"
      +".fv-appgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}"
      +".fv-appgrid label{display:flex;align-items:center;gap:7px;font-weight:700;font-size:13px;background:var(--line2);border-radius:9px;padding:7px 9px;cursor:pointer}";
    document.head.appendChild(st);
  }

  function FiliusView(host, opts){
    opts=opts||{};
    injectStyles();
    this.host=typeof host==="string"?document.querySelector(host):host;
    this.data=normalizeNet(opts.data);
    this.readonly=!!opts.readonly;
    this.onChange=opts.onChange||null;
    this.height=opts.height||"540px";
    this.mode=opts.mode||"design";   // 'design' | 'sim'
    this.tool="select";
    this.selNode=null; this.selLink=null; this.pending=null;
    this.consoleHost=null;
    this._anim=null;
    this._build();
  }
  function normalizeNet(d){ d=d||{}; if(typeof d==="string"){ try{ d=JSON.parse(d); }catch(e){ d={}; } } return { nodes:(d.nodes||[]).map(function(n){ return n; }), links:(d.links||[]).slice() }; }

  FiliusView.prototype._build=function(){
    var ro=this.readonly;
    var palette = ro ? "" :
      '<button class="fv-tool" data-tool="select" title="Auswählen & Verschieben">🖱️</button>'
      +'<span class="fv-sep"></span>'
      +'<button class="fv-tool" data-tool="notebook" title="Notebook (Client)">💻</button>'
      +'<button class="fv-tool" data-tool="rechner" title="Rechner (Server)">🖥️</button>'
      +'<button class="fv-tool" data-tool="switch" title="Switch">🔀</button>'
      +'<button class="fv-tool" data-tool="router" title="Router (Vermittlungsrechner)">🌐</button>'
      +'<button class="fv-tool" data-tool="text" title="Textfeld (Dokumentation)">📝</button>'
      +'<span class="fv-sep"></span>'
      +'<button class="fv-tool" data-tool="cable" title="Kabel: zwei Komponenten nacheinander anklicken">🔌 Kabel</button>'
      +'<button class="fv-tool" data-tool="delete" title="Löschen: Komponente/Kabel anklicken">🗑️</button>';
    this.host.innerHTML=
      '<div class="fv">'
      +'<div class="fv-bar">'
        +'<div class="fv-modeseg"><button data-mode="design" class="'+(this.mode==="design"?"on":"")+'">🔨 Entwurf</button><button data-mode="sim" class="'+(this.mode==="sim"?"on":"")+'">▶ Simulation</button></div>'
        +'<span class="fv-sep"></span>'
        +'<span class="fv-palette" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'+palette+'</span>'
        +'<div style="flex:1"></div>'
        +'<span class="fv-hint fv-status"></span>'
      +'</div>'
      +'<div class="fv-canvaswrap"><div class="fv-canvas" style="--fvh:'+this.height+'"><svg class="fv-svg"></svg></div></div>'
      +'<div class="fv-consolewrap"></div>'
      +'</div>';
    this.$=function(s){ return this.host.querySelector(s); };
    this.canvas=this.$(".fv-canvas");
    this.svg=this.$(".fv-svg");
    var self=this;
    // Modus
    this.host.querySelectorAll("[data-mode]").forEach(function(b){ b.onclick=function(){ self.setMode(b.dataset.mode); }; });
    // Werkzeuge
    this.host.querySelectorAll(".fv-tool").forEach(function(b){ b.onclick=function(){ self.setTool(b.dataset.tool); }; });
    // Canvas-Klick (platzieren / abwählen)
    this.canvas.addEventListener("mousedown", function(e){ if(e.target===self.canvas||e.target===self.svg) self._canvasDown(e); });
    // Tastatur (Löschen)
    this._keyh=function(e){ if(self.readonly||self.mode!=="design") return; if((e.key==="Delete"||e.key==="Backspace") && (self.selNode||self.selLink)){ if(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; e.preventDefault(); self._deleteSelected(); } };
    document.addEventListener("keydown", this._keyh);
    this._applyToolUI();
    this.paint();
  };

  FiliusView.prototype.setMode=function(m){
    this.mode=m; this.selNode=null; this.selLink=null; this.pending=null;
    this.host.querySelectorAll("[data-mode]").forEach(function(b){ b.classList.toggle("on", b.dataset.mode===m); });
    this.$(".fv-palette").style.display = (m==="design"&&!this.readonly)?"flex":"none";
    this.canvas.classList.toggle("sim", m==="sim");
    if(m!=="sim"){ this.consoleHost=null; this.$(".fv-consolewrap").innerHTML=""; }
    this._setStatus(m==="sim"?"Simulation – klicke einen Rechner an, um seine Konsole/Programme zu öffnen.":"");
    this.paint();
  };
  FiliusView.prototype.setTool=function(t){ this.tool=t; this.pending=null; this._applyToolUI(); this._setStatus(this._toolHint(t)); this.paint(); };
  FiliusView.prototype._applyToolUI=function(){ var self=this; this.host.querySelectorAll(".fv-tool").forEach(function(b){ b.classList.toggle("on", b.dataset.tool===self.tool); }); };
  FiliusView.prototype._toolHint=function(t){ return t==="cable"?"Kabel: erst die eine, dann die andere Komponente anklicken.":t==="delete"?"Löschen: Komponente oder Kabel anklicken.":(TYPES[t]?("Klicke in die Fläche, um „"+TYPES[t].label+"“ zu platzieren."):""); };
  FiliusView.prototype._setStatus=function(s){ var el=this.$(".fv-status"); if(el) el.textContent=s||""; };

  FiliusView.prototype._canvasDown=function(e){
    if(this.readonly||this.mode!=="design") { this._select(null,null); return; }
    var rect=this.canvas.getBoundingClientRect();
    var x=e.clientX-rect.left+this.canvas.scrollLeft, y=e.clientY-rect.top+this.canvas.scrollTop;
    if(TYPES[this.tool]){ this._addNode(this.tool, x, y); }
    else { this._select(null,null); }
  };
  FiliusView.prototype._addNode=function(type, x, y){
    var n={ id:uid("n"), type:type, x:Math.round(x), y:Math.round(y) };
    var base=this._defaultName(type);
    n.name=base;
    if(TYPES[type].host){ n.ip=""; n.mask="255.255.255.0"; n.gateway=""; n.dns=""; n.useDhcp=false; n.ipAsName=false; n.apps={webbrowser:false,webserver:false,dns:false,dhcp:false,echo:false}; }
    if(type==="router"){ n.ifs={}; n.autoRoute=true; n.routes=[]; }
    if(type==="text"){ n.text="Notiz"; n.name=""; }
    this.data.nodes.push(n);
    this._select(n.id,null);
    this._changed(); this.paint();
    if(TYPES[type].host||type==="router"||type==="text") this._configNode(n.id);
  };
  FiliusView.prototype._defaultName=function(type){
    var pre=type==="notebook"?"Notebook":type==="rechner"?"Rechner":type==="switch"?"Switch":type==="router"?"Router":"Text";
    var k=1, used={}; this.data.nodes.forEach(function(n){ used[String(n.name||"")]=1; });
    while(used[pre+" "+k]) k++;
    return pre+" "+k;
  };

  FiliusView.prototype._select=function(nodeId, linkId){ this.selNode=nodeId||null; this.selLink=linkId||null; this.paint(); };
  FiliusView.prototype._deleteSelected=function(){
    if(this.selLink){ this.data.links=this.data.links.filter(function(l){ return l.id!==this.selLink; }, this); this.selLink=null; }
    else if(this.selNode){ var id=this.selNode; this.data.nodes=this.data.nodes.filter(function(n){ return n.id!==id; });
      this.data.links=this.data.links.filter(function(l){ return l.a!==id && l.b!==id; });
      // Router-Interface-Configs an gelöschte Kabel bleiben unschädlich; nichts weiter nötig
      this.selNode=null; }
    this._changed(); this.paint();
  };
  FiliusView.prototype._removeNode=function(id){ this.selNode=id; this.selLink=null; this._deleteSelected(); };

  FiliusView.prototype._addLink=function(a,b){
    if(a===b) return;
    var exists=this.data.links.some(function(l){ return (l.a===a&&l.b===b)||(l.a===b&&l.b===a); });
    if(exists){ this._setStatus("Diese beiden sind schon verbunden."); return; }
    var na=this._node(a), nb=this._node(b);
    if(!na||!nb) return;
    if(na.type==="text"||nb.type==="text"){ this._setStatus("Textfelder können nicht verkabelt werden."); return; }
    this.data.links.push({ id:uid("l"), a:a, b:b });
    this._changed(); this.paint();
  };

  FiliusView.prototype._node=function(id){ for(var i=0;i<this.data.nodes.length;i++) if(this.data.nodes[i].id===id) return this.data.nodes[i]; return null; };
  FiliusView.prototype._changed=function(){ if(this.onChange) try{ this.onChange(this.data); }catch(e){} };

  /* --------- Zeichnen --------- */
  FiliusView.prototype.paint=function(){
    var self=this, data=this.data;
    // Links (SVG)
    var W=this.canvas.clientWidth||this.canvas.scrollWidth, H=this.canvas.clientHeight||this.canvas.scrollHeight;
    var svg='';
    data.links.forEach(function(l){ var a=self._node(l.a), b=self._node(l.b); if(!a||!b) return;
      var cls="fv-link"+(self.selLink===l.id?" sel":"");
      svg+='<line class="'+cls+' liveable" data-live="'+l.id+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'"></line>';
      svg+='<line class="fv-link hit" data-link="'+l.id+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'"></line>';
    });
    svg+='<circle class="fv-packet" r="7" style="display:none"></circle>';
    this.svg.innerHTML=svg;
    if(!this.readonly && this.mode==="design"){
      this.svg.querySelectorAll("[data-link]").forEach(function(ln){ ln.onclick=function(e){ e.stopPropagation();
        if(self.tool==="delete"){ self.selLink=ln.dataset.link; self._deleteSelected(); }
        else self._select(null, ln.dataset.link);
      }; });
    }
    // Nodes (DOM)
    Array.prototype.slice.call(this.canvas.querySelectorAll(".fv-node")).forEach(function(el){ el.remove(); });
    data.nodes.forEach(function(n){
      var el=document.createElement("div");
      el.className="fv-node"+(n.type==="text"?" text":"")+(self.selNode===n.id?" sel":"")+(self.pending===n.id?" pending":"");
      el.style.left=n.x+"px"; el.style.top=n.y+"px"; el.dataset.id=n.id;
      if(n.type==="text"){ el.innerHTML='<div class="txt">'+esc(n.text||"Notiz")+'</div>'; }
      else { var t=TYPES[n.type]||{icon:"❔"}; el.innerHTML='<div class="ic">'+t.icon+'</div><div class="nm" title="'+esc(n.name||"")+'">'+esc(n.name||t.label)+'</div>'; }
      self.canvas.appendChild(el);
      self._wireNode(el, n);
    });
  };

  FiliusView.prototype._wireNode=function(el, n){
    var self=this;
    el.addEventListener("mousedown", function(e){ e.stopPropagation();
      if(self.mode==="sim"){ if(FiliusEngine.isHost(n.type)) self._openConsole(n.id); return; }
      if(self.readonly) return;
      if(self.tool==="cable"){ self._cableClick(n.id); return; }
      if(self.tool==="delete"){ self._removeNode(n.id); return; }
      // select / drag
      self._select(n.id, null);
      self._startDrag(el, n, e);
    });
    el.addEventListener("dblclick", function(e){ e.stopPropagation(); if(self.mode==="sim"){ if(FiliusEngine.isHost(n.type)) self._openConsole(n.id); return; } if(!self.readonly) self._configNode(n.id); });
    el.addEventListener("contextmenu", function(e){ e.preventDefault(); if(self.readonly||self.mode!=="design") return; if(confirm("„"+(n.name||TYPES[n.type].label)+"“ entfernen?")) self._removeNode(n.id); });
  };
  FiliusView.prototype._cableClick=function(id){
    if(this.pending==null){ this.pending=id; this._setStatus("Kabel: jetzt die zweite Komponente anklicken."); this.paint(); return; }
    if(this.pending===id){ this.pending=null; this.paint(); return; }
    var a=this.pending; this.pending=null; this._addLink(a, id); this._setStatus(this._toolHint("cable"));
  };
  FiliusView.prototype._startDrag=function(el, n, e){
    var self=this, rect=this.canvas.getBoundingClientRect();
    var moved=false;
    function mm(ev){ moved=true;
      var x=ev.clientX-rect.left+self.canvas.scrollLeft, y=ev.clientY-rect.top+self.canvas.scrollTop;
      x=Math.max(24,Math.min((self.canvas.scrollWidth||rect.width)-24,x)); y=Math.max(20,Math.min((self.canvas.scrollHeight||rect.height)-20,y));
      n.x=Math.round(x); n.y=Math.round(y); el.style.left=n.x+"px"; el.style.top=n.y+"px";
      self.svg.querySelectorAll('[x1]').forEach(function(){});
      self._updateLinksFor(n.id);
    }
    function mu(){ document.removeEventListener("mousemove",mm); document.removeEventListener("mouseup",mu); if(moved) self._changed(); }
    document.addEventListener("mousemove",mm); document.addEventListener("mouseup",mu);
  };
  FiliusView.prototype._updateLinksFor=function(id){
    var self=this;
    this.data.links.forEach(function(l){ if(l.a!==id&&l.b!==id) return; var a=self._node(l.a), b=self._node(l.b); if(!a||!b) return;
      self.svg.querySelectorAll('[data-link="'+l.id+'"],[data-live="'+l.id+'"]').forEach(function(ln){ ln.setAttribute("x1",a.x); ln.setAttribute("y1",a.y); ln.setAttribute("x2",b.x); ln.setAttribute("y2",b.y); });
    });
  };

  /* --------- Konfigurations-Dialoge --------- */
  FiliusView.prototype._dialog=function(html, onOpen){
    var bg=document.createElement("div"); bg.className="fv-dlg-bg";
    bg.innerHTML='<div class="fv-dlg">'+html+'</div>';
    bg.addEventListener("mousedown", function(e){ if(e.target===bg) close(); });
    document.body.appendChild(bg);
    function close(){ bg.remove(); }
    bg._close=close;
    if(onOpen) onOpen(bg, close);
    return bg;
  };

  FiliusView.prototype._configNode=function(id){
    var n=this._node(id); if(!n) return;
    if(n.type==="text") return this._configText(n);
    if(n.type==="switch") return this._configSwitch(n);
    if(n.type==="router") return this._configRouter(n);
    return this._configHost(n);
  };
  FiliusView.prototype._configText=function(n){
    var self=this;
    this._dialog('<h3>📝 Textfeld</h3><div class="field"><label>Text</label><textarea class="input" id="fvTxt" style="min-height:90px">'+esc(n.text||"")+'</textarea></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" id="fvX">Schließen</button><button class="btn btn-primary" id="fvOk">Übernehmen</button></div>', function(bg,close){
      bg.querySelector("#fvX").onclick=close;
      bg.querySelector("#fvOk").onclick=function(){ n.text=bg.querySelector("#fvTxt").value; self._changed(); self.paint(); close(); };
    });
  };
  FiliusView.prototype._configSwitch=function(n){
    var self=this;
    this._dialog('<h3>🔀 Switch</h3><div class="field"><label>Name</label><input class="input" id="fvNm" value="'+esc(n.name||"")+'"></div><p class="fv-hint">Ein Switch verbindet mehrere Geräte in einem Netz. Er merkt sich die angeschlossenen Geräte automatisch.</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" id="fvX">Schließen</button><button class="btn btn-primary" id="fvOk">Übernehmen</button></div>', function(bg,close){
      bg.querySelector("#fvX").onclick=close;
      bg.querySelector("#fvOk").onclick=function(){ n.name=bg.querySelector("#fvNm").value.trim()||n.name; self._changed(); self.paint(); close(); };
    });
  };
  FiliusView.prototype._configHost=function(n){
    var self=this; n.apps=n.apps||{webbrowser:false,webserver:false,dns:false,dhcp:false,echo:false};
    var a=n.apps;
    var html='<h3>'+(TYPES[n.type].icon)+' '+esc(TYPES[n.type].label)+'</h3>'
      +'<div class="field"><label>Name</label><input class="input" id="fvNm" value="'+esc(n.name||"")+'"></div>'
      +'<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="fvIpName" '+(n.ipAsName?"checked":"")+'> IP-Adresse als Name verwenden</label>'
      +'<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="fvDhcp" '+(n.useDhcp?"checked":"")+'> Konfiguration per DHCP beziehen</label>'
      +'<div id="fvNetBox" class="'+(n.useDhcp?"":"")+'" style="'+(n.useDhcp?"opacity:.5;pointer-events:none":"")+'">'
        +'<div class="fv-row2"><div class="field"><label>IP-Adresse</label><input class="input" id="fvIp" placeholder="192.168.0.10" value="'+esc(n.ip||"")+'"></div><div class="field"><label>Subnetzmaske</label><input class="input" id="fvMask" placeholder="255.255.255.0" value="'+esc(n.mask||"255.255.255.0")+'"></div></div>'
        +'<div class="fv-row2"><div class="field"><label>Gateway</label><input class="input" id="fvGw" placeholder="192.168.0.1" value="'+esc(n.gateway||"")+'"></div><div class="field"><label>DNS-Server</label><input class="input" id="fvDns" placeholder="optional" value="'+esc(n.dns||"")+'"></div></div>'
      +'</div>'
      +'<div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:6px 0">Installierte Software</div>'
      +'<div class="fv-appgrid">'
        +'<label><input type="checkbox" id="fvBrowser" '+(a.webbrowser?"checked":"")+'> 🌎 Webbrowser</label>'
        +'<label><input type="checkbox" id="fvWeb" '+(a.webserver?"checked":"")+'> 🌐 Webserver</label>'
        +'<label><input type="checkbox" id="fvDnsS" '+(a.dns?"checked":"")+'> 🧭 DNS-Server</label>'
        +'<label><input type="checkbox" id="fvDhcpS" '+(a.dhcp?"checked":"")+'> 📡 DHCP-Server</label>'
        +'<label><input type="checkbox" id="fvEcho" '+(a.echo?"checked":"")+'> 🔁 Echo-Server</label>'
        +'<label style="opacity:.7"><input type="checkbox" checked disabled> ⌨️ Befehlszeile</label>'
      +'</div>'
      +'<div id="fvAppCfg"></div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost" id="fvX">Schließen</button><button class="btn btn-primary" id="fvOk">Übernehmen</button></div>';
    this._dialog(html, function(bg,close){
      var dhcp=bg.querySelector("#fvDhcp"), netBox=bg.querySelector("#fvNetBox");
      dhcp.onchange=function(){ netBox.style.opacity=dhcp.checked?".5":""; netBox.style.pointerEvents=dhcp.checked?"none":""; };
      function renderAppCfg(){
        var box=bg.querySelector("#fvAppCfg"); var h="";
        if(bg.querySelector("#fvWeb").checked){ n.web=n.web||{pages:{"/":"<h1>"+esc(n.name||"Webserver")+"</h1>\n<p>Willkommen auf der Startseite.</p>"}}; h+='<div class="field" style="margin-top:8px"><label>🌐 Webserver – index.html (root/webserver)</label><textarea class="input" id="fvWebHtml" style="min-height:80px;font-family:monospace;font-size:12.5px">'+esc((n.web.pages&&n.web.pages["/"])||"")+'</textarea></div>'; }
        if(bg.querySelector("#fvDnsS").checked){ n.dnsRecords=n.dnsRecords||[]; h+='<div class="field" style="margin-top:8px"><label>🧭 DNS-Einträge (je Zeile: name ip)</label><textarea class="input" id="fvDnsRecs" style="min-height:64px;font-family:monospace;font-size:12.5px" placeholder="www.filius.de 192.168.0.12">'+esc((n.dnsRecords||[]).map(function(r){return (r.name||"")+" "+(r.ip||"");}).join("\n"))+'</textarea></div>'; }
        if(bg.querySelector("#fvDhcpS").checked){ h+='<div class="fv-row2" style="margin-top:8px"><div class="field"><label>📡 DHCP von</label><input class="input" id="fvDhFrom" placeholder="192.168.0.100" value="'+esc(n.dhcpFrom||"")+'"></div><div class="field"><label>bis</label><input class="input" id="fvDhTo" placeholder="192.168.0.200" value="'+esc(n.dhcpTo||"")+'"></div></div><div class="fv-row2"><div class="field"><label>zugeteiltes Gateway</label><input class="input" id="fvDhGw" placeholder="optional (z. B. Router-IP)" value="'+esc(n.dhcpGw||"")+'"></div><div class="field"><label>zugeteilter DNS-Server</label><input class="input" id="fvDhDns" placeholder="optional" value="'+esc(n.dhcpDns||"")+'"></div></div>'; }
        box.innerHTML=h;
      }
      ["#fvWeb","#fvDnsS","#fvDhcpS"].forEach(function(s){ bg.querySelector(s).onchange=renderAppCfg; });
      renderAppCfg();
      bg.querySelector("#fvX").onclick=close;
      bg.querySelector("#fvOk").onclick=function(){
        n.useDhcp=dhcp.checked;
        n.ipAsName=bg.querySelector("#fvIpName").checked;
        n.ip=bg.querySelector("#fvIp").value.trim(); n.mask=bg.querySelector("#fvMask").value.trim()||"255.255.255.0";
        n.gateway=bg.querySelector("#fvGw").value.trim(); n.dns=bg.querySelector("#fvDns").value.trim();
        n.apps={ webbrowser:bg.querySelector("#fvBrowser").checked, webserver:bg.querySelector("#fvWeb").checked, dns:bg.querySelector("#fvDnsS").checked, dhcp:bg.querySelector("#fvDhcpS").checked, echo:bg.querySelector("#fvEcho").checked };
        var wh=bg.querySelector("#fvWebHtml"); if(wh){ n.web=n.web||{pages:{}}; n.web.pages["/"]=wh.value; }
        var dr=bg.querySelector("#fvDnsRecs"); if(dr){ n.dnsRecords=dr.value.split(/\r?\n/).map(function(x){var p=x.trim().split(/\s+/); return p[0]?{name:p[0],ip:p[1]||""}:null;}).filter(Boolean); }
        var df=bg.querySelector("#fvDhFrom"), dt=bg.querySelector("#fvDhTo"); if(df) n.dhcpFrom=df.value.trim(); if(dt) n.dhcpTo=dt.value.trim();
        var dgw=bg.querySelector("#fvDhGw"), ddns=bg.querySelector("#fvDhDns"); if(dgw) n.dhcpGw=dgw.value.trim(); if(ddns) n.dhcpDns=ddns.value.trim();
        if(n.ipAsName && n.ip) n.name=n.ip;
        self._changed(); self.paint(); close();
      };
    });
  };
  FiliusView.prototype._configRouter=function(n){
    var self=this; n.ifs=n.ifs||{}; if(n.autoRoute===undefined) n.autoRoute=true;
    var myLinks=this.data.links.filter(function(l){ return l.a===n.id||l.b===n.id; });
    var rows=myLinks.map(function(l, i){ var other=self._node(l.a===n.id?l.b:l.a); var cfg=n.ifs[l.id]||{}; var oname=other?(other.name||TYPES[other.type].label):"?";
      return '<div class="fv-row2" style="align-items:flex-end"><div class="field" style="flex:0 0 100%;margin-bottom:2px"><label style="margin-bottom:2px">Schnittstelle '+(i+1)+' → '+esc(oname)+'</label></div>'
        +'<div class="field"><input class="input" data-if-ip="'+l.id+'" placeholder="IP z. B. 192.168.0.1" value="'+esc(cfg.ip||"")+'"></div>'
        +'<div class="field"><input class="input" data-if-mask="'+l.id+'" placeholder="255.255.255.0" value="'+esc(cfg.mask||"255.255.255.0")+'"></div></div>';
    }).join("");
    if(!rows) rows='<p class="fv-hint">Verkabele den Router zuerst mit anderen Komponenten – pro Kabel erscheint hier eine Schnittstelle mit eigener IP-Adresse.</p>';
    var html='<h3>🌐 Router (Vermittlungsrechner)</h3>'
      +'<div class="field"><label>Name</label><input class="input" id="fvNm" value="'+esc(n.name||"")+'"></div>'
      +'<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="fvAuto" '+(n.autoRoute!==false?"checked":"")+'> Automatisches Routing (RIP) – Router finden den Weg selbst</label>'
      +'<div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:6px 0">Schnittstellen</div>'
      +rows
      +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost" id="fvX">Schließen</button><button class="btn btn-primary" id="fvOk">Übernehmen</button></div>';
    this._dialog(html, function(bg,close){
      bg.querySelector("#fvX").onclick=close;
      bg.querySelector("#fvOk").onclick=function(){
        n.name=bg.querySelector("#fvNm").value.trim()||n.name; n.autoRoute=bg.querySelector("#fvAuto").checked;
        n.ifs={}; bg.querySelectorAll("[data-if-ip]").forEach(function(inp){ var lk=inp.dataset.ifIp; var mk=bg.querySelector('[data-if-mask="'+lk+'"]'); var ip=inp.value.trim(); if(ip) n.ifs[lk]={ip:ip, mask:(mk?mk.value.trim():"")||"255.255.255.0"}; });
        self._changed(); self.paint(); close();
      };
    });
  };

  /* --------- Simulation: Host-Konsole --------- */
  FiliusView.prototype._openConsole=function(id){
    this.consoleHost=id; this._renderConsole();
    var w=this.$(".fv-consolewrap"); if(w) w.scrollIntoView({behavior:"smooth",block:"nearest"});
  };
  FiliusView.prototype._renderConsole=function(){
    var self=this, n=this._node(this.consoleHost); var w=this.$(".fv-consolewrap"); if(!w) return;
    if(!n){ w.innerHTML=""; return; }
    var a=n.apps||{};
    var tabs=[{k:"term",label:"⌨️ Befehlszeile"}];
    if(a.webbrowser) tabs.push({k:"web",label:"🌎 Webbrowser"});
    var services=[]; if(a.webserver)services.push("🌐 Webserver"); if(a.dns)services.push("🧭 DNS-Server"); if(a.dhcp)services.push("📡 DHCP-Server"); if(a.echo)services.push("🔁 Echo-Server");
    if(services.length) tabs.push({k:"srv",label:"⚙️ Dienste"});
    if(this._conTab==null || !tabs.some(function(t){return t.k===self._conTab;})) this._conTab="term";
    w.innerHTML='<div class="fv-console">'
      +'<div class="fv-console-head">'+(TYPES[n.type].icon)+' '+esc(n.name||TYPES[n.type].label)+'<div style="flex:1"></div><button class="btn btn-ghost btn-sm" id="fvConClose">Schließen</button></div>'
      +'<div class="fv-tabs">'+tabs.map(function(t){ return '<button class="fv-tab'+(t.k===self._conTab?" on":"")+'" data-ct="'+t.k+'">'+t.label+'</button>'; }).join("")+'</div>'
      +'<div class="fv-tabbody" id="fvTabBody"></div></div>';
    w.querySelector("#fvConClose").onclick=function(){ self.consoleHost=null; self._renderConsole(); };
    w.querySelectorAll("[data-ct]").forEach(function(b){ b.onclick=function(){ self._conTab=b.dataset.ct; self._renderConsole(); }; });
    var body=w.querySelector("#fvTabBody");
    if(this._conTab==="term") this._renderTerminal(body, n);
    else if(this._conTab==="web") this._renderBrowser(body, n);
    else this._renderServices(body, n, services);
  };
  FiliusView.prototype._renderServices=function(body, n, services){
    body.innerHTML='<p class="fv-hint">Auf diesem Rechner laufende Server (im Simulationsmodus automatisch aktiv):</p><ul style="margin:6px 0 0;padding-left:20px">'+services.map(function(s){return '<li style="font-weight:700;margin-bottom:3px">'+s+' <span style="color:var(--green-d)">● läuft</span></li>';}).join("")+'</ul><p class="fv-hint" style="margin-top:8px">Einstellungen (IP, Webseite, DNS-Einträge, DHCP-Bereich) im Entwurfsmodus per Doppelklick auf den Rechner.</p>';
  };
  FiliusView.prototype._renderBrowser=function(body, n){
    var self=this;
    body.innerHTML='<div style="display:flex;gap:8px;margin-bottom:8px"><input class="input" id="fvUrl" placeholder="http://192.168.0.12 oder http://www.filius.de" style="flex:1"><button class="btn btn-primary" id="fvGo">Los</button></div><div class="fv-web" id="fvWebOut"><span class="fv-hint">Adresse eingeben und „Los“.</span></div>';
    function go(){ var url=body.querySelector("#fvUrl").value.trim(); var out=body.querySelector("#fvWebOut"); if(!url){ return; }
      var A=FiliusEngine.analyze(self.data); var r=FiliusEngine.fetchWeb(A, n.id, url);
      out.innerHTML = r.ok ? escHtmlSafe(r.html) : '<div style="color:#c0392b;font-weight:700">⚠ '+esc(r.error)+'</div>';
    }
    body.querySelector("#fvGo").onclick=go; body.querySelector("#fvUrl").addEventListener("keydown",function(e){ if(e.key==="Enter") go(); });
  };
  FiliusView.prototype._renderTerminal=function(body, n){
    var self=this;
    body.innerHTML='<div class="fv-term" id="fvTerm"></div><div class="fv-termline"><span style="color:#7fd66a;font-weight:800">&gt;</span><input id="fvCmd" placeholder="ping … · ipconfig · host … · traceroute … · help" autocomplete="off" spellcheck="false"></div>';
    var term=body.querySelector("#fvTerm"), cmd=body.querySelector("#fvCmd");
    if(!this._termLines) this._termLines={};
    var buf=this._termLines[n.id]||["Befehlszeile – „help“ für eine Übersicht der Befehle.",""];
    function paintTerm(){ term.innerHTML=buf.map(function(l){ return esc(l); }).join("<br>"); term.scrollTop=term.scrollHeight; self._termLines[n.id]=buf; }
    paintTerm();
    function out(line){ buf.push(line); if(buf.length>400) buf=buf.slice(-400); paintTerm(); }
    function run(input){
      out("> "+input);
      var parts=input.trim().split(/\s+/), c=(parts[0]||"").toLowerCase(), arg=parts[1];
      var A=FiliusEngine.analyze(self.data), me=A.host[n.id]||{};
      if(c==="help"){ out("Befehle: ping <ziel>, ipconfig, host <name>, traceroute <ziel>, clear, help"); }
      else if(c==="clear"){ buf=[]; paintTerm(); }
      else if(c==="ipconfig"||c==="ifconfig"){ out("  IP-Adresse . . . : "+(me.ip||"(keine)")); out("  Subnetzmaske . . : "+(me.mask||"-")); out("  Gateway  . . . . : "+(me.gateway||"(keins)")); out("  DNS-Server . . . : "+(me.dns||"(keiner)")+(n.useDhcp?"  [per DHCP]":"")); }
      else if(c==="host"||c==="nslookup"){ if(!arg){ out("Aufruf: host <name>"); } else { var ip=FiliusEngine.resolveName(A, n.id, arg); out(ip? (arg+" hat die Adresse "+ip) : (arg+": konnte nicht aufgelöst werden")); } }
      else if(c==="ping"){ if(!arg){ out("Aufruf: ping <ziel>"); } else { self._doPing(A, n.id, arg, out); return; } }
      else if(c==="traceroute"||c==="tracert"){ if(!arg){ out("Aufruf: traceroute <ziel>"); } else { var r=FiliusEngine.ping(A, n.id, arg); if(!r.ok){ out("Ziel nicht erreichbar: "+(r.error||"")); } else { out("Route zu "+r.target+":"); (r.hops||[]).forEach(function(h,i){ out("  "+(i+1)+"  "+h); }); } } }
      else if(c===""){ }
      else { out("Unbekannter Befehl: "+c+"  (help)"); }
    }
    cmd.addEventListener("keydown", function(e){ if(e.key==="Enter"){ var v=cmd.value; cmd.value=""; if(v.trim()!=="") run(v); } });
    cmd.focus();
  };
  FiliusView.prototype._doPing=function(A, srcId, target, out){
    var self=this; var r=FiliusEngine.ping(A, srcId, target);
    out("Ping wird ausgeführt für "+(r.target||target)+" …");
    if(!r.ok){ out("  Fehler: "+(r.error||"nicht erreichbar")); if(r.path) self._animate(r.path); return; }
    self._animate(r.path);
    var i=0; var timer=setInterval(function(){ i++; out("  Antwort von "+r.target+": Zeit"+(i)+" ≈ "+(8+Math.round(i*1.7))+" ms"); if(i>=4){ clearInterval(timer); out("  4 gesendet, 4 empfangen, 0 verloren ✓"); } }, 420);
  };
  FiliusView.prototype._animate=function(path){
    if(!path||path.length<1) return; var self=this;
    var pts=path.map(function(id){ var n=self._node(id); return n?{x:n.x,y:n.y}:null; }).filter(Boolean);
    if(pts.length<2){ return; }
    // Kabel kurz grün
    for(var i=0;i<path.length-1;i++){ (function(a,b){ self.data.links.forEach(function(l){ if((l.a===a&&l.b===b)||(l.a===b&&l.b===a)){ var ln=self.svg.querySelector('[data-live="'+l.id+'"]'); if(ln){ ln.classList.add("live"); setTimeout(function(){ ln.classList.remove("live"); }, 1400); } } }); })(path[i],path[i+1]); }
    var pk=this.svg.querySelector(".fv-packet"); if(!pk) return; pk.style.display="";
    var seg=0, t=0, dur=16; // ms pro Schritt
    if(this._anim) clearInterval(this._anim);
    this._anim=setInterval(function(){ t+=0.04; if(t>=1){ t=0; seg++; if(seg>=pts.length-1){ clearInterval(self._anim); self._anim=null; pk.style.display="none"; return; } }
      var A=pts[seg], B=pts[seg+1]; pk.setAttribute("cx", A.x+(B.x-A.x)*t); pk.setAttribute("cy", A.y+(B.y-A.y)*t);
    }, dur);
  };

  /* --------- Öffentliche API --------- */
  FiliusView.prototype.getData=function(){ return { nodes:this.data.nodes, links:this.data.links }; };
  FiliusView.prototype.setData=function(d){ this.data=normalizeNet(d); this.selNode=this.selLink=this.pending=null; this.consoleHost=null; this._renderConsole&&this.$(".fv-consolewrap")&&(this.$(".fv-consolewrap").innerHTML=""); this.paint(); };
  FiliusView.prototype.setReadonly=function(ro){ this.readonly=!!ro; this._build(); };
  FiliusView.prototype.destroy=function(){ try{ if(this._anim) clearInterval(this._anim); }catch(e){} try{ document.removeEventListener("keydown", this._keyh); }catch(e){} if(this.host) this.host.innerHTML=""; };

  FiliusView.ensureStyles=injectStyles;
  window.FiliusView=FiliusView;
})();
