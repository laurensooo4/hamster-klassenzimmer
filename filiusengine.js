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
  var BROADCAST_MAC="FF:FF:FF:FF:FF:FF";
  // Deterministische MAC-Adresse aus einer Kennung (stabil, unicast, lokal verwaltet)
  function macFor(id){ id=String(id); var h=2166136261>>>0; for(var i=0;i<id.length;i++){ h^=id.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
    var out=[]; for(var b=0;b<6;b++){ out.push(h&0xff); h=Math.imul(h^(h>>>13),16777619)>>>0; }
    out[0]=(out[0]&0xfe)|0x02;
    return out.map(function(x){ return ("0"+x.toString(16)).slice(-2).toUpperCase(); }).join(":"); }

  /* ---------------- DSU (Union-Find) für Broadcast-Domänen ---------------- */
  function DSU(){ this.p={}; }
  DSU.prototype.find=function(x){ if(this.p[x]===undefined) this.p[x]=x; while(this.p[x]!==x){ this.p[x]=this.p[this.p[x]]; x=this.p[x]; } return x; };
  DSU.prototype.union=function(a,b){ var ra=this.find(a), rb=this.find(b); if(ra!==rb) this.p[ra]=rb; };

  function isHost(t){ return t==="notebook"||t==="rechner"; }
  function isRouterType(t){ return t==="router"||t==="gateway"; }   // Vermittlungsrechner + Heimrouter (Gateway/NAT)

  /* ---------------- Virtuelles Dateisystem (je Host) ----------------
     Flache Map: absolute Pfade -> {dir:true} | {content:"..."} ; Wurzel "/" implizit. */
  function FS_default(){ return { "/eigene Dateien":{dir:true} }; }
  // Legacy-Netze: alte node.web.pages beim ersten Zugriff ins Dateisystem übernehmen (kein Shadowing/Verlust)
  function fsMigrate(node){ var fs=FS_default(); var pg=node.web&&node.web.pages; if(pg){ Object.keys(pg).forEach(function(k){ var rel=(k==="/"||k==="")?"/index.html":k; fsWrite(fs, "/webserver"+fsNorm(rel), pg[k]); }); } return fs; }
  function fsOf(node){ if(!node.fs || typeof node.fs!=="object"){ node.fs=(node.web&&node.web.pages)?fsMigrate(node):FS_default(); } return node.fs; }
  function fsEnsure(fs,p){ var parts=fsNorm(p).split("/").slice(1,-1); var cur=""; for(var i=0;i<parts.length;i++){ cur+="/"+parts[i]; if(!fs[cur]||!fs[cur].dir) fs[cur]={dir:true}; } }
  function fsNorm(p){ if(!p) return "/"; p=String(p).replace(/\\/g,"/"); if(p[0]!=="/") p="/"+p; p=p.replace(/\/+/g,"/"); if(p.length>1) p=p.replace(/\/$/,""); return p; }
  function fsResolve(cwd, arg){ if(!arg) return fsNorm(cwd); arg=String(arg).replace(/\\/g,"/"); var base=(arg[0]==="/")?"":fsNorm(cwd); var parts=(base+"/"+arg).split("/"); var st=[]; parts.forEach(function(s){ if(!s||s===".")return; if(s===".."){ st.pop(); } else st.push(s); }); return "/"+st.join("/"); }
  function fsParent(p){ p=fsNorm(p); if(p==="/")return "/"; var i=p.lastIndexOf("/"); return i<=0?"/":p.slice(0,i); }
  function fsBase(p){ p=fsNorm(p); return p.slice(p.lastIndexOf("/")+1); }
  function fsExists(fs,p){ p=fsNorm(p); return p==="/"||!!fs[p]; }
  function fsIsDir(fs,p){ p=fsNorm(p); return p==="/"||!!(fs[p]&&fs[p].dir); }
  function fsRead(fs,p){ p=fsNorm(p); return (fs[p]&&!fs[p].dir)?(fs[p].content||""):null; }
  function fsWrite(fs,p,c){ p=fsNorm(p); if(p==="/")return false; fsEnsure(fs,p); fs[p]={content:c==null?"":String(c)}; return true; }
  function fsMkdir(fs,p){ p=fsNorm(p); if(p==="/"||fs[p])return false; fsEnsure(fs,p); fs[p]={dir:true}; return true; }
  function fsRm(fs,p){ p=fsNorm(p); if(p==="/")return false; var did=false; Object.keys(fs).forEach(function(k){ if(k===p||k.indexOf(p+"/")===0){ delete fs[k]; did=true; } }); return did; }
  function fsList(fs,dir){ dir=fsNorm(dir); var out=[]; Object.keys(fs||{}).forEach(function(k){ if(fsParent(k)===dir) out.push({path:k, name:fsBase(k), dir:!!fs[k].dir, size:(fs[k].content||"").length}); }); return out.sort(function(a,b){ return (b.dir-a.dir)||a.name.localeCompare(b.name,"de"); }); }
  function fileTypeOf(name){ var e=(name.split(".").pop()||"").toLowerCase(); if(["txt","html","htm","css","js","md","xml","json","csv"].indexOf(e)>=0) return "text"; if(["png","jpg","jpeg","gif","bmp","svg","webp"].indexOf(e)>=0) return "image"; if(["wav","mp3","ogg"].indexOf(e)>=0) return "sound"; return "text"; }

  /* ---------------- Netz analysieren (Topologie, Domänen, DHCP) ---------------- */
  function analyze(net){
    net=net||{}; var nodes=net.nodes||[], links=net.links||[];
    var byId={}; nodes.forEach(function(n){ byId[n.id]=n; });
    // Endpunkt-Schlüssel: Router werden pro Kabel getrennt (L2-Grenze), Hosts/Switches je ein Knoten
    function epKey(nodeId, linkId){ var n=byId[nodeId]; if(n && isRouterType(n.type)) return "r:"+nodeId+":"+linkId; return "n:"+nodeId; }
    var dsu=new DSU();
    // sicherstellen, dass jeder Host/Switch als Domäne existiert
    nodes.forEach(function(n){ if(isHost(n.type)||n.type==="switch") dsu.find("n:"+n.id); });
    links.forEach(function(l){ if(!byId[l.a]||!byId[l.b]) return; dsu.union(epKey(l.a,l.id), epKey(l.b,l.id)); });

    // Router-Interfaces je Kabel
    var routerLinks={};   // routerId -> [linkId,...]
    links.forEach(function(l){ [l.a,l.b].forEach(function(id){ var n=byId[id]; if(n&&isRouterType(n.type)){ (routerLinks[id]=routerLinks[id]||[]).push(l.id); } }); });

    var A={ net:net, byId:byId, links:links, hostDomain:{}, domHosts:{}, domRifs:{}, routerIfDom:{}, host:{}, routerLinks:routerLinks, mac:{}, rmac:{} };

    // statische Host-Konfiguration
    nodes.forEach(function(n){ if(!isHost(n.type)) return;
      A.host[n.id]={ ip:(n.ip&&validIp(n.ip))?n.ip:null, mask:n.mask||"255.255.255.0", gateway:n.gateway||null, dns:n.dns||null, dhcp:!!n.useDhcp };
      A.mac[n.id]=macFor(n.id);
      var d=dsu.find("n:"+n.id); A.hostDomain[n.id]=d; (A.domHosts[d]=A.domHosts[d]||[]).push(n.id);
    });
    // Router-Interfaces den Domänen zuordnen
    Object.keys(routerLinks).forEach(function(rid){ var r=byId[rid]; var ifs=r.ifs||{};
      A.routerIfDom[rid]={}; A.rmac[rid]={};
      routerLinks[rid].forEach(function(linkId){ var d=dsu.find("r:"+rid+":"+linkId); A.routerIfDom[rid][linkId]=d; A.rmac[rid][linkId]=macFor(rid+":"+linkId);
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
  function findEndpointInDomain(A, dom, ip){ var h=findHostInDomain(A,dom,ip); if(h) return {id:h, isRouter:false}; var arr=A.domRifs[dom]||[]; for(var i=0;i<arr.length;i++){ if(arr[i].ip===ip) return {id:arr[i].router, isRouter:true, rlink:arr[i].linkId}; } return null; }
  function macOfEndpoint(A, ep){ return ep.isRouter ? ((A.rmac[ep.id]||{})[ep.rlink]) : A.mac[ep.id]; }
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

  // Longest-Prefix-Match unter den statischen Routen (spezifischste Maske gewinnt)
  function bestStaticRoute(node, dstIp){ var best=null, bestLen=-1; (node.routes||[]).forEach(function(ro){ if(ro.dest&&ro.mask&&ro.nextHop&&sameNet(ro.dest,dstIp,ro.mask)){ var len=maskLen(parseMask(ro.mask)); if(len>bestLen){ bestLen=len; best=ro; } } }); return best; }
  // Nächster Hop eines Routers/Gateways: RIP bzw. statische Route, sonst Standardgateway (Default-Route 0.0.0.0)
  function routeNextHop(A, node, dstIp){
    var nh=null;
    if(node.autoRoute!==false) nh=autoNextHop(A, node.id, dstIp);
    else { var ro=bestStaticRoute(node, dstIp); if(ro) nh=ro.nextHop; }
    if(!nh && node.gateway && validIp(node.gateway)) nh=node.gateway;   // Default-Route (Uplink des Heimrouters)
    return nh;
  }

  /* ---- Firewall des Vermittlungsrechners (wie FILIUS jfirewalldialog) ----
     r.fw = { on, icmp (ICMP-Pakete filtern), synOnly (nur SYN verwerfen),
              defaultAction:"accept"|"drop",
              rules:[{srcIp,srcMask,dstIp,dstMask,proto:"TCP"|"UDP",port,action}] }
     pkt = { srcIp, dstIp, proto:"icmp"|"tcp"|"udp", port, reply:bool } */
  function fwRouterBlocks(r, pkt){
    var f=r&&r.fw; if(!f||!f.on||!pkt) return false;
    if(pkt.proto==="icmp") return !!f.icmp;                       // ICMP-Filter wirkt in beide Richtungen
    if(f.synOnly!==false && pkt.reply) return false;              // nur SYN (Verbindungsaufbau) verwerfen – Rückkanal passiert
    var rules=f.rules||[];
    for(var i=0;i<rules.length;i++){ var rl=rules[i];
      if(rl.srcIp && !(pkt.srcIp && sameNet(rl.srcIp, pkt.srcIp, rl.srcMask||"255.255.255.255"))) continue;
      if(rl.dstIp && !(pkt.dstIp && sameNet(rl.dstIp, pkt.dstIp, rl.dstMask||"255.255.255.255"))) continue;
      if(rl.proto && String(rl.proto).toLowerCase()!==String(pkt.proto||"tcp").toLowerCase()) continue;
      if(rl.port!=null && String(rl.port)!=="" && String(rl.port)!==String(pkt.port)) continue;
      return String(rl.action||"accept").toLowerCase()!=="accept" && rl.action!=="akzeptieren";
    }
    return String(f.defaultAction||"accept").toLowerCase()!=="accept" && f.defaultAction!=="akzeptieren";
  }
  function routerForward(A, rid, dstIp, hops, visited, depth, pkt){
    if(depth>32) return {ok:false, error:"Routing-Schleife"};
    if(visited[rid]) return {ok:false, error:"Routing-Schleife"};
    visited[rid]=true;
    var r=A.byId[rid], ifs=(r&&r.ifs)||{}, m=A.routerIfDom[rid]||{};
    if(fwRouterBlocks(r, pkt)) return {ok:false, error:"Von der Firewall („"+(r.name||"Vermittlungsrechner")+"“) verworfen", blockedAt:rid};
    // direkt angeschlossenes Netz?
    var direct=routerHasNet(A, rid, dstIp);
    if(direct){ var dom=m[direct]; var t=findEndpointInDomain(A, dom, dstIp); if(t){ hops.push(dstIp); return {ok:true, hops:hops, dstNodeId:t.id, isRouter:t.isRouter}; } return {ok:false, error:"Ziel im Zielnetz nicht gefunden"}; }
    // Route bestimmen
    var nextHop=routeNextHop(A, r, dstIp);
    if(!nextHop) return {ok:false, error:"Keine Route zum Zielnetz"};
    for(var lk in m){ var nb=findRifInDomain(A, m[lk], nextHop, rid); if(nb){ hops.push(nextHop); return routerForward(A, nb.router, dstIp, hops, visited, depth+1, pkt); } }
    return {ok:false, error:"Next-Hop nicht erreichbar"};
  }

  // L3-Erreichbarkeit von Host srcId zu dstIp. ctx (optional): {proto, port, reply}
  function l3(A, srcId, dstIp, ctx){
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
    var pkt=ctx?{srcIp:src.ip, dstIp:dstIp, proto:ctx.proto||"tcp", port:ctx.port, reply:!!ctx.reply}:null;
    return routerForward(A, gw.router, dstIp, hops, {}, 0, pkt);
  }

  // Kreuzt der Weg von srcId nach dstIp einen Heimrouter (Gateway) mit AKTIVEM NAT → NAT maskiert die Quelle
  function pathCrossesNat(A, srcId, dstIp){
    var leg=l3legs(A, srcId, dstIp); if(!leg.ok||!leg.legs) return false;
    function isNat(nd){ return nd && nd.type==="gateway" && nd.nat!==false; }
    for(var i=0;i<leg.legs.length;i++){ if(isNat(A.byId[leg.legs[i].to.nodeId])||isNat(A.byId[leg.legs[i].from.nodeId])) return true; }
    return false;
  }
  // Portweiterleitung: Ist dstIp die WAN-IP eines Gateways UND gibt es eine Portfreigabe für (proto,port),
  // dann wird die Verbindung an den LAN-Host umgeschrieben. Liefert {lanIp} oder null.
  function natPortForward(A, dstIp, proto, port){
    if(port==null) return null;
    var gws=(A.net.nodes||[]).filter(function(n){ return n.type==="gateway" && Array.isArray(n.portForward) && n.portForward.length; });
    for(var g=0; g<gws.length; g++){ var gw=gws[g], ifs=gw.ifs||{};
      var isWan=false; for(var lk in ifs){ if(ifs[lk].ip===dstIp){ isWan=true; break; } }
      if(!isWan) continue;
      for(var i=0;i<gw.portForward.length;i++){ var pf=gw.portForward[i];
        if(String(pf.port)===String(port) && (!pf.proto || String(pf.proto).toLowerCase()===String(proto||"tcp").toLowerCase()) && pf.lanIp && validIp(pf.lanIp)){
          return { lanIp:pf.lanIp };
        }
      }
    }
    return null;
  }
  // Beidseitige Erreichbarkeit: Anfrage src->dst UND Antwort dst->src (Ziel braucht auch ein Gateway)
  function reach2(A, srcId, dstIp, ctx){
    var f=l3(A, srcId, dstIp, ctx);
    if(!f.ok) return f;
    if(f.dstNodeId===srcId || f.isRouter) return f;   // localhost oder Router (antwortet direkt auf seiner Interface-IP)
    var srcIp=A.host[srcId]?A.host[srcId].ip:null;
    if(!srcIp) return {ok:false, error:"Quelle hat keine IP-Adresse"};
    // NAT: Kreuzt der Hinweg einen Heimrouter, sieht das Ziel nur dessen öffentliche (WAN-)Adresse.
    // Der Rückweg endet dann am Gateway (öffentlich erreichbar) und wird von dort per NAT weitergereicht.
    if(pathCrossesNat(A, srcId, dstIp)) return f;
    var back=l3(A, f.dstNodeId, srcIp, ctx?{proto:ctx.proto, port:ctx.port, reply:true}:null);
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

  // DNS-Auflösung von srcId aus: name -> ip (über konfigurierten DNS-Server, UDP Port 53)
  function resolveName(A, srcId, name){
    if(validIp(name)) return name;
    var src=A.host[srcId]; if(!src||!src.dns) return null;
    // DNS-Server erreichbar?
    var r=reach2(A, srcId, src.dns, {proto:"udp", port:53}); if(!r.ok) return null;
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
    var r=reach2(A, srcId, dstIp, {proto:"icmp"});
    r.target=dstIp;
    if(r.ok){ var dn=A.byId[r.dstNodeId]; if(dn && fwBlocks(dn,"icmp",null,(A.host[srcId]||{}).ip)){ r.ok=false; r.error="Ziel antwortet nicht (Firewall blockiert ICMP)"; } }
    if(r.ok) r.path=physicalPath(A, srcId, r.dstNodeId)||[srcId, r.dstNodeId];
    return r;
  }

  /* ---- L2-Simulation: Legs, Frames, ARP, SAT, Schichten (für die Sichtbar-Machung) ---- */
  function normMask(m){ var i=parseMask(m); return i===null?(m||"255.255.255.0"):intToIp(i); }
  function switchPort(A, switchId, neighborId){ var ls=A.links.filter(function(l){ return l.a===switchId||l.b===switchId; }); for(var i=0;i<ls.length;i++){ if(ls[i].a===neighborId||ls[i].b===neighborId) return i+1; } return 1; }
  // Physischer Pfad innerhalb EINER Broadcast-Domäne (nicht durch fremde Router)
  function domainPath(A, fromId, toId){
    if(fromId===toId) return [fromId];
    var adj={}; A.links.forEach(function(l){ if(!A.byId[l.a]||!A.byId[l.b])return; if(A.byId[l.a].type==="text"||A.byId[l.b].type==="text")return; (adj[l.a]=adj[l.a]||[]).push(l.b); (adj[l.b]=adj[l.b]||[]).push(l.a); });
    var prev={}, seen={}; seen[fromId]=true; var q=[fromId];
    while(q.length){ var c=q.shift(); if(c===toId){ var p=[toId], x=toId; while(prev[x]!==undefined){ x=prev[x]; p.unshift(x); } return p; }
      if(c!==fromId && c!==toId && A.byId[c] && isRouterType(A.byId[c].type)) continue;   // nicht durch fremde Router/Gateways
      (adj[c]||[]).forEach(function(nx){ if(!seen[nx]){ seen[nx]=true; prev[nx]=c; q.push(nx); } });
    }
    return null;
  }
  // Weiterleitungstabelle eines Routers (read-only Ableitung)
  function forwardingTable(A, rid){
    var r=A.byId[rid]; if(!r) return []; var ifs=r.ifs||{}; var rows=[];
    Object.keys(ifs).forEach(function(lk){ var c=ifs[lk]; if(!c.ip||!validIp(c.ip))return; rows.push({ziel:intToIp(netAddr(c.ip,c.mask||"255.255.255.0")), maske:normMask(c.mask), gateway:c.ip+" (direkt)", iface:c.ip, kind:"direkt"}); });
    (r.routes||[]).forEach(function(ro){ if(ro.dest&&ro.nextHop) rows.push({ziel:ro.dest, maske:normMask(ro.mask), gateway:ro.nextHop, iface:ro.nextHop, kind:"statisch"}); });
    rows.push({ziel:"127.0.0.0", maske:"255.0.0.0", gateway:"127.0.0.1 (Loopback)", iface:"127.0.0.1", kind:"lokal"});
    if(r.autoRoute!==false) rows.push({ziel:"alle anderen Netze", maske:"— (RIP)", gateway:"automatisch (RIP)", iface:"—", kind:"auto"});
    if(r.gateway && validIp(r.gateway)) rows.push({ziel:"0.0.0.0", maske:"0.0.0.0", gateway:r.gateway, iface:r.gateway, kind:"default"});
    return rows;
  }
  // Zerlegt den L3-Weg in L2-Legs (je Broadcast-Domäne ein Frame-Abschnitt mit eigenen MAC-Endpunkten)
  function l3legs(A, srcId, dstIp){
    var src=A.host[srcId]; if(!src||!src.ip) return {ok:false, error:"Quelle hat keine IP-Adresse"};
    function ep(nodeId, ip, mac, linkId){ return {nodeId:nodeId, ip:ip, mac:mac, linkId:linkId}; }
    var srcEp=ep(srcId, src.ip, A.mac[srcId]);
    if(dstIp===src.ip) return {ok:true, legs:[], dstNodeId:srcId, self:true};
    var dom=A.hostDomain[srcId], legs=[];
    if(sameNet(src.ip, dstIp, src.mask)){
      var t=findEndpointInDomain(A, dom, dstIp); if(!t) return {ok:false, error:"Ziel im eigenen Netz nicht erreichbar"};
      legs.push({domain:dom, from:srcEp, to:ep(t.id, dstIp, macOfEndpoint(A,t), t.rlink)});
      return {ok:true, legs:legs, dstNodeId:t.id};
    }
    if(!src.gateway) return {ok:false, error:"Kein Gateway gesetzt"};
    if(!sameNet(src.ip, src.gateway, src.mask)) return {ok:false, error:"Gateway nicht im eigenen Netz"};
    var gw=findRifInDomain(A, dom, src.gateway, null); if(!gw) return {ok:false, error:"Gateway nicht erreichbar"};
    legs.push({domain:dom, from:srcEp, to:ep(gw.router, src.gateway, A.rmac[gw.router][gw.linkId], gw.linkId)});
    var rid=gw.router, visited={}, depth=0;
    while(true){
      if(depth++>32 || visited[rid]) return {ok:false, error:"Routing-Schleife"}; visited[rid]=true;
      var m=A.routerIfDom[rid]||{}, ifs=(A.byId[rid].ifs)||{};
      var direct=routerHasNet(A, rid, dstIp);
      if(direct){ var d2=m[direct], t2=findEndpointInDomain(A, d2, dstIp); if(!t2) return {ok:false, error:"Ziel im Zielnetz nicht gefunden"};
        legs.push({domain:d2, from:ep(rid, ifs[direct].ip, A.rmac[rid][direct], direct), to:ep(t2.id, dstIp, macOfEndpoint(A,t2), t2.rlink)});
        return {ok:true, legs:legs, dstNodeId:t2.id};
      }
      var nextHop=routeNextHop(A, A.byId[rid], dstIp);
      if(!nextHop) return {ok:false, error:"Keine Route zum Zielnetz"};
      var found=null, outLink=null;
      for(var lk in m){ var nb=findRifInDomain(A, m[lk], nextHop, rid); if(nb){ found=nb; outLink=lk; break; } }
      if(!found) return {ok:false, error:"Next-Hop nicht erreichbar"};
      legs.push({domain:m[outLink], from:ep(rid, ifs[outLink].ip, A.rmac[rid][outLink], outLink), to:ep(found.router, nextHop, A.rmac[found.router][found.linkId], found.linkId)});
      rid=found.router;
    }
  }
  // Vollständige Ping-Simulation auf Frame-Ebene: {ok, error, dstIp, hops, sat[], logs{node:[..]}, layers[], path[]}
  function pingSim(net, srcId, target){
    var A=analyze(net);
    var dstIp = validIp(target)? target : resolveName(A, srcId, target);
    if(!dstIp) return {ok:false, error:"Name konnte nicht aufgelöst werden", sat:[], logs:{}, layers:null, path:null };
    var r=ping(A, srcId, dstIp), leg=l3legs(A, srcId, dstIp);
    // Wenn eine Router-Firewall unterwegs verwirft: Rahmen nur bis zum blockierenden Router zeigen
    if(!r.ok && r.blockedAt && leg.ok && leg.legs){
      for(var bi=0;bi<leg.legs.length;bi++){ if(leg.legs[bi].to.nodeId===r.blockedAt){ leg.legs=leg.legs.slice(0,bi+1); break; } }
    }
    var sat=[], logs={}, layers=null, path=[srcId];
    var srcMac=A.mac[srcId], srcIp=A.host[srcId]?A.host[srcId].ip:null;
    function log(id,row){ (logs[id]=logs[id]||[]).push(row); }
    if(leg.ok && leg.legs.length){
      var l0=leg.legs[0];
      log(srcId,{proto:"ARP",schicht:"Netzzugang",quelle:srcMac,ziel:BROADCAST_MAC,bemerkung:"Wer hat "+l0.to.ip+"? Bitte an "+srcMac});
      if(r.ok) log(srcId,{proto:"ARP",schicht:"Netzzugang",quelle:l0.to.mac,ziel:srcMac,bemerkung:l0.to.ip+" liegt bei "+l0.to.mac});
      for(var k=0;k<4;k++){ log(srcId,{proto:"ICMP",schicht:"Vermittlung",quelle:srcIp,ziel:dstIp,bemerkung:"Echo-Anfrage (ping) icmp_seq="+(k+1)});
        if(r.ok) log(srcId,{proto:"ICMP",schicht:"Vermittlung",quelle:dstIp,ziel:srcIp,bemerkung:"Echo-Antwort (pong) icmp_seq="+(k+1)}); }
      if(!r.ok) log(srcId,{proto:"ICMP",schicht:"Vermittlung",quelle:"(keine)",ziel:srcIp,bemerkung:"Zeitüberschreitung – keine Antwort ("+(r.error||"nicht erreichbar")+")"});
      leg.legs.forEach(function(lg){ var pp=domainPath(A, lg.from.nodeId, lg.to.nodeId)||[lg.from.nodeId, lg.to.nodeId];
        pp.forEach(function(id){ if(path[path.length-1]!==id) path.push(id); });
        for(var i=0;i<pp.length;i++){ var nd=A.byId[pp[i]]; if(!nd||nd.type!=="switch") continue;
          if(pp[i-1]) sat.push({switchId:pp[i], mac:lg.from.mac, port:switchPort(A,pp[i],pp[i-1])});
          if(pp[i+1] && r.ok) sat.push({switchId:pp[i], mac:lg.to.mac, port:switchPort(A,pp[i],pp[i+1])});
        }
      });
      layers=[ {schicht:"Anwendung", felder:"ICMP Echo-Anfrage („ping“)"},
               {schicht:"Transport", felder:"— (ICMP nutzt keine Ports)"},
               {schicht:"Vermittlung (IP)", felder:"Quelle "+srcIp+" → Ziel "+dstIp+" · TTL 64"},
               {schicht:"Netzzugang (Ethernet)", felder:"Quelle "+srcMac+" → Ziel "+l0.to.mac+(l0.to.ip!==dstIp?" (nächster Halt: Gateway "+l0.to.ip+")":"")} ];
      if(r.ok && leg.dstNodeId && A.byId[leg.dstNodeId] && isHost(A.byId[leg.dstNodeId].type)){ var dId=leg.dstNodeId;
        for(var k2=0;k2<4;k2++){ log(dId,{proto:"ICMP",schicht:"Vermittlung",quelle:srcIp,ziel:dstIp,bemerkung:"Echo-Anfrage empfangen"}); log(dId,{proto:"ICMP",schicht:"Vermittlung",quelle:dstIp,ziel:srcIp,bemerkung:"Echo-Antwort gesendet"}); } }
    } else if(leg.self){ log(srcId,{proto:"ICMP",schicht:"Vermittlung",quelle:srcIp,ziel:dstIp,bemerkung:"Echo an sich selbst (Loopback)"}); }
    return { ok:r.ok, error:r.error, dstIp:dstIp, hops:r.hops||[], sat:sat, logs:logs, layers:layers, path:(r.ok?path:(r.path||null)) };
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
    if(fwBlocks(srv,"tcp",80)) return {ok:false, error:"Port 80 durch Firewall blockiert"};
    var fs=fsOf(srv); var rel=(path==="/"||path==="")?"/index.html":path; var page=fsRead(fs, "/webserver"+rel);
    if(page==null && (srv.web&&srv.web.pages)) page=srv.web.pages[path]||srv.web.pages["/"];   // Rückwärtskompatibilität (alte Netze)
    if(page==null) return {ok:false, error:"Seite nicht gefunden (404)"};
    return {ok:true, html:page, ip:ip, server:srv.name};
  }

  /* ---------------- Dienste: Firewall, Echo/Client, E-Mail (SMTP/POP3), Gnutella (P2P) ---------------- */
  // Personal Firewall am Host. Zwei Modelle:
  //  - Neu (wie FILIUS-Desktop-Firewall): {on, allowIcmp, filterUdp, rules:[{port, scope:"all"|"lan"}]} – blockiert alles Eingehende außer Ausnahmen
  //  - Alt (Legacy-Netze):                {on, blockPing, denyPorts[]} – Sperrliste
  function fwBlocks(node, proto, port, srcIp){ var f=node&&node.firewall; if(!f||!f.on) return false;
    if(Array.isArray(f.rules)||f.allowIcmp!==undefined||f.filterUdp!==undefined){
      if(proto==="icmp") return !f.allowIcmp;
      if(proto==="udp" && !f.filterUdp) return false;
      var ok=false; (f.rules||[]).forEach(function(rl){ if(String(rl.port)===String(port)){
        if(rl.scope==="lan"){ if(srcIp && node.ip && sameNet(srcIp, node.ip, node.mask||"255.255.255.0")) ok=true; }
        else ok=true; } });
      return !ok;
    }
    if(proto==="icmp") return !!f.blockPing;
    var deny=(f.denyPorts||[]).map(String); return deny.indexOf(String(port))>=0; }
  // Dienst-Erreichbarkeit: L3 hin+zurück (inkl. Router-Firewalls) UND Ziel-Firewall erlaubt proto/port
  function serviceReach(A, srcId, dstIp, proto, port){
    var srcIp=A.host[srcId]?A.host[srcId].ip:null;
    // Portweiterleitung: Ziel = WAN-IP eines Heimrouters mit passender Freigabe → an LAN-Host umschreiben
    var pf=natPortForward(A, dstIp, proto, port);
    if(pf){
      var rw=reach2(A, srcId, dstIp, {proto:proto, port:port}); if(!rw.ok) return rw;   // Client erreicht WAN-IP
      var m=A.routerIfDom[rw.dstNodeId]||{};
      for(var lk in m){ var t=findEndpointInDomain(A, m[lk], pf.lanIp); if(t && !t.isRouter){ var dn2=A.byId[t.id];
        if(dn2 && fwBlocks(dn2, proto, port, srcIp)) return {ok:false, error:"Firewall am LAN-Host blockiert", dstNodeId:t.id};
        return {ok:true, dstNodeId:t.id, hops:rw.hops, forwarded:true}; } }
      return {ok:false, error:"LAN-Zielhost der Portfreigabe nicht erreichbar"};
    }
    var r=reach2(A, srcId, dstIp, {proto:proto, port:port});
    if(!r.ok) return r;
    var dn=A.byId[r.dstNodeId]; if(dn && fwBlocks(dn, proto, port, srcIp)) return {ok:false, error:"durch Firewall blockiert (Port "+(proto==="icmp"?"ICMP":port)+")", dstNodeId:r.dstNodeId};
    return r; }
  // E-Mail: Mailserver für eine Domain finden (im gesamten Netz)
  function mailServerFor(net, domain){ domain=String(domain||"").toLowerCase(); var ns=net.nodes||[]; for(var i=0;i<ns.length;i++){ var n=ns[i]; if(n.apps&&n.apps.mailserver && String(n.maildomain||"").toLowerCase()===domain) return n; } return null; }
  function parseAddr(a){ var m=String(a||"").trim().match(/^([^@\s]+)@([^@\s]+)$/); return m?{user:m[1], domain:m[2]}:null; }
  function mailAccount(server, user){ return (server.mailAccounts||[]).find(function(x){ return String(x.user||"").toLowerCase()===String(user||"").toLowerCase(); }); }
  // Kann die/der Client-Rechner eine Mail an toAddr zustellen? (Server existiert, Konto existiert, erreichbar)
  function mailCanDeliver(net, A, clientNode, toAddr){ var to=parseAddr(toAddr); if(!to) return {ok:false, error:"Ungültige Adresse"};
    var srv=mailServerFor(net, to.domain); if(!srv) return {ok:false, error:"Maildomain unbekannt (kein Mailserver)"};
    if(!mailAccount(srv, to.user)) return {ok:false, error:"Konto "+toAddr+" existiert nicht"};
    var srvIp=hostIp(A, srv); if(!srvIp) return {ok:false, error:"Mailserver hat keine IP"};
    var r=serviceReach(A, clientNode.id, srvIp, "tcp", 25); if(!r.ok) return {ok:false, error:"Mailserver nicht erreichbar ("+r.error+")"};
    return {ok:true, server:srv, to:to}; }
  function mailSend(net, clientNode, toAddr, subject, body){ var A=analyze(net); var chk=mailCanDeliver(net, A, clientNode, toAddr); if(!chk.ok) return chk;
    var srv=chk.server; srv.mailboxes=srv.mailboxes||{}; var key=String(chk.to.user).toLowerCase(); var box=srv.mailboxes[key]=srv.mailboxes[key]||[];
    var from=(clientNode.emailAccount&&clientNode.emailAccount.address)||"unbekannt";
    box.push({from:from, to:toAddr, subject:subject||"(kein Betreff)", body:body||"", ts:Date.now()}); return {ok:true}; }
  function mailFetch(net, clientNode){ var A=analyze(net); var acc=clientNode.emailAccount; if(!acc||!acc.address) return {ok:false, error:"Kein E-Mail-Konto eingerichtet", msgs:[]};
    var to=parseAddr(acc.address); if(!to) return {ok:false, error:"Konto-Adresse ungültig", msgs:[]};
    var srv=mailServerFor(net, to.domain); if(!srv) return {ok:false, error:"Eigener Mailserver nicht gefunden", msgs:[]};
    var srvIp=hostIp(A, srv); var r=serviceReach(A, clientNode.id, srvIp, "tcp", 110); if(!r.ok) return {ok:false, error:"Mailserver nicht erreichbar", msgs:[]};
    return {ok:true, msgs:((srv.mailboxes||{})[String(to.user).toLowerCase()])||[]}; }
  // Gnutella: erreichbare Peers mit einer Datei im Ordner /peer2peer
  function gnutellaSearch(net, nodeId, filename){ var A=analyze(net); var out=[]; (net.nodes||[]).forEach(function(n){ if(n.id===nodeId||!(n.apps&&n.apps.gnutella))return; var ip=hostIp(A,n); if(!ip)return; if(!serviceReach(A,nodeId,ip,"tcp",6346).ok)return;
    (fsList(fsOf(n),"/peer2peer")||[]).forEach(function(it){ if(!it.dir && (!filename || it.name.toLowerCase().indexOf(String(filename).toLowerCase())>=0)) out.push({id:n.id, peer:n.name, ip:ip, name:it.name, path:it.path}); }); }); return out; }
  function echoTest(net, clientId, target){ var A=analyze(net); var dstIp=validIp(target)?target:hostIp(A,nodeByName(net,target)); if(!dstIp) dstIp=resolveName(A,clientId,target); if(!dstIp) return {ok:false, error:"Ziel unbekannt"};
    var r=serviceReach(A, clientId, dstIp, "tcp", 7); if(!r.ok) return r; var dn=A.byId[r.dstNodeId]; if(!dn||!(dn.apps&&dn.apps.echo)) return {ok:false, error:"Auf dem Ziel läuft kein Echo-Server"}; return {ok:true, dstIp:dstIp}; }

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
      fields:[{k:"server",label:"DNS-Server (Name)",ph:"z. B. DNS"},{k:"name",label:"Domainname",ph:"z. B. www.filius.de"},{k:"ip",label:"soll-IP",ph:"z. B. 192.168.0.12"}] },
    email:  { label:"E-Mail zustellbar", desc:"Von einem E-Mail-Programm ist eine Mail an die Adresse zustellbar",
      fields:[{k:"from",label:"E-Mail-Programm auf (Name)",ph:"z. B. PC1"},{k:"to",label:"Empfänger-Adresse",ph:"z. B. bob@filius.de"}] }
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
    if(c.type==="email") return "E-Mail: "+(p.from||"?")+" → "+(p.to||"?");
    return t.label;
  }
  function evalCheck(net, A, c){
    var p=c.params||{};
    try{
      if(c.type==="count"){ var min=Math.max(1,+p.min||1); var cnt=0; (net.nodes||[]).forEach(function(n){ if(p.ntype==="host"){ if(isHost(n.type)) cnt++; } else if(p.ntype==="router"){ if(isRouterType(n.type)) cnt++; } else if(n.type===p.ntype) cnt++; }); return cnt>=min; }
      if(c.type==="ip_in_net"){ var nd=nodeByName(net,p.node); if(!nd||!isHost(nd.type)) return false; var ip=hostIp(A,nd); if(!ip) return false; var parts=String(p.net||"").split("/"); var na=parts[0], mk=parts[1]||"24"; return sameNet(ip, na, mk) && ipToInt(ip)!==netAddr(ip,mk); }
      if(c.type==="ping"||c.type==="noping"){ var from=nodeByName(net,p.from); if(!from||!isHost(from.type)) return c.type==="noping"; var toIp=validIp(p.to)?p.to:hostIp(A,nodeByName(net,p.to)); if(!toIp){ toIp=resolveName(A, from.id, p.to); } if(!toIp) return c.type==="noping"; var r=ping(A, from.id, toIp); return c.type==="ping"? !!r.ok : !r.ok; }
      if(c.type==="web"){ var b=nodeByName(net,p.from); if(!b||!isHost(b.type)||!(b.apps&&b.apps.webbrowser)) return false; var w=fetchWeb(A, b.id, p.url); return !!w.ok; }
      if(c.type==="dns"){ var s=nodeByName(net,p.server); if(!s||!(s.apps&&s.apps.dns)) return false; var recs=s.dnsRecords||[]; for(var i=0;i<recs.length;i++){ if(String(recs[i].name||"").toLowerCase()===String(p.name||"").toLowerCase() && recs[i].ip===p.ip) return true; } return false; }
      if(c.type==="email"){ var eb=nodeByName(net,p.from); if(!eb||!(eb.apps&&eb.apps.emailclient)) return false; return !!mailCanDeliver(net, A, eb, p.to).ok; }
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
    analyze:analyze, l3:l3, ping:ping, pingSim:pingSim, resolveName:resolveName, fetchWeb:fetchWeb,
    macFor:macFor, forwardingTable:forwardingTable, BROADCAST_MAC:BROADCAST_MAC,
    fs:{ of:fsOf, read:fsRead, write:fsWrite, list:fsList, mkdir:fsMkdir, rm:fsRm, resolve:fsResolve, isDir:fsIsDir, exists:fsExists, parent:fsParent, base:fsBase, norm:fsNorm, fileType:fileTypeOf },
    mailSend:mailSend, mailFetch:mailFetch, mailCanDeliver:function(net,cn,to){ return mailCanDeliver(net, analyze(net), cn, to); }, gnutellaSearch:gnutellaSearch, echoTest:echoTest, fwBlocks:fwBlocks, fwRouterBlocks:fwRouterBlocks, serviceReach:serviceReach, reach2:reach2, l3legs:l3legs, nodeByName:nodeByName, hostIp:hostIp, mailServerFor:mailServerFor, mailAccount:mailAccount, parseAddr:parseAddr,
    CHECK_TYPES:CHECK_TYPES, checkLabel:checkLabel, evalCheck:function(net,c){ return evalCheck(net, analyze(net||{}), c); }, evalChecks:evalChecks,
    isHost:isHost, isRouterType:isRouterType, resolveName2:function(net,srcId,name){ return resolveName(analyze(net), srcId, name); },
    fetchWebByName:function(net,srcId,url){ return fetchWeb(analyze(net), srcId, url); },
    pingByName:function(net,srcId,t){ return ping(analyze(net), srcId, t); },
    summary:function(net){ net=net||{}; var t={notebook:0,rechner:0,switch:0,router:0,gateway:0}; (net.nodes||[]).forEach(function(n){ if(t[n.type]!=null) t[n.type]++; }); return t; }
  };
  window.FiliusEngine=FiliusEngine;

})();

