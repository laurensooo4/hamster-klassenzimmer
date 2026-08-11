"use strict";
/* ============================================================================
   engine.js — Hamster-Werkzeug als wiederverwendbare Komponente (HamsterView)
   Eigenständige JavaScript-Neuimplementierung: eigener Parser, eigener
   Interpreter, eigene SVG-Grafik (übernommen aus unserem Projekt hamster-web).
   Es wurde KEIN Programmcode und KEINE Grafik aus dem Java-Hamster-Simulator
   von Dietrich Boles übernommen; nachgebildet ist nur das didaktische Konzept
   (Befehlsnamen, Territorium, Körner) — Ideen und Schnittstellen sind nach
   § 69a Abs. 2 UrhG nicht geschützt. Vorbild: www.java-hamster-modell.de
   Herkunftsangaben: siehe lizenzen.html
   Board/Editor/Steuerung, gekapselt pro Container. Modi: 'solve'|'design'|'view'.
   ============================================================================ */
(function(){

const DIRS=[
  {dr:-1,dc:0, deg:0,   name:"Norden", abk:"N ↑"},
  {dr:0, dc:1, deg:90,  name:"Osten",  abk:"O →"},
  {dr:1, dc:0, deg:180, name:"Süden",  abk:"S ↓"},
  {dr:0, dc:-1,deg:270, name:"Westen", abk:"W ←"},
];
const NORD=0, OST=1, SUED=2, WEST=3;
const HAMSTER_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="29" cy="33" rx="13" ry="13" fill="#b07d4e"/><ellipse cx="71" cy="33" rx="13" ry="13" fill="#b07d4e"/>
  <ellipse cx="29" cy="34" rx="6.5" ry="6.5" fill="#e7c79c"/><ellipse cx="71" cy="34" rx="6.5" ry="6.5" fill="#e7c79c"/>
  <ellipse cx="50" cy="57" rx="35" ry="39" fill="#cda06b"/>
  <ellipse cx="26" cy="62" rx="14" ry="17" fill="#dcb887"/><ellipse cx="74" cy="62" rx="14" ry="17" fill="#dcb887"/>
  <ellipse cx="50" cy="50" rx="23" ry="26" fill="#e8cda1"/>
  <circle cx="40" cy="46" r="5" fill="#3a2a1a"/><circle cx="60" cy="46" r="5" fill="#3a2a1a"/>
  <circle cx="41.7" cy="44.3" r="1.7" fill="#fff"/><circle cx="61.7" cy="44.3" r="1.7" fill="#fff"/>
  <path d="M50 22 l7 9 h-14 z" fill="#d4677a"/>
  <ellipse cx="50" cy="33" rx="6" ry="4.5" fill="#d4677a"/>
  <line x1="50" y1="35" x2="50" y2="42" stroke="#a8485a" stroke-width="1.4"/>
  <g stroke="#fff" stroke-width="1.1" opacity=".85" stroke-linecap="round">
    <line x1="44" y1="36" x2="22" y2="32"/><line x1="44" y1="39" x2="22" y2="40"/>
    <line x1="56" y1="36" x2="78" y2="32"/><line x1="56" y1="39" x2="78" y2="40"/>
  </g></svg>`;
function beep(){}   // (Sound im Klassenzimmer deaktiviert)

/* ---------- Befehls-Übersicht (Spickzettel im Editor) ---------- */
const CHEAT_HTML = `
  <h4>Hamster-Befehle</h4>
  <div class="crow"><code>vor();</code><span>einen Schritt nach vorn gehen</span></div>
  <div class="crow"><code>linksUm();</code><span>nach links drehen (90°)</span></div>
  <div class="crow"><code>gib();</code><span>ein Korn ablegen</span></div>
  <div class="crow"><code>nimm();</code><span>ein Korn fressen</span></div>
  <div class="crow"><code>schreib("Text");</code><span>etwas ausgeben</span></div>
  <h4>Tests &amp; Sensoren</h4>
  <div class="crow"><code>vornFrei()</code><span>true, wenn vorne keine Mauer ist</span></div>
  <div class="crow"><code>kornDa()</code><span>true, wenn ein Korn auf dem Feld liegt</span></div>
  <div class="crow"><code>maulLeer()</code><span>true, wenn das Maul leer ist</span></div>
  <div class="crow"><code>getAnzahlKoerner()</code><span>Körner im Maul</span></div>
  <div class="crow"><code>getReihe()  getSpalte()</code><span>aktuelle Position</span></div>
  <div class="crow"><code>getBlickrichtung()</code><span>NORD / OST / SUED / WEST</span></div>
  <h4>Kontrollstrukturen</h4>
  <div class="crow"><code>if (…) { … } else { … }</code><span>Verzweigung</span></div>
  <div class="crow"><code>while (…) { … }</code><span>Schleife (kopfgesteuert)</span></div>
  <div class="crow"><code>do { … } while (…);</code><span>Schleife (mind. 1×)</span></div>
  <div class="crow"><code>for (int i=0; i&lt;n; i++) { … }</code><span>Zählschleife</span></div>
  <div class="crow"><code>&amp;&amp;   ||   !</code><span>und / oder / nicht</span></div>
  <h4>Eigene Methoden</h4>
  <div class="crow"><code>void name() { … }</code><span>eigene Prozedur</span></div>
  <div class="crow"><code>boolean test() { … }</code><span>eigene Testfunktion</span></div>
  <div class="crow"><code>int wert() { … }</code><span>eigene Funktion mit Zahl</span></div>
  <h4>Datentypen &amp; Variablen</h4>
  <div class="crow"><code>int i = 0;</code><span>Ganzzahl (immer mit Typ!)</span></div>
  <div class="crow"><code>double x = 1.5;</code><span>Kommazahl</span></div>
  <div class="crow"><code>boolean b = true;</code><span>Wahrheitswert</span></div>
  <div class="crow"><code>char c = 'A';</code><span>einzelnes Zeichen</span></div>
  <div class="crow"><code>String s = "Hallo";</code><span>Text-Variable</span></div>
  <div class="crow"><code>int[] a = new int[5];</code><span>Array anlegen</span></div>
  <h4>Territorium</h4>
  <div class="crow"><code>Territorium.mauerDa(r,s)</code><span>Mauer an (r,s)?</span></div>
  <div class="crow"><code>Territorium.getAnzahlReihen()</code><span>Anzahl Reihen</span></div>
  <div class="crow"><code>Territorium.getAnzahlSpalten()</code><span>Anzahl Spalten</span></div>
  <div class="crow"><code>Territorium.getAnzahlKoerner(r,s)</code><span>Körner auf (r,s)</span></div>
`;

/* ---------- LEXER ---------- */
function lex(src){
  const toks=[]; let i=0, line=1;
  const KW=["void","boolean","int","double","char","if","else","while","do","for","return","break","continue","true","false","new"];
  const push=(type,value)=>toks.push({type,value,line});
  const isIdStart=c=>/[A-Za-z_À-ſ]/.test(c);
  const isId=c=>/[A-Za-z0-9_À-ſ]/.test(c);
  while(i<src.length){
    const c=src[i];
    if(c==="\n"){line++;i++;continue;}
    if(c===" "||c==="\t"||c==="\r"){i++;continue;}
    if(c==="/"&&src[i+1]==="/"){ while(i<src.length&&src[i]!=="\n")i++; continue; }
    if(c==="/"&&src[i+1]==="*"){ i+=2; while(i<src.length&&!(src[i]==="*"&&src[i+1]==="/")){ if(src[i]==="\n")line++; i++; } i+=2; continue; }
    if(c==='"'){ let s="",st=line; i++; while(i<src.length&&src[i]!=='"'){ if(src[i]==="\\"){ const n=src[i+1]; s+= n==="n"?"\n":n==="t"?"\t":n; i+=2; } else { if(src[i]==="\n")line++; s+=src[i]; i++; } } if(i>=src.length) throw {hamsterError:true, message:"Text wurde nicht geschlossen – es fehlt ein abschließendes \"", line:st}; i++; toks.push({type:"string",value:s,line:st}); continue; }
    if(/[0-9]/.test(c)){ let n=""; while(i<src.length&&/[0-9]/.test(src[i])){n+=src[i];i++;}
      if(src[i]==="."&&/[0-9]/.test(src[i+1])){ n+="."; i++; while(i<src.length&&/[0-9]/.test(src[i])){n+=src[i];i++;} push("num",parseFloat(n)); }
      else push("int",parseInt(n,10)); continue; }
    if(c==="'"){ let st=line; i++; let ch; if(src[i]==="\\"){ const e=src[i+1]; ch = e==="n"?"\n":e==="t"?"\t":e==="0"?"\0":e; i+=2; } else { if(src[i]==="\n")line++; ch=src[i]; i++; } if(src[i]!=="'") throw {hamsterError:true, message:"Zeichen (') wurde nicht korrekt geschlossen – ein char enthält genau ein Zeichen, z. B. 'a'", line:st}; i++; toks.push({type:"char",value:(ch==null||ch==="")?0:ch.charCodeAt(0),line:st}); continue; }
    if(isIdStart(c)){ let id=""; while(i<src.length&&isId(src[i])){id+=src[i];i++;} push(KW.includes(id)?id:"ident",id); continue; }
    const two=src.substr(i,2);
    if(["&&","||","==","!=","<=",">=","++","--","+=","-="].includes(two)){ push("op",two); i+=2; continue; }
    if("+-*/%<>=!(){};,.[]".includes(c)){ push("op",c); i++; continue; }
    throw {hamsterError:true, message:"Unerwartetes Zeichen: '"+c+"'", line};
  }
  push("eof",null);
  return toks;
}

/* ---------- PARSER ---------- */
function parse(src){
  const toks=lex(src); let p=0;
  const tk=()=>toks[p];
  const isOp=v=>tk().type==="op"&&tk().value===v;
  const isKw=v=>tk().type===v;
  const perr=m=>{ const t=tk(); throw {hamsterError:true, message:"Syntaxfehler: "+m+" (bei '"+(t.value===null?"Ende":t.value)+"')", line:t.line}; };
  const eatOp=v=>{ if(!isOp(v))perr("'"+v+"' erwartet"); return toks[p++]; };
  const eatKw=v=>{ if(!isKw(v))perr("'"+v+"' erwartet"); return toks[p++]; };
  const eatId=()=>{ if(tk().type!=="ident")perr("Name erwartet"); return toks[p++]; };
  const MODS=["public","private","protected","static","final","abstract"];
  const skipMods=()=>{ while(tk().type==="ident"&&MODS.includes(tk().value))p++; };
  function program(){
    skipMods();
    if(tk().type==="ident"&&["class","import","package","interface","enum"].includes(tk().value))
      perr("Klassen-/import-Syntax wird hier nicht unterstützt – bitte nur Methoden und 'void main()' verwenden");
    if(!looksLikeMethod())
      perr(tk().type==="eof" ? "Es fehlt 'void main() { … }'." : "Dein Programm muss in einer Methode stehen – beginne mit 'void main() { … }'.");
    const methods={};
    while(tk().type!=="eof"){ skipMods(); if(tk().type==="eof")break; const m=method(); methods[m.name]=m; }
    if(!methods.main) perr("Es fehlt 'void main() { … }'.");
    return {methods, main:methods.main.body};
  }
  function startsType(){ const t=tk(); return t.type==="int"||t.type==="boolean"||t.type==="double"||t.type==="char"||(t.type==="ident"&&t.value==="String"); }
  function parseType(allowVoid){
    const t=tk(); let base;
    if(t.type==="int"||t.type==="boolean"||t.type==="double"||t.type==="char"){ base=t.value; p++; }
    else if(allowVoid&&t.type==="void"){ p++; return {base:"void",arr:false}; }
    else if(t.type==="ident"&&t.value==="String"){ base="String"; p++; }
    else perr("Typ erwartet");
    let arr=false; if(isOp("[")){ p++; eatOp("]"); arr=true; }
    return {base,arr};
  }
  function declAhead(){
    const t=tk();
    if(t.type==="int"||t.type==="boolean"||t.type==="double"||t.type==="char") return true;
    if(toks[p+1]&&toks[p+1].type==="op"&&toks[p+1].value==="[") return !!(toks[p+2]&&toks[p+2].value==="]");
    return !!(toks[p+1]&&toks[p+1].type==="ident");
  }
  function looksLikeMethod(){
    const t=tk();
    if(!(t.type==="void"||t.type==="int"||t.type==="boolean"||t.type==="double"||t.type==="char"||(t.type==="ident"&&t.value==="String"))) return false;
    let q=p+1;
    if(toks[q]&&toks[q].type==="op"&&toks[q].value==="["){ if(!(toks[q+1]&&toks[q+1].value==="]")) return false; q+=2; }
    return toks[q]&&toks[q].type==="ident"&&toks[q+1]&&toks[q+1].type==="op"&&toks[q+1].value==="(";
  }
  function method(){
    const line=tk().line; const ret=parseType(true); const name=eatId().value;
    eatOp("("); const params=[];
    if(!isOp(")")){ do{ const pty=parseType(false); params.push({type:pty.base,isArr:pty.arr,name:eatId().value}); }while(commaIf()); }
    eatOp(")"); return {retType:ret.base,retArr:ret.arr,name,params,body:block(),line};
  }
  const commaIf=()=>{ if(isOp(",")){p++;return true;} return false; };
  function block(){ eatOp("{"); const b=[]; while(!isOp("}")){ if(tk().type==="eof")perr("'}' erwartet"); b.push(statement()); } eatOp("}"); return b; }
  function statement(){
    const t=tk();
    if(isOp("{")) return {kind:"block",body:block(),line:t.line};
    if(startsType()&&declAhead()) return varDecl();
    if(t.type==="if") return ifStmt();
    if(t.type==="while") return whileStmt();
    if(t.type==="do") return doStmt();
    if(t.type==="for") return forStmt();
    if(t.type==="return"){ p++; let v=null; if(!isOp(";"))v=expr(); eatOp(";"); return {kind:"return",value:v,line:t.line}; }
    if(t.type==="break"){ p++; eatOp(";"); return {kind:"break",line:t.line}; }
    if(t.type==="continue"){ p++; eatOp(";"); return {kind:"continue",line:t.line}; }
    if(isOp(";")){ p++; return {kind:"empty",line:t.line}; }
    if(t.type==="ident"){
      const n=toks[p+1];
      if(n.type==="op"&&n.value==="("){ const c=call(); eatOp(";"); return {kind:"callstmt",call:c,line:t.line}; }
      if(n.type==="op"&&n.value==="["){ const name=eatId().value; eatOp("["); const idx=expr(); eatOp("]"); if(!(isOp("=")||isOp("+=")||isOp("-=")))perr("'=' erwartet"); const op=toks[p++].value; const v=expr(); eatOp(";"); return {kind:"arrset",name,idx,op,value:v,line:t.line}; }
      if(n.type==="op"&&["=","+=","-="].includes(n.value)){ p++; const op=toks[p++].value; const v=expr(); eatOp(";"); return {kind:"assign",name:t.value,op,value:v,line:t.line}; }
      if(n.type==="op"&&["++","--"].includes(n.value)){ p++; const op=toks[p++].value; eatOp(";"); return {kind:"incdec",name:t.value,op,line:t.line}; }
    }
    perr("Anweisung erwartet");
  }
  function varDecl(){ const line=tk().line; const ty=parseType(false); const name=eatId().value; let init=null; if(isOp("=")){p++;init=expr();} eatOp(";"); return {kind:"vardecl",varType:ty.base,isArr:ty.arr,name,init,line}; }
  function ifStmt(){ const line=tk().line;p++; eatOp("("); const c=expr(); eatOp(")"); const th=[statement()]; let el=null; if(tk().type==="else"){p++; el=[statement()];} return {kind:"if",cond:c,then:th,els:el,line}; }
  function whileStmt(){ const line=tk().line;p++; eatOp("("); const c=expr(); eatOp(")"); return {kind:"while",cond:c,body:[statement()],line}; }
  function doStmt(){ const line=tk().line;p++; const b=[statement()]; eatKw("while"); eatOp("("); const c=expr(); eatOp(")"); eatOp(";"); return {kind:"dowhile",body:b,cond:c,line}; }
  function forStmt(){
    const line=tk().line;p++; eatOp("(");
    let init=null; if(!isOp(";")) init=forSimple(true); eatOp(";");
    let cond=null; if(!isOp(";")) cond=expr(); eatOp(";");
    let upd=null; if(!isOp(")")) upd=forSimple(false); eatOp(")");
    return {kind:"for",init,cond,update:upd,body:[statement()],line};
  }
  function forSimple(allowDecl){
    const t=tk();
    if(allowDecl&&startsType()&&declAhead()){ const line=t.line; const ty=parseType(false); const name=eatId().value; let init=null; if(isOp("=")){p++;init=expr();} return {kind:"vardecl",varType:ty.base,isArr:ty.arr,name,init,line}; }
    const name=eatId().value;
    if(isOp("++")||isOp("--")){ const op=toks[p++].value; return {kind:"incdec",name,op,line:t.line}; }
    if(isOp("=")||isOp("+=")||isOp("-=")){ const op=toks[p++].value; const v=expr(); return {kind:"assign",name,op,value:v,line:t.line}; }
    perr("Ungültiger for-Ausdruck");
  }
  function call(){ const t=tk(); const name=eatId().value; eatOp("("); const args=[]; if(!isOp(")")){ do{ args.push(expr()); }while(commaIf()); } eatOp(")"); return {kind:"call",name,args,line:t.line}; }
  function expr(){ return orE(); }
  function orE(){ let l=andE(); while(isOp("||")){p++; l={kind:"bin",op:"||",l,r:andE()};} return l; }
  function andE(){ let l=eqE(); while(isOp("&&")){p++; l={kind:"bin",op:"&&",l,r:eqE()};} return l; }
  function eqE(){ let l=relE(); while(isOp("==")||isOp("!=")){const op=toks[p++].value; l={kind:"bin",op,l,r:relE()};} return l; }
  function relE(){ let l=addE(); while(isOp("<")||isOp(">")||isOp("<=")||isOp(">=")){const op=toks[p++].value; l={kind:"bin",op,l,r:addE()};} return l; }
  function addE(){ let l=mulE(); while(isOp("+")||isOp("-")){const op=toks[p++].value; l={kind:"bin",op,l,r:mulE()};} return l; }
  function mulE(){ let l=unary(); while(isOp("*")||isOp("/")||isOp("%")){const op=toks[p++].value; l={kind:"bin",op,l,r:unary()};} return l; }
  function unary(){
    if(isOp("(") && toks[p+1] && (toks[p+1].type==="int"||toks[p+1].type==="double"||toks[p+1].type==="char") && toks[p+2] && toks[p+2].type==="op" && toks[p+2].value===")"){
      const line=tk().line; p++; const to=tk().value; p++; eatOp(")"); return {kind:"cast", to, e:unary(), line};
    }
    if(isOp("!")){p++; return {kind:"not",e:unary()};} if(isOp("-")){p++; return {kind:"neg",e:unary()};} if(isOp("+")){p++; return unary();} return postfix(); }
  function postfix(){
    let node=primary();
    while(true){
      if(isOp("[")){ p++; const idx=expr(); eatOp("]"); node={kind:"index",arr:node,idx}; }
      else if(isOp(".")){ p++; const nm=eatId().value;
        if(isOp("(")){ p++; const args=[]; if(!isOp(")")){do{args.push(expr());}while(commaIf());} eatOp(")"); node={kind:"mcall",obj:node,name:nm,args}; }
        else node={kind:"member",obj:node,name:nm};
      } else break;
    }
    return node;
  }
  function primary(){
    const t=tk();
    if(t.type==="int"){p++; return {kind:"int",v:t.value};}
    if(t.type==="num"){p++; return {kind:"num",v:t.value};}
    if(t.type==="char"){p++; return {kind:"char",v:t.value};}
    if(t.type==="true"){p++; return {kind:"bool",v:true};}
    if(t.type==="false"){p++; return {kind:"bool",v:false};}
    if(t.type==="string"){p++; return {kind:"str",v:t.value};}
    if(isOp("(")){p++; const e=expr(); eatOp(")"); return e;}
    if(isOp("{")){ p++; const elems=[]; if(!isOp("}")){do{elems.push(expr());}while(commaIf());} eatOp("}"); return {kind:"arraylit",elems}; }
    if(t.type==="new"){ p++; const bt=tk(); let base; if(bt.type==="int"||bt.type==="boolean"||bt.type==="double"||bt.type==="char"){base=bt.value;p++;} else if(bt.type==="ident"&&bt.value==="String"){base="String";p++;} else perr("nach 'new' wird ein Array-Typ erwartet (z. B. new int[5])"); eatOp("["); const size=expr(); eatOp("]"); return {kind:"newarray",base,size}; }
    if(t.type==="ident"){ const n=toks[p+1]; if(n.type==="op"&&n.value==="(") return call(); p++; return {kind:"ref",name:t.value,line:t.line}; }
    perr("Ausdruck erwartet");
  }
  return program();
}

/* ---------- COMPILE-CHECK (Semantik: Deklaration, TYPEN, Gültigkeitsbereiche) ----------
   Prüft: Variablen mit Datentyp deklariert (vor Gebrauch); Zuweisungen passen zum Typ
   (int/double/boolean/String/char + 1D-Arrays); keine doppelten lokalen Namen/Parameter;
   break/continue nur in Schleifen. Annotiert '/' mit intDiv (Ganzzahl- vs. Kommadivision). */
function compileCheck(ast){
  const GLOBT={Territorium:"object"};
  ["NORD","OST","SUED","WEST","BLAU","BLUE","ROT","RED","GRUEN","GREEN","GELB","YELLOW","CYAN","MAGENTA","ORANGE","PINK","GRAU","GRAY","WEISS","WHITE"].forEach(k=>GLOBT[k]="int");
  const methods=ast.methods||{};
  const BRET={vor:"void",linksUm:"void",gib:"void",nimm:"void",schreib:"void",vornFrei:"boolean",kornDa:"boolean",maulLeer:"boolean",getAnzahlKoerner:"int",getReihe:"int",getSpalte:"int",getBlickrichtung:"int",liesZahl:"int",liesZeichenkette:"String"};
  const cerr=(msg,line)=>{ throw {hamsterError:true, message:"Compilerfehler: "+msg, line}; };
  const lookup=(name,scopes)=>{ for(let i=scopes.length-1;i>=0;i--) if(scopes[i].has(name)) return scopes[i].get(name); if(name in GLOBT) return GLOBT[name]; return undefined; };
  const inChain=(name,scopes)=>{ for(const sc of scopes) if(sc.has(name)) return true; return false; };
  function tOf(e,scopes){
    if(!e||typeof e!=="object") return "unknown";
    switch(e.kind){
      case "int": return "int"; case "num": return "double"; case "char": return "char"; case "str": return "String"; case "bool": return "boolean";
      case "ref": { const t=lookup(e.name,scopes); return t||"unknown"; }
      case "neg": return tOf(e.e,scopes)==="double"?"double":"int";
      case "not": return "boolean";
      case "index": { const at=tOf(e.arr,scopes); return at.slice(-2)==="[]"?at.slice(0,-2):"unknown"; }
      case "newarray": return e.base+"[]";
      case "arraylit": return "arraylit";
      case "member": return e.name==="length"?"int":"unknown";
      case "cast": return e.to;
      case "toStr": return "String";
      case "call": { const b=BRET[e.name]; if(b!==undefined) return b; const m=methods[e.name]; return m?((m.retType||"void")+(m.retArr?"[]":"")):"unknown"; }
      case "mcall": {
        if(e.obj&&e.obj.kind==="ref"&&e.obj.name==="Territorium") return e.name==="mauerDa"?"boolean":"int";
        switch(e.name){ case "length":return "int"; case "charAt":return "char"; case "substring":return "String"; case "indexOf":return "int"; case "equals":return "boolean"; case "toUpperCase":case "toLowerCase":return "String"; }
        return "unknown";
      }
      case "bin": {
        const op=e.op;
        if(op==="&&"||op==="||"||op==="=="||op==="!="||op==="<"||op===">"||op==="<="||op===">=") return "boolean";
        const lt=tOf(e.l,scopes), rt=tOf(e.r,scopes);
        if(op==="+"){ if(lt==="String"||rt==="String") return "String"; if(lt==="unknown"||rt==="unknown") return "unknown"; if(lt==="double"||rt==="double") return "double"; return "int"; }
        if(lt==="unknown"||rt==="unknown") return "unknown";
        if(lt==="double"||rt==="double") return "double";
        return "int";
      }
    }
    return "unknown";
  }
  // Java-Zuweisungsregeln: int->double, char->int/double (Widening), int-Literal->char (Konstante).
  const canAssign=(T,S,src)=>{
    if(T===S) return true;
    if(T==="double" && (S==="int"||S==="char")) return true;
    if(T==="int" && S==="char") return true;
    if(T==="char" && S==="int") return !!(src && src.kind==="int");
    return false;
  };
  function checkAssign(T,src,scopes,line){
    if(src&&src.kind==="arraylit"){
      if(T.slice(-2)!=="[]") cerr("Eine Werteliste { … } kann nur einem Array-Typ (z. B. int[]) zugewiesen werden.", line);
      const et=T.slice(0,-2); for(const el of src.elems) checkAssign(et,el,scopes,line); return;
    }
    const S=tOf(src,scopes);
    if(S==="unknown"||T==="unknown"||T==="object"||S==="arraylit") return;
    if(!canAssign(T,S,src)){
      if(T==="char"&&S==="int") cerr("Einer char-Variablen kann eine int-Zahl nur als Literal (z. B. char c = 65;) oder mit (char)-Umwandlung zugewiesen werden.", line);
      else cerr("Einer Variablen vom Typ "+T+" kann kein Wert vom Typ "+S+" zugewiesen werden.", line);
    }
  }
  // Wandelt char/double-Ausdrücke in String-Kontexten (schreib, '+'-Verkettung) typgerecht um.
  const strWrap=(node,scopes)=>{ const t=tOf(node,scopes); if(t==="char") return {kind:"toStr", how:"char", e:node}; if(t==="double") return {kind:"toStr", how:"double", e:node}; return node; };
  function chkExpr(e,scopes){
    if(!e||typeof e!=="object") return;
    switch(e.kind){
      case "int": case "num": case "char": case "bool": case "str": break;
      case "ref": if(lookup(e.name,scopes)===undefined) cerr("Die Variable '"+e.name+"' wurde nicht deklariert. Deklariere sie zuerst mit einem Datentyp, z. B. \"int "+e.name+";\".", e.line); break;
      case "call": for(const a of e.args) chkExpr(a,scopes); break;
      case "bin": chkExpr(e.l,scopes); chkExpr(e.r,scopes);
        if(e.op==="/"){ const lt=tOf(e.l,scopes), rt=tOf(e.r,scopes); e.intDiv = !(lt==="double"||rt==="double"); }
        else if(e.op==="+" && tOf(e,scopes)==="String"){ e.l=strWrap(e.l,scopes); e.r=strWrap(e.r,scopes); }
        break;
      case "not": case "neg": case "cast": case "toStr": chkExpr(e.e,scopes); break;
      case "index": chkExpr(e.arr,scopes); chkExpr(e.idx,scopes); break;
      case "newarray": chkExpr(e.size,scopes); break;
      case "arraylit": for(const x of e.elems) chkExpr(x,scopes); break;
      case "member": chkExpr(e.obj,scopes); break;
      case "mcall": if(!(e.obj&&e.obj.kind==="ref"&&e.obj.name==="Territorium")) chkExpr(e.obj,scopes); for(const a of e.args) chkExpr(a,scopes); break;
    }
  }
  const declType=s=> s.varType+(s.isArr?"[]":"");
  function chkBlock(list,scopes,inLoop){ const sc=new Map(); const s2=scopes.concat([sc]); for(const st of (list||[])) chkStmt(st,s2,sc,inLoop); }
  function chkStmt(s,scopes,cur,inLoop){
    switch(s.kind){
      case "vardecl":
        if(inChain(s.name,scopes)) cerr("In diesem Gültigkeitsbereich gibt es bereits eine Variable oder einen Parameter namens '"+s.name+"'.", s.line);
        if(s.init){ chkExpr(s.init,scopes); checkAssign(declType(s), s.init, scopes, s.line); }
        cur.set(s.name, declType(s)); break;
      case "assign": {
        const vt=lookup(s.name,scopes);
        if(vt===undefined) cerr("Die Variable '"+s.name+"' wurde nicht deklariert. Deklariere sie zuerst mit einem Datentyp, z. B. \"int "+s.name+";\".", s.line);
        if(s.value) chkExpr(s.value,scopes);
        if(s.op==="=" && vt!==undefined && s.value) checkAssign(vt, s.value, scopes, s.line);
        break; }
      case "incdec":
        if(lookup(s.name,scopes)===undefined) cerr("Die Variable '"+s.name+"' wurde nicht deklariert. Deklariere sie zuerst mit einem Datentyp, z. B. \"int "+s.name+";\".", s.line); break;
      case "arrset":
        if(lookup(s.name,scopes)===undefined) cerr("Die Variable '"+s.name+"' wurde nicht deklariert (z. B. \"int[] "+s.name+";\").", s.line);
        chkExpr(s.idx,scopes); chkExpr(s.value,scopes); break;
      case "callstmt":
        for(const a of s.call.args) chkExpr(a,scopes);
        if(s.call.name==="schreib") s.call.args = s.call.args.map(a=>strWrap(a,scopes));
        break;
      case "block": chkBlock(s.body,scopes,inLoop); break;
      case "if": chkExpr(s.cond,scopes); chkBlock(s.then,scopes,inLoop); if(s.els) chkBlock(s.els,scopes,inLoop); break;
      case "while": chkExpr(s.cond,scopes); chkBlock(s.body,scopes,true); break;
      case "dowhile": chkBlock(s.body,scopes,true); chkExpr(s.cond,scopes); break;
      case "for":{ const fs=new Map(); const sc=scopes.concat([fs]); if(s.init) chkStmt(s.init,sc,fs,inLoop); if(s.cond) chkExpr(s.cond,sc); if(s.update) chkStmt(s.update,sc,fs,inLoop); chkBlock(s.body,sc,true); break; }
      case "break": case "continue": if(!inLoop) cerr("'"+s.kind+"' ist nur innerhalb einer Schleife (while, for, do) erlaubt.", s.line); break;
      case "return": if(s.value) chkExpr(s.value,scopes); break;
    }
  }
  for(const name in methods){ const m=methods[name]; const ps=new Map(); (m.params||[]).forEach(p=>ps.set(p.name, p.type+(p.isArr?"[]":""))); chkBlock(m.body,[ps],false); }
  if(ast.main && !methods.main) chkBlock(ast.main, [], false);
}

/* ---------- INTERPRETER ---------- */
function Env(parent){ this.parent=parent; this.vars=new Map(); }
Env.prototype.declare=function(n,v){ this.vars.set(n,v); };
Env.prototype.has=function(n){ return this.vars.has(n)|| (this.parent?this.parent.has(n):false); };
Env.prototype.get=function(n){ if(this.vars.has(n))return this.vars.get(n); if(this.parent)return this.parent.get(n); throw {hamsterError:true,message:"Unbekannte Variable: "+n}; };
Env.prototype.set=function(n,v){ if(this.vars.has(n)){this.vars.set(n,v);return;} if(this.parent&&this.parent.has(n)){this.parent.set(n,v);return;} this.vars.set(n,v); };

function makeInterpreter(ast, model){
  const methods=ast.methods;
  const globalEnv=new Env(null);
  const consts={NORD:0,OST:1,SUED:2,WEST:3,BLAU:0,BLUE:0,ROT:1,RED:1,GRUEN:2,GREEN:2,GELB:3,YELLOW:3,CYAN:4,MAGENTA:5,ORANGE:6,PINK:7,GRAU:8,GRAY:8,WEISS:9,WHITE:9};
  for(const k in consts) globalEnv.declare(k,consts[k]);
  let steps=0, curLine=0;
  const guard=()=>{ if(++steps>6000000) throw {hamsterError:true,message:"Zu viele Schritte – vermutlich eine Endlosschleife. (Stopp gedrückt?)",line:curLine}; };
  const herr=(type,msg,line)=>({hamsterError:true,type,message:msg,line});
  const rerr=(msg)=>({hamsterError:true,message:msg,line:curLine});
  const ham=()=>model.hamster;
  const front=()=>{ const h=ham(); return {r:h.row+DIRS[h.dir].dr, c:h.col+DIRS[h.dir].dc}; };
  const blocked=t=> t.r<0||t.c<0||t.r>=model.rows||t.c>=model.cols||model.walls.has(t.r+","+t.c);
  const grainsAt=(r,c)=> model.grains.get(r+","+c)||0;
  const addGrain=(r,c,d)=>{ const k=r+","+c; const n=(model.grains.get(k)||0)+d; if(n<=0)model.grains.delete(k); else model.grains.set(k,n); };
  function territorium(name,args){
    switch(name){
      case "getAnzahlReihen": return model.rows;
      case "getAnzahlSpalten": return model.cols;
      case "mauerDa":{ const r=args[0],c=args[1]; return r<0||c<0||r>=model.rows||c>=model.cols||model.walls.has(r+","+c); }
      case "getAnzahlKoerner":
        if(args.length>=2){ const r=args[0],c=args[1]; if(r<0||c<0||r>=model.rows||c>=model.cols||model.walls.has(r+","+c)) return 0; return model.grains.get(r+","+c)||0; }
        { let t=0; for(const v of model.grains.values()) t+=v; return t; }
      case "getAnzahlHamster":
        if(args.length>=2){ const r=args[0],c=args[1]; return (model.hamster.row===r&&model.hamster.col===c)?1:0; }
        return 1;
      default: throw rerr("Unbekannte Methode: Territorium."+name+"()");
    }
  }
  const builtins={
    *vor(a,line){ guard(); const t=front(); if(blocked(t)) throw herr("MauerDaException","Der Hamster ist gegen eine Mauer gelaufen!",line); const h=ham(); h.row=t.r; h.col=t.c; beep("vor"); yield {line}; },
    *linksUm(a,line){ guard(); const h=ham(); h.dir=(h.dir+3)%4; beep("turn"); yield {line}; },
    *gib(a,line){ guard(); const h=ham(); if(h.grains<=0) throw herr("MaulLeerException","Der Hamster hat kein Korn im Maul zum Ablegen!",line); h.grains--; addGrain(h.row,h.col,1); beep("gib"); yield {line}; },
    *nimm(a,line){ guard(); const h=ham(); if(grainsAt(h.row,h.col)<=0) throw herr("KachelLeerException","Auf dieser Kachel liegt kein Korn zum Fressen!",line); addGrain(h.row,h.col,-1); h.grains++; beep("nimm"); yield {line}; },
    *vornFrei(){ return !blocked(front()); },
    *kornDa(){ const h=ham(); return grainsAt(h.row,h.col)>0; },
    *maulLeer(){ return ham().grains<=0; },
    *getAnzahlKoerner(){ return ham().grains; },
    *getReihe(){ return ham().row; },
    *getSpalte(){ return ham().col; },
    *getBlickrichtung(){ return ham().dir; },
    *schreib(a,line){ if(model.onWrite) model.onWrite(a.map(x=>fmt(x)).join("")); yield {line}; },
    *liesZahl(a){ const s=prompt(a[0]!=null?fmt(a[0]):"Zahl eingeben:"); const n=parseInt(s,10); return isNaN(n)?0:n; },
    *liesZeichenkette(a){ return prompt(a[0]!=null?fmt(a[0]):"Eingabe:")||""; },
  };
  const fmt=x=> typeof x==="boolean"?(x?"true":"false"): Array.isArray(x)?("["+x.map(fmt).join(", ")+"]"): (x==null?"null":String(x));
  const dstr=v=>{ const n=Number(v); return (isFinite(n)&&Number.isInteger(n))? n.toFixed(1) : String(n); };   // double-Ausgabe: 123 -> "123.0"
  function* evalCall(node, env){
    if(node.line) curLine=node.line;
    const args=[]; for(const a of node.args) args.push(yield* evalE(a, env));
    if(builtins[node.name]) return yield* builtins[node.name](args, node.line);
    if(methods[node.name]) return yield* callUser(node.name, args);
    throw {hamsterError:true, message:"Unbekannter Befehl / unbekannte Methode: "+node.name+"()", line:node.line};
  }
  function* callUser(name, args){
    const m=methods[name]; const env=new Env(globalEnv);
    m.params.forEach((pp,i)=> env.declare(pp.name, args[i]));
    try{ yield* execList(m.body, env); }
    catch(e){ if(e&&e.RETURN) return e.value; throw e; }
    return m.retType==="boolean"?false: m.retType==="int"?0: undefined;
  }
  function* evalE(n, env){
    switch(n.kind){
      case "int": case "num": case "char": case "bool": case "str": return n.v;
      case "ref": return env.get(n.name);
      case "call": return yield* evalCall(n, env);
      case "index":{ const a=yield* evalE(n.arr,env); const i=yield* evalE(n.idx,env); if(!Array.isArray(a)) throw rerr("Kein Array – Zugriff mit [] nicht möglich"); if(i<0||i>=a.length) throw rerr("Array-Index "+i+" außerhalb der Grenzen (Länge "+a.length+")"); return a[i]; }
      case "newarray":{ let sz=yield* evalE(n.size,env); sz=Math.max(0,sz|0); const def=n.base==="boolean"?false:n.base==="String"?"":0; const a=[]; for(let i=0;i<sz;i++)a.push(def); return a; }
      case "arraylit":{ const a=[]; for(const e of n.elems) a.push(yield* evalE(e,env)); return a; }
      case "member":{ const o=yield* evalE(n.obj,env); if((Array.isArray(o)||typeof o==="string")&&n.name==="length") return o.length; throw rerr("Unbekanntes Attribut ."+n.name); }
      case "mcall":{
        if(n.obj.kind==="ref"&&n.obj.name==="Territorium"){ const args=[]; for(const a of n.args) args.push(yield* evalE(a,env)); return territorium(n.name,args); }
        const o=yield* evalE(n.obj,env); const args=[]; for(const a of n.args) args.push(yield* evalE(a,env));
        if(typeof o==="string"){
          switch(n.name){ case "length":return o.length; case "equals":return o===String(args[0]); case "charAt":{ const ch=o.charAt(args[0]); return ch?ch.charCodeAt(0):0; } case "substring":return args.length>1?o.substring(args[0],args[1]):o.substring(args[0]); case "indexOf":return o.indexOf(String(args[0])); case "toUpperCase":return o.toUpperCase(); case "toLowerCase":return o.toLowerCase(); default: throw rerr("Unbekannte String-Methode ."+n.name+"()"); }
        }
        if(Array.isArray(o)&&n.name==="length") return o.length;
        throw rerr("Unbekannte Methode ."+n.name+"()");
      }
      case "not": return !(yield* evalE(n.e, env));
      case "neg": return -(yield* evalE(n.e, env));
      case "cast":{ const v=Number(yield* evalE(n.e, env)); if(n.to==="int") return Math.trunc(v); if(n.to==="char") return ((Math.trunc(v)%65536)+65536)%65536; return v; }
      case "toStr":{ const v=yield* evalE(n.e, env); return n.how==="char" ? String.fromCharCode(((Math.trunc(Number(v))%65536)+65536)%65536) : dstr(v); }
      case "bin":{
        if(n.op==="&&"){ return (yield* evalE(n.l,env)) ? !!(yield* evalE(n.r,env)) : false; }
        if(n.op==="||"){ return (yield* evalE(n.l,env)) ? true : !!(yield* evalE(n.r,env)); }
        const a=yield* evalE(n.l,env), b=yield* evalE(n.r,env);
        switch(n.op){
          case "+":return a+b; case "-":return a-b; case "*":return a*b;
          case "/": if(b===0) throw rerr("Division durch 0"); return (n.intDiv===false) ? (a/b) : Math.trunc(a/b);
          case "%": if(b===0) throw rerr("Division durch 0"); return a%b;
          case "<":return a<b; case ">":return a>b; case "<=":return a<=b; case ">=":return a>=b;
          case "==":return a===b; case "!=":return a!==b;
        }
      }
    }
  }
  function* execList(list, env){ for(const s of list) yield* execS(s, env); }
  function* execS(s, env){
    if(s.line) curLine=s.line;
    switch(s.kind){
      case "block": yield* execList(s.body, new Env(env)); break;
      case "empty": break;
      case "vardecl":{ let v; if(s.init) v=yield* evalE(s.init,env); else if(s.isArr) v=null; else v=(s.varType==="boolean"?false:s.varType==="String"?"":0); env.declare(s.name,v); yield {line:s.line}; break; }
      case "arrset":{ const a=env.get(s.name); if(!Array.isArray(a)) throw {hamsterError:true,message:s.name+" ist kein Array",line:s.line}; const i=yield* evalE(s.idx,env); let v=yield* evalE(s.value,env); if(i<0||i>=a.length) throw {hamsterError:true,message:"Array-Index "+i+" außerhalb der Grenzen (Länge "+a.length+")",line:s.line}; if(s.op==="+=")v=a[i]+v; else if(s.op==="-=")v=a[i]-v; a[i]=v; yield {line:s.line}; break; }
      case "assign":{ let v=yield* evalE(s.value,env); if(s.op==="+=")v=env.get(s.name)+v; else if(s.op==="-=")v=env.get(s.name)-v; env.set(s.name,v); yield {line:s.line}; break; }
      case "incdec":{ env.set(s.name, env.get(s.name)+(s.op==="++"?1:-1)); yield {line:s.line}; break; }
      case "callstmt": yield* evalCall(s.call, env); break;
      case "return":{ const v=s.value? (yield* evalE(s.value,env)) : undefined; throw {RETURN:true, value:v}; }
      case "break": throw {BREAK:true};
      case "continue": throw {CONTINUE:true};
      case "if":{ yield {line:s.line,check:true}; if(yield* evalE(s.cond,env)) yield* execList(s.then,new Env(env)); else if(s.els) yield* execList(s.els,new Env(env)); break; }
      case "while":{
        while(true){ guard(); yield {line:s.line,check:true}; if(!(yield* evalE(s.cond,env))) break;
          try{ yield* execList(s.body,new Env(env)); }catch(e){ if(e&&e.BREAK)break; if(e&&e.CONTINUE)continue; throw e; } }
        break;
      }
      case "dowhile":{
        do{ guard(); try{ yield* execList(s.body,new Env(env)); }catch(e){ if(e&&e.BREAK)break; if(e&&e.CONTINUE){} else throw e; }
            yield {line:s.line,check:true}; }while(yield* evalE(s.cond,env));
        break;
      }
      case "for":{
        const e=new Env(env); if(s.init) yield* execS(s.init,e);
        while(true){ guard(); yield {line:s.line,check:true}; if(s.cond&&!(yield* evalE(s.cond,e))) break;
          try{ yield* execList(s.body,new Env(e)); }catch(ex){ if(ex&&ex.BREAK)break; if(ex&&ex.CONTINUE){ if(s.update) yield* execS(s.update,e); continue; } throw ex; }
          if(s.update) yield* execS(s.update,e); }
        break;
      }
    }
  }
  function* run(){ const env=new Env(globalEnv); try{ yield* execList(ast.main, env); }catch(e){ if(e&&e.RETURN) return; throw e; } }
  return {run};
}

/* ---------- Territorium-Helfer ---------- */
function buildTerr(rows, maul){
  const grid=rows; const R=grid.length, C=Math.max(...grid.map(s=>s.length));
  const walls=new Set(), grains=new Map(); let ham={row:0,col:0,dir:OST,grains:maul||0};
  for(let r=0;r<R;r++){ const line=grid[r]; for(let c=0;c<C;c++){ const ch=line[c]||" ";
    if(ch==="#") walls.add(r+","+c);
    else if(ch>="1"&&ch<="9") grains.set(r+","+c, +ch);
    else if(ch===">"){ham={row:r,col:c,dir:OST,grains:maul||0};}
    else if(ch==="<"){ham={row:r,col:c,dir:WEST,grains:maul||0};}
    else if(ch==="^"){ham={row:r,col:c,dir:NORD,grains:maul||0};}
    else if(ch==="v"){ham={row:r,col:c,dir:SUED,grains:maul||0};}
  }}
  return {rows:R, cols:C, walls, grains, hamster:ham};
}
function blankTerr(){ return buildTerr(["          ","          ","  >       ","          ","          ","          ","          ","          "],0); }
function toModel(x){
  if(!x) return blankTerr();
  // bereits ein Modell mit Set/Map?
  if(x.walls instanceof Set) return cloneModel(x);
  // JSON
  return { rows:x.rows, cols:x.cols, walls:new Set(x.walls||[]), grains:new Map(x.grains||[]), hamster:Object.assign({row:0,col:0,dir:OST,grains:0}, x.hamster) };
}
function cloneModel(m){ return {rows:m.rows, cols:m.cols, walls:new Set(m.walls), grains:new Map(m.grains), hamster:Object.assign({},m.hamster)}; }
function toJSON(m){ return {rows:m.rows, cols:m.cols, walls:[...m.walls], grains:[...m.grains], hamster:Object.assign({},m.hamster)}; }

/* ---------- Syntax-Highlight ---------- */
const SETS={
  kw:new Set(["if","else","while","do","for","return","break","continue","new","public","private","static","final","class","import"]),
  type:new Set(["int","double","char","boolean","void","String"]),
  lit:new Set(["true","false"]),
  cmd:new Set(["vor","linksUm","gib","nimm","schreib","init","main","liesZahl","liesZeichenkette"]),
  test:new Set(["vornFrei","kornDa","maulLeer","getReihe","getSpalte","getBlickrichtung","getAnzahlKoerner"]),
  cst:new Set(["NORD","OST","SUED","WEST","BLAU","ROT","GRUEN","GELB","CYAN","MAGENTA","ORANGE","PINK","GRAU","WEISS","Territorium"]),
};
const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function highlight(src){
  let o="",i=0; const isId=c=>/[A-Za-z0-9_À-ſ]/.test(c);
  while(i<src.length){ const c=src[i];
    if(c==="/"&&src[i+1]==="/"){ let j=i; while(j<src.length&&src[j]!=="\n")j++; o+='<span class="c-com">'+esc(src.slice(i,j))+"</span>"; i=j; continue; }
    if(c==="/"&&src[i+1]==="*"){ let j=i+2; while(j<src.length&&!(src[j]==="*"&&src[j+1]==="/"))j++; j=Math.min(src.length,j+2); o+='<span class="c-com">'+esc(src.slice(i,j))+"</span>"; i=j; continue; }
    if(c==='"'){ let j=i+1; while(j<src.length&&src[j]!=='"'){ if(src[j]==="\\")j++; j++; } j=Math.min(src.length,j+1); o+='<span class="c-str">'+esc(src.slice(i,j))+"</span>"; i=j; continue; }
    if(/[0-9]/.test(c)){ let j=i; while(j<src.length&&/[0-9]/.test(src[j]))j++; o+='<span class="c-num">'+src.slice(i,j)+"</span>"; i=j; continue; }
    if(/[A-Za-z_À-ſ]/.test(c)){ let j=i; while(j<src.length&&isId(src[j]))j++; const w=src.slice(i,j); let cl="";
      if(SETS.type.has(w))cl="c-type"; else if(SETS.kw.has(w))cl="c-kw"; else if(SETS.lit.has(w))cl="c-lit"; else if(SETS.cmd.has(w))cl="c-cmd"; else if(SETS.test.has(w))cl="c-test"; else if(SETS.cst.has(w))cl="c-cst";
      o+= cl?'<span class="'+cl+'">'+w+"</span>":esc(w); i=j; continue; }
    o+=esc(c); i++;
  }
  return o;
}

/* ---------- Styles (einmalig) ---------- */
function injectStyles(){
  if(document.getElementById("hv-styles")) return;
  const st=document.createElement("style"); st.id="hv-styles";
  st.textContent = `
  .hv{--lh:22px;--cpad:12px;display:flex;flex-direction:column;gap:10px;font-family:"Nunito",sans-serif}
  /* Breitenverhaeltnis Editor:Territorium ist per Ziehgriff einstellbar (--edwA/--edwB) */
  .hv .hv-main{display:grid;gap:6px;grid-template-columns:var(--edwA,1.65fr) 7px var(--edwB,1fr);min-height:0}
  .hv.solo .hv-main{grid-template-columns:1fr}
  .hv .hv-vsplit{cursor:ew-resize;display:flex;align-items:center;justify-content:center;border-radius:4px}
  .hv .hv-vsplit::after{content:"";width:3px;height:44px;border-radius:2px;background:#7a8aa0;opacity:.35}
  .hv .hv-vsplit:hover::after{opacity:.7;background:#1cb0f6}
  .hv .hv-hsplit{height:11px;margin-top:6px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;border-radius:4px}
  .hv .hv-hsplit::after{content:"";width:56px;height:3px;border-radius:2px;background:#7a8aa0;opacity:.35}
  .hv .hv-hsplit:hover::after{opacity:.7;background:#1cb0f6}
  .hv.fill{height:auto}
  .hv.fill .hv-main{height:var(--edh,70vh);min-height:420px}
  .hv.fill .editor{min-height:340px}
  .hv.fill .boardWrap{min-height:200px}
  .hv .hv-pane{position:relative;background:#fff;border:2px solid #e6ebf2;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
  .hv .hv-ph{padding:8px 12px;border-bottom:1px solid #eef2f7;font-weight:800;font-size:13px;color:#7a8aa0;display:flex;align-items:center;gap:8px}
  .hv .editor{display:flex;flex:1;min-height:300px;background:#1f2530;border-radius:0}
  .hv #g,.hv .gut{width:42px;flex:none;background:#2a313e;overflow:hidden;position:relative;border-right:1px solid #323a47}
  .hv .gutInner{position:absolute;top:0;left:0;right:0;padding:var(--cpad) 7px var(--cpad) 0;text-align:right;white-space:pre;font:15px/var(--lh) "JetBrains Mono",Consolas,monospace;color:#5d6675}
  .hv .codebox{position:relative;flex:1;min-width:0;overflow:hidden}
  .hv .codeHL,.hv .code{position:absolute;inset:0;margin:0;padding:var(--cpad);border:0;font:15px/var(--lh) "JetBrains Mono",Consolas,monospace;white-space:pre;tab-size:4;overflow:auto}
  .hv .codeHL{pointer-events:none;color:#d6dbe4;overflow:hidden}
  .hv .code{background:transparent;color:transparent;caret-color:#fff;resize:none;outline:none}
  .hv .code[readonly]{caret-color:transparent}
  .hv .actLine{position:absolute;left:0;right:0;height:var(--lh);background:rgba(231,161,58,.16);border-left:3px solid #e7a13a;pointer-events:none;display:none}
  .hv .actLine.err{background:rgba(255,75,75,.18);border-left-color:#ff4b4b}
  .hv .c-kw{color:#c792ea}.hv .c-type{color:#82d2ff}.hv .c-lit{color:#ff9e7a}.hv .c-cmd{color:#82aaff}.hv .c-test{color:#ffcb6b}.hv .c-cst{color:#f78cc4}.hv .c-str{color:#c3e88d}.hv .c-num{color:#ff9e7a}.hv .c-com{color:#5f6b7d;font-style:italic}
  /* Light-Mode: heller Editor mit dunkler Schrift (gleiche Palette wie Java-IDE) */
  :root[data-theme="light"] .hv .editor{background:#fff}
  :root[data-theme="light"] .hv #g,:root[data-theme="light"] .hv .gut{background:#f3f6fa;border-right-color:#e3e9f1}
  :root[data-theme="light"] .hv .gutInner{color:#7a8aa0}
  :root[data-theme="light"] .hv .codeHL{color:#1f2530}
  :root[data-theme="light"] .hv .code{caret-color:#1a2330}
  :root[data-theme="light"] .hv .code[readonly]{caret-color:transparent}
  :root[data-theme="light"] .hv .c-kw{color:#a626a4}
  :root[data-theme="light"] .hv .c-type{color:#0184bc}
  :root[data-theme="light"] .hv .c-lit{color:#e45649}
  :root[data-theme="light"] .hv .c-cmd{color:#4078f2}
  :root[data-theme="light"] .hv .c-test{color:#c18401}
  :root[data-theme="light"] .hv .c-cst{color:#c2418f}
  :root[data-theme="light"] .hv .c-str{color:#50a14f}
  :root[data-theme="light"] .hv .c-num{color:#b76b01}
  :root[data-theme="light"] .hv .c-com{color:#7a8aa0}
  .hv .boardWrap{flex:1;min-height:300px;display:flex;align-items:center;justify-content:center;padding:12px;background:radial-gradient(circle at 50% 40%,#f4f8ee,#e9f0e0)}
  .hv .board{position:relative;display:grid;border-radius:9px;overflow:hidden;box-shadow:0 5px 16px rgba(60,80,40,.18),inset 0 0 0 2px rgba(255,255,255,.35);grid-template-columns:repeat(var(--cols),var(--cell));grid-template-rows:repeat(var(--rows),var(--cell))}
  .hv .tile{position:relative;width:var(--cell);height:var(--cell);display:flex;align-items:center;justify-content:center}
  .hv .tile.g0{background:#a7d96b}.hv .tile.g1{background:#9bcf5d}
  .hv .tile.wall{background-color:#b76a5b;background:repeating-linear-gradient(90deg,#b76a5b 0 calc(50% - 1px),#9d5749 calc(50% - 1px) calc(50% + 1px),#b76a5b calc(50% + 1px) 100%),linear-gradient(#9d5749,#9d5749) 0 50%/100% 2px no-repeat;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
  .hv.editing .tile{cursor:pointer}
  .hv.editing .tile:hover{outline:2px solid rgba(231,161,58,.7);outline-offset:-2px;z-index:2}
  .hv .grains{display:flex;flex-wrap:wrap;gap:2px;align-items:center;justify-content:center;width:62%;height:62%;pointer-events:none}
  .hv .kern{width:max(5px,18%);aspect-ratio:1/1.5;border-radius:50%;background:radial-gradient(circle at 35% 30%,#f6cf52,#d99a1c);box-shadow:0 1px 1px rgba(120,80,0,.4)}
  .hv .kbadge{position:absolute;top:2px;left:3px;font-size:max(8px,26%);font-weight:800;color:#7a5200;background:rgba(255,255,255,.92);border-radius:5px;padding:0 3px;line-height:1.3;z-index:5;pointer-events:none}
  .hv .hv-goal{padding:9px 12px;border-radius:12px;font-weight:800;font-size:14.5px;text-align:center}
  .hv .hv-goal.ok{background:#e9ffd6;color:#46a302}
  .hv .hv-goal.no{background:#fff3d6;color:#c9851f}
  .hv .ham{position:absolute;top:0;left:0;width:var(--cell);height:var(--cell);transition:transform .25s ease;will-change:transform;z-index:3;pointer-events:none}
  .hv .ham .rot{width:100%;height:100%;transition:transform .25s ease;display:flex;align-items:center;justify-content:center}
  .hv .ham svg{width:82%;height:82%;filter:drop-shadow(0 2px 2px rgba(0,0,0,.25))}
  .hv .ham.bonk .rot{animation:hvbonk .45s ease}
  @keyframes hvbonk{0%,100%{transform:rotate(var(--deg))}25%{transform:rotate(var(--deg)) translateX(-8%)}75%{transform:rotate(var(--deg)) translateX(8%)}}
  /* Steuerung sitzt ueber dem Territorium (rechte Spalte) */
  .hv .ctrls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px;border-bottom:1px solid #eef2f7;background:#fafbfd}
  .hv .cbtn{border:1px solid #e6ebf2;background:#fff;border-radius:9px;padding:7px 11px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit}
  .hv .cbtn.green{background:#58cc02;border-color:#46a302;color:#fff}.hv .cbtn.red{color:#ff4b4b}
  .hv .cbtn:disabled{opacity:.45;cursor:default}
  .hv .speed{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:#7a8aa0}
  .hv .speed input{width:90px;accent-color:#e7a13a}
  .hv .cbtn.cmds{font-weight:800}
  .hv .hv-cheat{position:absolute;inset:0;z-index:20;background:#fff;border-radius:13px;display:flex;flex-direction:column;overflow:hidden}
  .hv .hv-cheat-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border-bottom:1px solid #eef2f7;background:#fafbfd;font-size:14px}
  .hv .hv-cheat-body{flex:1;overflow:auto;padding:8px 12px 14px}
  .hv .hv-cheat h4{margin:12px 0 3px;font-size:11px;font-weight:900;color:#7a8aa0;text-transform:uppercase;letter-spacing:.6px}
  .hv .hv-cheat h4:first-child{margin-top:2px}
  .hv .hv-cheat .crow{display:grid;grid-template-columns:minmax(130px,42%) 1fr;gap:10px;align-items:baseline;padding:4px 0;border-bottom:1px dashed #eef2f7}
  .hv .hv-cheat code{font-family:"JetBrains Mono",Consolas,monospace;font-size:12px;color:#2b2f3a;background:#f3f5f9;padding:2px 6px;border-radius:6px;white-space:nowrap}
  .hv .hv-cheat .crow span{font-size:12.5px;color:#5a6675}
  .hv .tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px;border-bottom:1px solid #eef2f7;background:#fafbfd}
  .hv .tool{border:1px solid #e6ebf2;background:#fff;border-radius:8px;padding:6px 9px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
  .hv .tool.on{border-color:#e7a13a;background:#fff7ea;color:#c9851f}
  .hv .szi{width:42px;border:1px solid #e6ebf2;border-radius:7px;padding:4px;text-align:center;font-family:inherit}
  .hv .status{display:flex;gap:8px;padding:0;flex-wrap:wrap}
  .hv .stat{flex:1;min-width:60px;background:#f7f9fc;border:1px solid #eef2f7;border-radius:9px;padding:5px;text-align:center}
  .hv .stat .v{font-weight:800;font-size:15px}.hv .stat .k{font-size:10px;color:#7a8aa0}
  .hv .out{flex:0 0 auto;height:120px;min-height:64px;max-height:70vh;resize:vertical;overflow:auto;padding:7px 11px;border:2px solid #e6ebf2;border-radius:12px;font:12px/1.5 "JetBrains Mono",Consolas,monospace;background:#fff}
  .hv .out:empty::before{content:"Ausgaben & Meldungen erscheinen hier …";color:#b6bfcc}
  .hv .out .err{color:#e63a3a;font-weight:700}.hv .out .ok{color:#46a302}.hv .out .say{color:#1899d6}
  @media(max-width:760px){.hv .hv-main{grid-template-columns:1fr}}`;
  document.head.appendChild(st);
}

/* ============================================================================
   HamsterView
   ============================================================================ */
let _seq=0;
class HamsterView{
  constructor(container, opts={}){
    injectStyles();
    this.el = typeof container==="string"? document.querySelector(container): container;
    this.mode = opts.mode || "solve";          // solve | design | view
    this.fill = !!opts.fill;                   // Container-Höhe ausfüllen (großes Arbeitsfenster)
    this.goal = opts.goal || null;             // Auto-Check-Ziel -> Live-Anzeige nach dem Lauf
    this.showCommands = !!opts.commands;       // Befehls-Übersicht (Spickzettel) im Editor einblendbar
    this.initial = toModel(opts.model);
    this.model = cloneModel(this.initial);
    this.hamDeg = DIRS[this.model.hamster.dir].deg;   // fortlaufender Drehwinkel (für korrekte Drehrichtung)
    this.code = opts.code!=null ? opts.code : "";
    this.onCode = opts.onCode || null;
    this.id = "hv"+(++_seq);
    this.cell=36; this.cells=[]; this.runState="idle"; this.stop=false; this.step=false; this.gen=null; this.actLineNo=null; this._loopActive=false;
    this.tool="wall"; this.paint=false; this.lastPaint=null;
    this._build();
  }
  destroy(){ this.stop=true; this.runState="idle"; if(this._ro) this._ro.disconnect(); this.el.innerHTML=""; }

  /* Ziehgriff verdrahten. Kommt der Zeiger an den Fensterrand, rollt die Seite
     automatisch mit - sonst waere am Bildschirmrand Schluss. Das Brett passt
     sich von selbst an (ResizeObserver auf .boardWrap ruft _layout()). */
  _wireSplit(handle, onMove){
    if(!handle) return;
    let aktiv=false, letzte=null, timer=null;
    const RAND=56, SCHRITT=16;
    const tick=()=>{
      if(!aktiv){ timer=null; return; }
      const vh=window.innerHeight;
      let d=0;
      if(letzte && letzte.clientY > vh-RAND) d =  Math.min(SCHRITT, Math.ceil((letzte.clientY-(vh-RAND))/2));
      else if(letzte && letzte.clientY < RAND) d = -Math.min(SCHRITT, Math.ceil((RAND-letzte.clientY)/2));
      if(d){ window.scrollBy(0,d); if(letzte) onMove(letzte); }
      timer=requestAnimationFrame(tick);
    };
    const move=(e)=>{ if(!aktiv) return; letzte=e; onMove(e); if(timer===null) timer=requestAnimationFrame(tick); };
    const up=()=>{ aktiv=false; if(timer!==null){ cancelAnimationFrame(timer); timer=null; }
      document.body.style.userSelect="";
      document.removeEventListener("pointermove",move); document.removeEventListener("pointerup",up); document.removeEventListener("pointercancel",up); };
    handle.addEventListener("pointerdown",(e)=>{
      e.preventDefault(); aktiv=true; letzte=e;
      document.body.style.userSelect="none";
      document.addEventListener("pointermove",move); document.addEventListener("pointerup",up); document.addEventListener("pointercancel",up);
    });
  }

  _build(){
    const m=this.mode;
    const hasEditor = (m==="solve"||m==="view");
    this.el.className = "hv"+(hasEditor?"":" solo")+(this.fill?" fill":"");
    const editorPane = hasEditor ? `
      <div class="hv-pane">
        <div class="hv-ph">📝 ${m==="view"?"Abgegebener Code":"Dein Programm"}</div>
        <div class="editor">
          <div class="gut"><div class="gutInner">1</div></div>
          <div class="codebox"><pre class="codeHL"></pre><textarea class="code" spellcheck="false" wrap="off" ${m==="view"?"readonly":""}></textarea><div class="actLine"></div></div>
        </div>
      </div>` : "";
    /* Steuerung + Befehls-Übersicht gehören zum Territorium (rechte Spalte),
       damit man die Befehle lesen kann, während links programmiert wird. */
    const ctrlBar = hasEditor ? `
        <div class="ctrls">
          <button class="cbtn green run">▶ Start</button>
          <button class="cbtn pause" disabled>⏸</button>
          <button class="cbtn step">⏭</button>
          <button class="cbtn red stopb" disabled>⏹</button>
          <button class="cbtn reset">⟲</button>
          ${this.showCommands?'<button class="cbtn cmds" type="button" title="Befehls-Übersicht">📖 Befehle</button>':''}
          <label class="speed">🐢<input type="range" class="sp" min="1" max="10" value="4">🐇</label>
        </div>` : "";
    const cheatPanel = (hasEditor && this.showCommands)
      ? `<div class="hv-cheat" style="display:none"><div class="hv-cheat-head"><b>📖 Befehle &amp; Sprache</b><button class="cbtn cheatclose" type="button">✕ schließen</button></div><div class="hv-cheat-body">${CHEAT_HTML}</div></div>`
      : "";
    const designTools = m==="design" ? `
      <div class="tools">
        <button class="tool on" data-tool="wall">🧱 Mauer</button>
        <button class="tool" data-tool="korn">🌾 Korn</button>
        <input class="szi kornN" type="number" min="1" value="1" title="Körner pro Klick" style="width:46px">
        <button class="tool" data-tool="hamster">🐹 Hamster</button>
        <button class="tool" data-tool="eraser">🧽 Frei</button>
        <span style="margin-left:6px;font-size:12px;color:#7a8aa0">Reihen<input class="szi rIn" type="number" min="1" max="30"></span>
        <span style="font-size:12px;color:#7a8aa0">Spalten<input class="szi cIn" type="number" min="1" max="30"></span>
        <span style="font-size:12px;color:#7a8aa0">Maul<input class="szi mIn" type="number" min="0" max="99"></span>
      </div>` : "";
    const statusBar = hasEditor ? `
      <div class="status">
        <div class="stat"><div class="v stPos">–</div><div class="k">Reihe/Spalte</div></div>
        <div class="stat"><div class="v stDir">–</div><div class="k">Richtung</div></div>
        <div class="stat"><div class="v stMaul">–</div><div class="k">Körner im Maul</div></div>
        <div class="stat"><div class="v stFeld">–</div><div class="k">Körner im Feld</div></div>
      </div>
      <div class="out"></div>` : "";
    this.el.innerHTML = `
      <div class="hv-main">
        ${editorPane}
        ${hasEditor?'<div class="hv-vsplit" title="Breite von Editor und Territorium ziehen"></div>':""}
        <div class="hv-pane">
          <div class="hv-ph">🌍 Territorium</div>
          ${ctrlBar}
          ${designTools}
          <div class="boardWrap"><div class="board"></div></div>
          ${cheatPanel}
        </div>
      </div>
      ${hasEditor?'<div class="hv-hsplit" title="Höhe des Arbeitsbereichs ziehen"></div>':""}
      ${(hasEditor&&this.goal)?'<div class="hv-goal" style="display:none"></div>':''}
      ${statusBar}`;

    // refs
    this.$=(s)=>this.el.querySelector(s);
    this.board=this.$(".board"); this.boardWrap=this.$(".boardWrap");
    if(hasEditor){
      this.code_=this.$(".code"); this.codeHL=this.$(".codeHL"); this.gutInner=this.$(".gutInner"); this.actLine=this.$(".actLine");
      this.code_.value=this.code; this._refreshEditor();
      this._undo=[this._snap()]; this._redo=[]; this._recT=null;   // Undo/Redo-Verlauf
      this.code_.addEventListener("input",()=>{ this.code=this.code_.value; this._refreshEditor(); if(this.onCode)this.onCode(this.code); clearTimeout(this._recT); this._recT=setTimeout(()=>this._commit(),350); });
      this.code_.addEventListener("scroll",()=>this._syncScroll());
      this.code_.addEventListener("keydown",e=>{
        const ta=this.code_; if(ta.readOnly) return;
        const ctrl=e.ctrlKey||e.metaKey;
        if(ctrl && (e.key==="z"||e.key==="Z")){ e.preventDefault(); if(e.shiftKey) this._redoEdit(); else this._undoEdit(); return; }
        if(ctrl && (e.key==="y"||e.key==="Y")){ e.preventDefault(); this._redoEdit(); return; }
        if(e.key==="Tab"){
          e.preventDefault();
          const s=ta.selectionStart, en=ta.selectionEnd;
          ta.value=ta.value.slice(0,s)+"\t"+ta.value.slice(en);
          ta.selectionStart=ta.selectionEnd=s+1;
          this.code=ta.value; this._refreshEditor(); this._commit();
        } else if(e.key==="Enter"){
          e.preventDefault();
          const s=ta.selectionStart, en=ta.selectionEnd, v=ta.value;
          const lineStart=v.lastIndexOf("\n",s-1)+1;            // Beginn der aktuellen Zeile
          // Cursor am Zeilenanfang -> keine Einrückung übernehmen (Zeile nur nach unten schieben)
          const indent=(s===lineStart) ? "" : (v.slice(lineStart).match(/^[\t ]*/)||[""])[0];  // sonst führende Einrückung (echte Tabs)
          const ins="\n"+indent;
          ta.value=v.slice(0,s)+ins+v.slice(en);
          ta.selectionStart=ta.selectionEnd=s+ins.length;
          this.code=ta.value; this._refreshEditor(); this._commit();
        }
      });
      this.$(".run").onclick=()=>this.run();
      this.$(".pause").onclick=()=>this._pauseResume();
      this.$(".step").onclick=()=>this._stepOnce();
      this.$(".stopb").onclick=()=>this._stopRun(false);
      this.$(".reset").onclick=()=>{ this._stopRun(true); this._resetModel(); this._clearOut(); this.runState="idle"; this._updateBtns(); };
      { const cb=this.$(".cmds"); if(cb){ const panel=this.$(".hv-cheat"); cb.onclick=()=>{ panel.style.display=(panel.style.display==="none"?"flex":"none"); }; const cc=this.$(".cheatclose"); if(cc) cc.onclick=()=>{ panel.style.display="none"; }; } }

      /* ---- Ziehgriffe: Gesamthoehe und Breitenverhaeltnis ------------------
         Beides wird gemerkt (localStorage), damit die einmal eingestellte
         Aufteilung auch bei der naechsten Aufgabe erhalten bleibt.          */
      try{
        const hh=parseFloat(localStorage.getItem("hvEdH")||"");
        if(hh>=35 && hh<=95) this.el.style.setProperty("--edh", hh+"vh");
        const wf=parseFloat(localStorage.getItem("hvEdW")||"");
        if(wf>=0.25 && wf<=0.8){
          this.el.style.setProperty("--edwA", wf+"fr");
          this.el.style.setProperty("--edwB", (1-wf)+"fr");
        }
      }catch(e){}
      this._wireSplit(this.$(".hv-hsplit"), (ev)=>{
        const main=this.$(".hv-main"); if(!main) return;
        const px=ev.clientY - main.getBoundingClientRect().top;
        const vh=Math.max(35, Math.min(95, px/window.innerHeight*100));
        this.el.style.setProperty("--edh", vh+"vh");
        try{ localStorage.setItem("hvEdH", vh.toFixed(1)); }catch(e){}
      });
      this._wireSplit(this.$(".hv-vsplit"), (ev)=>{
        const main=this.$(".hv-main"); if(!main) return;
        const r=main.getBoundingClientRect(); if(!r.width) return;
        const f=Math.max(0.25, Math.min(0.8, (ev.clientX-r.left)/r.width));
        this.el.style.setProperty("--edwA", f+"fr");
        this.el.style.setProperty("--edwB", (1-f)+"fr");
        try{ localStorage.setItem("hvEdW", f.toFixed(3)); }catch(e){}
      });
    }
    if(m==="design"){
      this.$(".rIn").value=this.model.rows; this.$(".cIn").value=this.model.cols; this.$(".mIn").value=this.model.hamster.grains;
      this.el.querySelectorAll(".tool[data-tool]").forEach(b=> b.onclick=()=>{ this.tool=b.dataset.tool; this.el.querySelectorAll(".tool[data-tool]").forEach(x=>x.classList.toggle("on",x===b)); });
      this.$(".rIn").onchange=()=>this._resize(); this.$(".cIn").onchange=()=>this._resize(); this.$(".mIn").onchange=()=>{ this.model.hamster.grains=Math.max(0,+this.$(".mIn").value||0); this.initial=cloneModel(this.model); this._render(); };
      this.el.classList.add("editing");
      this._wirePaint();
    }
    this._buildBoard();
    this._render();
    if(window.ResizeObserver){ this._ro=new ResizeObserver(()=>this._layout()); this._ro.observe(this.boardWrap); }
  }

  /* ----- Board ----- */
  _buildBoard(){
    this.board.style.setProperty("--cols",this.model.cols);
    this.board.style.setProperty("--rows",this.model.rows);
    this.board.innerHTML=""; this.cells=[];
    for(let r=0;r<this.model.rows;r++){ const row=[];
      for(let c=0;c<this.model.cols;c++){ const t=document.createElement("div"); t.className="tile g"+((r+c)&1); t.dataset.r=r; t.dataset.c=c; this.board.appendChild(t); row.push(t); }
      this.cells.push(row);
    }
    this.ham=document.createElement("div"); this.ham.className="ham"; this.ham.innerHTML='<div class="rot">'+HAMSTER_SVG+'</div>';
    this.board.appendChild(this.ham);
    this._layout();
  }
  _layout(){
    const w=this.boardWrap.clientWidth-24, h=this.boardWrap.clientHeight-24;
    if(w<=0||h<=0) return;
    this.cell=Math.max(14, Math.floor(Math.min(w/this.model.cols, h/this.model.rows)));
    this.board.style.setProperty("--cell",this.cell+"px");
    this._posHam(false);
  }
  _render(){
    for(let r=0;r<this.model.rows;r++)for(let c=0;c<this.model.cols;c++){
      const t=this.cells[r][c]; const wall=this.model.walls.has(r+","+c);
      t.classList.toggle("wall",wall);
      const n=wall?0:(this.model.grains.get(r+","+c)||0);
      const sig="n"+n; if(t.dataset.sig!==sig){ t.dataset.sig=sig; t.innerHTML=grainHTML(n); }
    }
    this._posHam(true);
    if(this.$(".stPos")){
      const hm=this.model.hamster; let tot=0; for(const v of this.model.grains.values()) tot+=v;
      this.$(".stPos").textContent=hm.row+" / "+hm.col; this.$(".stDir").textContent=DIRS[hm.dir].abk;
      this.$(".stMaul").textContent=hm.grains; this.$(".stFeld").textContent=tot;
    }
  }
  _posHam(animate){
    const hm=this.model.hamster, d=this._animDur();
    this.ham.style.transitionDuration=animate?d+"ms":"0ms";
    const rot=this.ham.querySelector(".rot"); rot.style.transitionDuration=animate?d+"ms":"0ms";
    this.ham.style.transform=`translate(${hm.col*this.cell}px, ${hm.row*this.cell}px)`;
    const target=DIRS[hm.dir].deg;
    if(animate){ let cur=((this.hamDeg%360)+360)%360; let delta=target-cur; if(delta>180)delta-=360; else if(delta<-180)delta+=360; this.hamDeg+=delta; }
    else { this.hamDeg=target; }
    rot.style.setProperty("--deg",this.hamDeg+"deg"); rot.style.transform=`rotate(${this.hamDeg}deg)`;
  }

  /* ----- Editor ----- */
  _refreshEditor(){
    const src=this.code_.value;
    this.codeHL.innerHTML=highlight(src)+"\n";
    const lines=src.split("\n").length; let g=""; for(let i=1;i<=lines;i++)g+=i+"\n"; this.gutInner.textContent=g;
    this._syncScroll();
  }
  _syncScroll(){ this.codeHL.scrollTop=this.code_.scrollTop; this.codeHL.scrollLeft=this.code_.scrollLeft; this.gutInner.style.transform="translateY("+(-this.code_.scrollTop)+"px)"; this._layoutActive(); }
  _setActive(n,isErr){ this.actLineNo=n; if(!this.actLine)return; this.actLine.classList.toggle("err",!!isErr); if(n==null){this.actLine.style.display="none";return;} this.actLine.style.display="block"; this._layoutActive();
    const top=12+(n-1)*22; if(top<this.code_.scrollTop+10) this.code_.scrollTop=Math.max(0,top-30); else if(top>this.code_.scrollTop+this.code_.clientHeight-30) this.code_.scrollTop=top-this.code_.clientHeight+50; }
  _layoutActive(){ if(this.actLineNo==null||!this.actLine)return; this.actLine.style.top=(12+(this.actLineNo-1)*22 - this.code_.scrollTop)+"px"; }

  /* ----- Output ----- */
  _log(t,cls){ const o=this.$(".out"); if(!o)return; const d=document.createElement("div"); d.className=cls||""; d.textContent=t; o.appendChild(d); o.scrollTop=o.scrollHeight; }
  _clearOut(){ const o=this.$(".out"); if(o)o.innerHTML=""; }

  /* ----- Tempo ----- */
  _delay(){ const sp=this.$(".sp")?+this.$(".sp").value:5; return Math.round(600*Math.pow(0.6,sp-1)); }
  _animDur(){ return Math.max(55,Math.min(300,this._delay())); }

  /* ----- Lauf ----- */
  _prepare(){
    let ast; try{ ast=parse(this.code_.value); compileCheck(ast); }catch(e){ this._showErr(e); return null; }
    this.model=cloneModel(this.initial); this._render();
    const im=makeInterpreter(ast, { rows:this.model.rows, cols:this.model.cols, walls:this.model.walls, grains:this.model.grains, hamster:this.model.hamster, onWrite:(s)=>this._log("🗨 "+s,"say") });
    return im.run();
  }
  async run(){
    if(this.runState==="running"||this.runState==="paused") return;
    this._clearOut(); this._setActive(null); this._hideGoal();
    this.gen=this._prepare(); if(!this.gen){ this.runState="error"; this._updateBtns(); return; }
    this.stop=false; this.step=false; this.runState="running"; this._updateBtns();
    await this._drive();
  }
  async _drive(){
    this._loopActive=true;
    while(true){
      if(this.stop) break;
      while(this.runState==="paused" && !this.step && !this.stop) await sleep(40);
      if(this.stop) break;
      const wasStep=this.step; this.step=false;
      let res; try{ res=this.gen.next(); }catch(e){ this._showErr(e); this.runState="error"; this._updateBtns(); this._loopActive=false; return; }
      if(res.done){ this.runState="finished"; this._setActive(null); this._log("✓ Programm beendet.","ok"); this._showGoal(); this._updateBtns(); this._loopActive=false; this._onFinish&&this._onFinish(); return; }
      const sig=res.value||{}; if(sig.line) this._setActive(sig.line); this._render();
      if(wasStep) this.runState="paused";
      this._updateBtns();
      await sleep(this.runState==="paused"?0:this._delay());
    }
    this.runState="idle"; this._setActive(null); this.stop=false; this._updateBtns(); this._loopActive=false;
  }
  _showErr(e){
    if(e&&e.hamsterError){ this._log("✖ "+(e.type?e.type+": ":"")+e.message+(e.line?" (Zeile "+e.line+")":""),"err"); if(e.line)this._setActive(e.line,true); if(e.type){ this.ham.classList.add("bonk"); setTimeout(()=>this.ham.classList.remove("bonk"),460); } }
    else { const m=(e&&e.message)?String(e.message):""; const txt=/call stack|stack size|recursion/i.test(m) ? "Zu viele verschachtelte Aufrufe – läuft eine Rekursion ohne Abbruchbedingung?" : (m?("Interner Fehler: "+m):"Unerwarteter Fehler – bitte prüfe deinen Code."); this._log("✖ "+txt,"err"); console.error(e); }
  }
  _showGoal(){ if(!this.goal) return; const g=this.$(".hv-goal"); if(!g) return; const ok=checkGoal(this.goal,this.model)===true; g.style.display="block"; g.className="hv-goal "+(ok?"ok":"no"); g.textContent=ok?"🎉 Ziel erreicht!":"Ziel noch nicht erreicht – probier es nochmal!"; }
  _hideGoal(){ const g=this.$(".hv-goal"); if(g) g.style.display="none"; }
  async _stepOnce(){
    if(this.runState==="running") return;
    if(this.runState==="idle"||this.runState==="finished"||this.runState==="error"){ this._clearOut(); this.gen=this._prepare(); if(!this.gen){this.runState="error";this._updateBtns();return;} this.stop=false; this.runState="paused"; this._updateBtns(); }
    if(this.runState==="paused"){ this.step=true; if(!this._loopActive) await this._drive(); }
  }
  _pauseResume(){ if(this.runState==="running"){ this.runState="paused"; } else if(this.runState==="paused"){ this.runState="running"; } this._updateBtns(); }
  _stopRun(silent){ if(this.runState==="running"||this.runState==="paused") this.stop=true; this.runState="idle"; this.step=false; if(!silent)this._resetModel(); this._updateBtns(); }
  _resetModel(){ this.model=cloneModel(this.initial); this._buildBoard(); this._render(); this._setActive(null); }
  _updateBtns(){
    if(!this.$(".run"))return;
    const running=this.runState==="running", paused=this.runState==="paused";
    this.$(".run").disabled=running||paused; this.$(".run").textContent=(this.runState==="finished"||this.runState==="error")?"▶ Neu":"▶ Start";
    this.$(".pause").disabled=!(running||paused); this.$(".pause").textContent=paused?"▶":"⏸";
    this.$(".stopb").disabled=!(running||paused); this.$(".step").disabled=running;
    this.code_.readOnly=running||paused||this.mode==="view";
  }

  /* ----- Design / Paint ----- */
  _wirePaint(){
    const tileAt=(ev)=>{ const rect=this.board.getBoundingClientRect(); const x=(ev.touches?ev.touches[0].clientX:ev.clientX)-rect.left, y=(ev.touches?ev.touches[0].clientY:ev.clientY)-rect.top; const c=Math.floor(x/this.cell), r=Math.floor(y/this.cell); if(r<0||c<0||r>=this.model.rows||c>=this.model.cols)return null; return {r,c}; };
    const apply=(r,c)=>{ const key=r+","+c, h=this.model.hamster;
      if(this.tool==="wall"){ if(h.row===r&&h.col===c)return; this.model.walls.add(key); this.model.grains.delete(key); }
      else if(this.tool==="eraser"){ this.model.walls.delete(key); this.model.grains.delete(key); }
      else if(this.tool==="korn"){ if(this.model.walls.has(key))return; const kn=this.$(".kornN")?Math.max(1,+this.$(".kornN").value||1):1; this.model.grains.set(key,(this.model.grains.get(key)||0)+kn); }
      else if(this.tool==="hamster"){ if(this.model.walls.has(key))this.model.walls.delete(key); if(h.row===r&&h.col===c)h.dir=(h.dir+3)%4; else { h.row=r; h.col=c; } }
      this.initial=cloneModel(this.model); this._render();
    };
    const down=e=>{ const t=tileAt(e); if(!t)return; this.paint=true; apply(t.r,t.c); this.lastPaint=t.r+","+t.c; e.preventDefault(); };
    const move=e=>{ if(!this.paint||this.tool==="hamster")return; const t=tileAt(e); if(!t)return; const k=t.r+","+t.c; if(k===this.lastPaint)return; this.lastPaint=k; apply(t.r,t.c); };
    const up=()=>{ this.paint=false; };
    this.board.addEventListener("mousedown",down); this.board.addEventListener("mousemove",move); window.addEventListener("mouseup",up);
    this.board.addEventListener("touchstart",down,{passive:false}); this.board.addEventListener("touchmove",move,{passive:false}); window.addEventListener("touchend",up);
  }
  _resize(){
    let R=Math.max(1,Math.min(30,+this.$(".rIn").value||this.model.rows)), C=Math.max(1,Math.min(30,+this.$(".cIn").value||this.model.cols));
    const walls=new Set(), grains=new Map();
    for(const w of this.model.walls){ const [r,c]=w.split(",").map(Number); if(r<R&&c<C)walls.add(w); }
    for(const [k,v] of this.model.grains){ const [r,c]=k.split(",").map(Number); if(r<R&&c<C)grains.set(k,v); }
    const h=Object.assign({},this.model.hamster); h.row=Math.min(h.row,R-1); h.col=Math.min(h.col,C-1);
    this.model={rows:R,cols:C,walls,grains,hamster:h}; this.initial=cloneModel(this.model);
    this._buildBoard(); this._render();
  }

  /* ----- Undo / Redo ----- */
  _snap(){ const t=this.code_; return {v:t.value, s:t.selectionStart, e:t.selectionEnd}; }
  _commit(){ if(!this.code_) return; clearTimeout(this._recT); if(!this._undo) this._undo=[]; if(!this._redo) this._redo=[]; const top=this._undo[this._undo.length-1]; if(!top || top.v!==this.code_.value){ this._undo.push(this._snap()); if(this._undo.length>400) this._undo.shift(); this._redo=[]; } }
  _restore(st){ const t=this.code_; t.value=st.v; t.selectionStart=st.s; t.selectionEnd=st.e; this.code=t.value; this._refreshEditor(); if(this.onCode)this.onCode(this.code); }
  _undoEdit(){ if(!this.code_) return; this._commit(); if(this._undo.length>1){ this._redo.push(this._undo.pop()); this._restore(this._undo[this._undo.length-1]); } }
  _redoEdit(){ if(!this.code_) return; if(this._redo&&this._redo.length){ const st=this._redo.pop(); this._undo.push(st); this._restore(st); } }

  /* ----- Öffentliche API ----- */
  getCode(){ return this.code_?this.code_.value:this.code; }
  setCode(s){ this.code=s; if(this.code_){ this.code_.value=s; this._refreshEditor(); this._undo=[this._snap()]; this._redo=[]; clearTimeout(this._recT); } }
  getTerritory(){ return toJSON(this.initial); }
  getModel(){ return cloneModel(this.model); }
  reset(){ this._stopRun(true); this._resetModel(); if(this._clearOut) this._clearOut(); this.runState="idle"; if(this._updateBtns) this._updateBtns(); }
  onFinish(fn){ this._onFinish=fn; }
}

function grainHTML(n){
  if(n<=0) return "";
  const dots=Math.min(n,4); let s='<div class="grains">';
  for(let i=0;i<dots;i++) s+='<i class="kern"></i>';
  return s+'</div><span class="kbadge">'+n+'</span>';   // Zähler immer in der Ecke (auch unter Hamster sichtbar)
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- Auto-Check: prüft, ob ein Ziel erfüllt ist ---------- */
// goal: {type:'noGrains'} | {type:'allEaten'} | {type:'atPos', row, col} | {type:'grainsInMaul', n}
function checkGoal(goal, model){
  if(!goal||!goal.type) return null;
  const total=()=>{ let t=0; for(const v of model.grains.values()) t+=v; return t; };
  switch(goal.type){
    case "noGrains": return total()===0;
    case "grainsInMaul": return model.hamster.grains>= (goal.n||0);
    case "atPos": return model.hamster.row===goal.row && model.hamster.col===goal.col;
    case "solution": {
      // Vergleich des Körner-Endzustands (und optional der Hamster-Endposition) mit der Musterlösung
      const want=goal.grains||{}; const cur={};
      for(const [k,v] of model.grains){ if(v>0) cur[k]=v; }
      const wk=Object.keys(want); if(wk.length!==Object.keys(cur).length) return false;
      for(const k of wk){ if(cur[k]!==want[k]) return false; }
      if(goal.matchHamster && (model.hamster.row!==goal.hrow || model.hamster.col!==goal.hcol)) return false;
      return true;
    }
    default: return null;
  }
}

window.HamsterView = HamsterView;
window.HamsterEngine = { parse, compileCheck, makeInterpreter, buildTerr, blankTerr, toJSON, toModel, cloneModel, checkGoal };
window.HamsterEngineReady = true;
})();
