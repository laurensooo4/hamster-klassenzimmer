/* ============================================================================
   POLISH – lebende Symbole & weiche Uebergaenge (uebernommen mit 2.47)
   Greift NICHT in die App-Logik ein: beobachtet das DOM nur von aussen und
   verpackt Emojis in <span class="pr-ico">, damit CSS sie animieren kann.
   ============================================================================ */
(function(){
  "use strict";
  var reduziert = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Emojis einpacken: ALLE Symbole der Seite leben --------------- */
  var EMOJI_RE=null;
  try{ EMOJI_RE=new RegExp("^([\\p{Extended_Pictographic}\\u{FE0F}\\u{200D}\\u{20E3}\\u{1F3FB}-\\u{1F3FF}]+)","u"); }catch(e){}
  var ZIELE=".btn,.abtn,.cbtn,.tool,.ticon,.badge,.chip,.menu-item,.crumb,.brand,.empty,.page-head h2,h2,h3,.row .t,.stat .k,.cell,.hv-ph,.edbar span,.smtab,.sicon";
  function packeEmojis(wurzel){
    if(!EMOJI_RE || !wurzel || !wurzel.querySelectorAll) return;
    var elemente;
    try{ elemente=wurzel.querySelectorAll(ZIELE); }catch(e){ return; }
    for(var i=0;i<elemente.length;i++){
      var el=elemente[i];
      /* schon verpackt UND Verpackung noch vorhanden? Der Start-Knopf z. B.
         schreibt seinen Text bei jedem Zustandswechsel neu - dann ist der
         Span weg und wir verpacken einfach nochmal. */
      if(el.firstElementChild && el.firstElementChild.classList && el.firstElementChild.classList.contains("pr-ico")) continue;
      if(el.dataset && el.dataset.prIco==="0") continue;
      if(el.closest && el.closest(".editor,.codebox,textarea,pre,code,.out")) continue;
      /* nur den ERSTEN Textknoten ansehen - Handler und Struktur bleiben heil */
      var kind=el.firstChild;
      /* auch: Emoji steckt in einem reinen Text-Kind weiter vorn (z. B. nach Leerraum) */
      var hops=0;
      while(kind && kind.nodeType===3 && !kind.nodeValue.trim() && hops<3){ kind=kind.nextSibling; hops++; }
      if(!kind || kind.nodeType!==3) { if(el.dataset) el.dataset.prIco="0"; continue; }
      var text=kind.nodeValue, fuehrend=text.replace(/^\s+/,""), einzug=text.slice(0,text.length-fuehrend.length);
      var m=fuehrend.match(EMOJI_RE);
      if(!m){ if(el.dataset) el.dataset.prIco="0"; continue; }
      var span=document.createElement("span");
      span.className="pr-ico"; span.textContent=m[1];
      var rest=document.createTextNode(einzug===""?fuehrend.slice(m[1].length):einzug+fuehrend.slice(m[1].length));
      el.replaceChild(rest, kind);
      el.insertBefore(span, rest);
      if(einzug!==""){ el.insertBefore(document.createTextNode(einzug), span); }
    }
  }

  /* ---------- Gestaffeltes Erscheinen bei jedem Seitenwechsel -------------- */
  function staffeln(wurzel){
    if(reduziert || !wurzel) return;
    var kinder=[].slice.call(wurzel.children).filter(function(el){
      return el.offsetHeight>0 || el.children.length;
    }).slice(0,18);
    kinder.forEach(function(el,i){
      el.classList.remove("pr-in");
      void el.offsetWidth;
      el.style.animationDelay=(i*45)+"ms";
      el.classList.add("pr-in");
      el.addEventListener("animationend",function h(){
        el.classList.remove("pr-in"); el.style.animationDelay="";
        el.removeEventListener("animationend",h);
      });
    });
  }

  var geplant=false;
  function nachRender(){
    if(geplant) return; geplant=true;
    /* setTimeout statt requestAnimationFrame: das laeuft auch, wenn der Tab
       gerade im Hintergrund liegt (rAF pausiert dort komplett). */
    setTimeout(function(){
      geplant=false;
      packeEmojis(document.body);
    }, 90);
  }
  var app=document.getElementById("app");
  var mo=new MutationObserver(function(muts){
    var viewNeu=false, view=document.getElementById("view");
    for(var i=0;i<muts.length;i++){
      var m=muts[i];
      if(m.type!=="childList") continue;
      if(view && (m.target===view || (app && m.target===app))) viewNeu=true;
    }
    if(viewNeu) staffeln(view);
    nachRender();
  });
  mo.observe(document.body,{childList:true,subtree:true});
  packeEmojis(document.body);

})();
