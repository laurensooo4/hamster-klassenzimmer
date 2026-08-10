"use strict";
/* ============================================================================
   javaengine.js — Eigenständige Java-Engine für das ☕-Java-Tool
   ----------------------------------------------------------------------------
   Vollständig im Browser: Lexer → Parser → Typprüfer → Interpreter.
   Unterstütztes Schul-Java (bewusst OHNE: Interfaces, Generics außer
   ArrayList<E>, Packages, try/catch, Threads, eigene Annotationen):
     • mehrere Dateien, mehrere Klassen, Vererbung (extends), super, abstract
     • Felder/Methoden/Konstruktoren, static, private/protected/public, final
     • Typen: int double boolean char String, Klassen, Arrays (1D+2D), null
     • Kontrollfluss: if/else, while, do, for, for-each, switch, break/continue
     • Operatoren inkl. ternär ?:, ++/--, zusammengesetzte Zuweisungen
     • System.out.print(ln), Scanner (async Konsolen-Eingabe), Math, ArrayList,
       Integer/Double.parseXxx, String-Methoden, toString()-Dispatch
     • Java-konforme Semantik: int-Division, char als Zahl, Ausgabe "1.0",
       dynamische Bindung, NullPointer-/ArrayIndex-/Arithmetic-Fehler
   API (window.JavaEngine):
     compile(files)                    files=[{name,content}] → {classes, ...}
                                       wirft {file,line,message} bei Fehlern
     run(compiled, io, opts)           async; io={print(s), input():Promise}
     runHeadless(files, stdinLines)    → {ok, output, error, steps}
   Die Hamster-Engine (engine.js) bleibt unabhängig und unangetastet.
   ============================================================================ */
(function(){

/* ---------------------------------------------------------------- Fehler -- */
function cerr(file, line, msg){                       // Compilerfehler
  const e = new Error(msg);
  e.jerr = { kind:"compile", file, line, message: msg };
  return e;
}
function rerrObj(name, msg, file, line){              // Laufzeitfehler (Java-Name)
  const e = new Error(msg);
  e.jerr = { kind:"runtime", name, file, line, message: msg };
  return e;
}

/* ----------------------------------------------------------------- Lexer -- */
const KW = new Set(["class","extends","abstract","public","private","protected",
  "static","final","void","int","double","boolean","char","new","this","super",
  "return","if","else","while","do","for","break","continue","true","false",
  "null","instanceof","switch","case","default","import","package"]);
const PUNCT3 = [">>>","<<=",">>="];
const PUNCT2 = ["==","!=","<=",">=","&&","||","++","--","+=","-=","*=","/=","%=","->","<<",">>"];

function lex(src, file){
  const toks = []; let i = 0, line = 1;
  const n = src.length;
  const isD  = c => c >= "0" && c <= "9";
  const isW  = c => /[A-Za-z_$ÄÖÜäöüß]/.test(c);
  const isWD = c => isW(c) || isD(c);
  while(i < n){
    const c = src[i];
    if(c === "\n"){ line++; i++; continue; }
    if(c === " " || c === "\t" || c === "\r"){ i++; continue; }
    if(c === "/" && src[i+1] === "/"){ while(i < n && src[i] !== "\n") i++; continue; }
    if(c === "/" && src[i+1] === "*"){
      i += 2;
      while(i < n && !(src[i] === "*" && src[i+1] === "/")){ if(src[i] === "\n") line++; i++; }
      if(i >= n) throw cerr(file, line, "Kommentar /* wurde nicht mit */ geschlossen.");
      i += 2; continue;
    }
    if(isD(c) || (c === "." && isD(src[i+1]))){
      let s = i, isDouble = false;
      while(i < n && isD(src[i])) i++;
      if(src[i] === "." && isD(src[i+1])){ isDouble = true; i++; while(i < n && isD(src[i])) i++; }
      if(src[i] === "d" || src[i] === "D"){ isDouble = true; i++; }
      if(src[i] === "f" || src[i] === "F"){ isDouble = true; i++; }
      const raw = src.slice(s, i).replace(/[dDfF]$/, "");
      toks.push({ t: isDouble ? "dnum" : "num", v: parseFloat(raw), line });
      continue;
    }
    if(isW(c)){
      let s = i; while(i < n && isWD(src[i])) i++;
      const w = src.slice(s, i);
      toks.push({ t: KW.has(w) ? "kw" : "id", v: w, line });
      continue;
    }
    if(c === '"'){
      i++; let out = "";
      while(i < n && src[i] !== '"'){
        if(src[i] === "\n") throw cerr(file, line, "Zeichenkette (\") wurde nicht geschlossen.");
        if(src[i] === "\\"){
          const e = src[i+1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === '"' ? '"' : e === "'" ? "'" : e;
          i += 2;
        } else { out += src[i++]; }
      }
      if(i >= n) throw cerr(file, line, "Zeichenkette (\") wurde nicht geschlossen.");
      i++; toks.push({ t:"str", v: out, line }); continue;
    }
    if(c === "'"){
      i++; let ch;
      if(src[i] === "\\"){
        const e = src[i+1];
        ch = e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === "'" ? "'" : e === '"' ? '"' : e === "0" ? "\0" : e;
        i += 2;
      } else { ch = src[i++]; }
      if(src[i] !== "'") throw cerr(file, line, "char-Literal wurde nicht mit ' geschlossen (genau EIN Zeichen).");
      i++; toks.push({ t:"char", v: ch.charCodeAt(0), line }); continue;
    }
    let matched = null;
    for(const p of PUNCT3){ if(src.startsWith(p, i)){ matched = p; break; } }
    if(!matched) for(const p of PUNCT2){ if(src.startsWith(p, i)){ matched = p; break; } }
    if(!matched && "+-*/%(){}[];,.<>=!&|?:~^@".includes(c)) matched = c;
    if(!matched) throw cerr(file, line, "Unerwartetes Zeichen: '" + c + "'");
    toks.push({ t:"p", v: matched, line }); i += matched.length;
  }
  toks.push({ t:"eof", v:"", line });
  return toks;
}

/* -------------------------------------------------------------- Typ-Repr -- */
/* Typ = {base:"int"|"double"|"boolean"|"char"|"String"|"void"|"null"|Klassenname,
          prim:bool, dims:0..2, elem?:Typ(fuer ArrayList)} */
const PRIMS = new Set(["int","double","boolean","char"]);
function T(base, dims, elem, targs){ return { base, dims: dims||0, prim: PRIMS.has(base) && !(dims||0), elem: elem||null, targs: targs||null }; }
const T_INT = T("int"), T_DOUBLE = T("double"), T_BOOL = T("boolean"),
      T_CHAR = T("char"), T_STR = T("String"), T_VOID = T("void"), T_NULL = T("null");
function tEq(a, b){
  if(!a || !b) return false;
  if(a.dims !== b.dims) return false;
  if(a.base !== b.base) return false;
  if(a.elem || b.elem){ if(!(a.elem && b.elem && tEq(a.elem, b.elem))) return false; }
  const ta = a.targs || [], tb = b.targs || [];
  if(ta.length !== tb.length) return false;
  for(let i = 0; i < ta.length; i++) if(!tEq(ta[i], tb[i])) return false;
  return true;
}
function tName(t){
  if(!t) return "?";
  let s = t.base;
  if(t.elem) s += "<" + tName(t.elem) + ">";
  else if(t.targs && t.targs.length) s += "<" + t.targs.map(tName).join(", ") + ">";
  for(let i = 0; i < t.dims; i++) s += "[]";
  return s;
}

/* ---------------------------------------------------------------- Parser -- */
function Parser(toks, file){
  let p = 0;
  const peek = (o) => toks[p + (o||0)];
  const cur  = () => toks[p];
  const line = () => toks[p].line;
  function next(){ return toks[p++]; }
  function isP(v, o){ const t = peek(o); return t.t === "p" && t.v === v; }
  function isKw(v, o){ const t = peek(o); return t.t === "kw" && t.v === v; }
  function expectP(v, what){
    if(!isP(v)) throw cerr(file, line(), "'" + v + "' erwartet" + (what ? " " + what : "") + " (gefunden: '" + cur().v + "').");
    return next();
  }
  function expectKw(v){
    if(!isKw(v)) throw cerr(file, line(), "'" + v + "' erwartet (gefunden: '" + cur().v + "').");
    return next();
  }
  function expectId(what){
    if(cur().t !== "id") throw cerr(file, line(), "Name erwartet " + (what||"") + " (gefunden: '" + cur().v + "').");
    return next().v;
  }

  /* --- Typen --- */
  function isTypeStart(o){
    o = o || 0;
    const t = peek(o);
    if(t.t === "kw" && (PRIMS.has(t.v) || t.v === "void")) return true;
    if(t.t === "id"){
      // Klassenname/String — Typ nur, wenn Deklarationsmuster folgt (prüft Aufrufer)
      return true;
    }
    return false;
  }
  function parseType(allowVoid){
    let base, ln = line();
    if(cur().t === "kw" && (PRIMS.has(cur().v) || cur().v === "void")){ base = next().v; }
    else if(cur().t === "id"){ base = next().v; }
    else throw cerr(file, ln, "Typ erwartet (gefunden: '" + cur().v + "').");
    if(base === "void" && !allowVoid) throw cerr(file, ln, "'void' ist hier nicht erlaubt.");
    let targs = null;
    if(isP("<")){                       // Typ-Argumente: ArrayList<Typ> oder eigene generische Klassen Box<T,...>
      next(); targs = [];
      if(!isP(">")){ for(;;){ targs.push(parseType(false)); if(isP(",")) next(); else break; } }
      expectP(">", "nach den Typ-Argumenten");
    }
    const elem = (base === "ArrayList" && targs && targs.length === 1) ? targs[0] : null;
    let dims = 0;
    while(isP("[") && isP("]", 1)){ next(); next(); dims++; if(dims > 2) throw cerr(file, ln, "Nur 1- und 2-dimensionale Arrays werden unterstützt."); }
    return T(base, dims, elem, base === "ArrayList" ? null : targs);
  }

  /* Erkennung: "Typ name" (Deklaration) vs. Ausdruck — Lookahead */
  function declAhead(){
    // prim/void → immer Deklaration
    if(cur().t === "kw" && (PRIMS.has(cur().v))) return true;
    if(cur().t !== "id") return false;
    let o = 1;
    if(isP("<", o)){                    // ArrayList<...>
      let depth = 1; o++;
      while(depth > 0){
        const t = peek(o);
        if(t.t === "eof") return false;
        if(t.t === "p" && t.v === "<") depth++;
        if(t.t === "p" && t.v === ">") depth--;
        o++;
      }
    }
    while(peek(o).t === "p" && peek(o).v === "[" && peek(o+1).t === "p" && peek(o+1).v === "]") o += 2;
    return peek(o).t === "id";
  }

  /* --- Datei: Klassen --- */
  function parseFile(){
    const classes = [];
    while(cur().t !== "eof"){
      if(isKw("import") || isKw("package")){    // ignorieren (bis Semikolon)
        while(cur().t !== "eof" && !isP(";")) next();
        if(isP(";")) next();
        continue;
      }
      classes.push(parseClass());
    }
    return classes;
  }

  function parseClass(){
    let isAbstract = false, ln = line();
    while(isKw("public") || isKw("abstract") || isKw("final")){
      if(isKw("abstract")) isAbstract = true;
      next();
    }
    expectKw("class");
    const name = expectId("für die Klasse");
    let typeParams = null;
    if(isP("<")){                                    // eigene generische Klasse: class Box<T> / class Paar<K,V>
      next(); typeParams = [];
      for(;;){ typeParams.push(expectId("als Typ-Parameter")); if(isP(",")) next(); else break; }
      expectP(">", "nach den Typ-Parametern");
    }
    let superName = null;
    if(isKw("extends")){ next(); superName = expectId("nach 'extends'"); }
    if(typeParams && superName) throw cerr(file, ln, "Eine generische Klasse kann nicht erben (bewusste Vereinfachung).");
    if(cur().t === "kw" && cur().v === "implements") throw cerr(file, line(), "Interfaces (implements) werden nicht unterstützt.");
    expectP("{", "am Klassenbeginn");
    const cls = { name, superName, typeParams, abstract: isAbstract, fields: [], methods: [], ctors: [], file, line: ln };
    while(!isP("}")){
      if(cur().t === "eof") throw cerr(file, line(), "Klasse '" + name + "' wurde nicht mit } geschlossen.");
      parseMember(cls);
    }
    next(); // }
    if(isP(";")) next();
    return cls;
  }

  function parseMember(cls){
    let vis = "public", isStatic = false, isAbstract = false, isFinal = false;
    const mln = line();
    for(;;){
      if(isKw("public")){ vis = "public"; next(); }
      else if(isKw("private")){ vis = "private"; next(); }
      else if(isKw("protected")){ vis = "protected"; next(); }
      else if(isKw("static")){ isStatic = true; next(); }
      else if(isKw("abstract")){ isAbstract = true; next(); }
      else if(isKw("final")){ isFinal = true; next(); }
      else break;
    }
    // Konstruktor?  Name == Klassenname und '(' folgt
    if(cur().t === "id" && cur().v === cls.name && isP("(", 1)){
      next();
      const params = parseParams();
      const body = parseBlock();
      cls.ctors.push({ params, body, vis, file, line: mln });
      return;
    }
    const type = parseType(true);
    const name = expectId("für Feld oder Methode");
    if(isP("(")){
      const params = parseParams();
      let body = null;
      if(isAbstract){
        expectP(";", "nach abstrakter Methode (abstrakte Methoden haben KEINEN Rumpf)");
      } else {
        if(isP(";")) throw cerr(file, line(), "Methode '" + name + "' braucht einen Rumpf { … } (oder markiere sie als abstract).");
        body = parseBlock();
      }
      cls.methods.push({ name, ret: type, params, body, static: isStatic, vis, abstract: isAbstract, final: isFinal, file, line: mln });
      return;
    }
    // Feld(er)
    if(tEq(type, T_VOID)) throw cerr(file, mln, "Ein Feld kann nicht 'void' sein.");
    let fname = name;
    for(;;){
      let init = null;
      if(isP("=")){ next(); init = isP("{") ? parseArrayLiteral() : parseExpr(); }
      cls.fields.push({ name: fname, type, static: isStatic, vis, final: isFinal, init, file, line: mln });
      if(isP(",")){ next(); fname = expectId("für weiteres Feld"); }
      else break;
    }
    expectP(";", "nach der Feld-Deklaration");
  }

  function parseParams(){
    expectP("(");
    const ps = [];
    if(!isP(")")){
      for(;;){
        if(isKw("final")) next();
        const t = parseType(false);
        const nm = expectId("für den Parameter");
        ps.push({ name: nm, type: t });
        if(isP(",")) next(); else break;
      }
    }
    expectP(")", "nach den Parametern");
    return ps;
  }

  /* --- Statements --- */
  function parseBlock(){
    const ln = line();
    expectP("{", "für den Block");
    const body = [];
    while(!isP("}")){
      if(cur().t === "eof") throw cerr(file, line(), "Block wurde nicht mit } geschlossen.");
      body.push(parseStmt());
    }
    next();
    return { kind:"block", body, line: ln };
  }

  function parseStmt(){
    const ln = line();
    if(isP("{")) return parseBlock();
    if(isP(";")){ next(); return { kind:"empty", line: ln }; }
    if(isKw("if")){
      next(); expectP("(", "nach 'if'");
      const cond = parseExpr(); expectP(")", "nach der if-Bedingung");
      const then = parseStmt();
      let els = null;
      if(isKw("else")){ next(); els = parseStmt(); }
      return { kind:"if", cond, then, els, line: ln };
    }
    if(isKw("while")){
      next(); expectP("(", "nach 'while'");
      const cond = parseExpr(); expectP(")");
      const body = parseStmt();
      return { kind:"while", cond, body, line: ln };
    }
    if(isKw("do")){
      next();
      const body = parseStmt();
      expectKw("while"); expectP("(", "nach 'do … while'");
      const cond = parseExpr(); expectP(")"); expectP(";", "nach do-while");
      return { kind:"dowhile", cond, body, line: ln };
    }
    if(isKw("for")){
      next(); expectP("(", "nach 'for'");
      // for-each?  for (Typ name : ausdruck)
      const save = p;
      if(declAhead()){
        const t = parseType(false);
        const nm = expectId();
        if(isP(":")){
          next();
          const it = parseExpr();
          expectP(")", "nach dem for-each-Kopf");
          const body = parseStmt();
          return { kind:"foreach", varType: t, varName: nm, iter: it, body, line: ln };
        }
        p = save;   // normales for mit Deklaration
      }
      let init = null;
      if(!isP(";")){
        init = declAhead() ? parseVarDecl() : { kind:"expr", expr: parseExpr(), line: line() };
      }
      expectP(";", "im for-Kopf");
      let cond = null;
      if(!isP(";")) cond = parseExpr();
      expectP(";", "im for-Kopf");
      let step = null;
      if(!isP(")")) step = { kind:"expr", expr: parseExpr(), line: line() };
      expectP(")", "nach dem for-Kopf");
      const body = parseStmt();
      return { kind:"for", init, cond, step, body, line: ln };
    }
    if(isKw("switch")){
      next(); expectP("(", "nach 'switch'");
      const subject = parseExpr(); expectP(")"); expectP("{", "für den switch-Block");
      const cases = []; let def = null;
      while(!isP("}")){
        if(isKw("case")){
          next();
          const v = parseExpr();               // Konstante (geprüft im Checker)
          expectP(":", "nach dem case-Wert");
          const stmts = [];
          while(!isKw("case") && !isKw("default") && !isP("}")) stmts.push(parseStmt());
          cases.push({ value: v, stmts, line: ln });
        } else if(isKw("default")){
          next(); expectP(":", "nach 'default'");
          const stmts = [];
          while(!isKw("case") && !isKw("default") && !isP("}")) stmts.push(parseStmt());
          def = stmts;
        } else throw cerr(file, line(), "In einem switch-Block sind nur 'case' und 'default' erlaubt.");
      }
      next();
      return { kind:"switch", subject, cases, def, line: ln };
    }
    if(isKw("return")){
      next();
      let val = null;
      if(!isP(";")) val = parseExpr();
      expectP(";", "nach 'return'");
      return { kind:"return", val, line: ln };
    }
    if(isKw("break")){ next(); expectP(";", "nach 'break'"); return { kind:"break", line: ln }; }
    if(isKw("continue")){ next(); expectP(";", "nach 'continue'"); return { kind:"continue", line: ln }; }
    if(isKw("super") && isP("(", 1)){          // super(...) als Statement (nur im Konstruktor)
      next();
      const args = parseArgs();
      expectP(";", "nach super(…)");
      return { kind:"superctor", args, line: ln };
    }
    if(declAhead() || isKw("final")){
      const d = parseVarDecl();
      expectP(";", "nach der Variablen-Deklaration");
      return d;
    }
    const e = parseExpr();
    expectP(";", "nach dem Ausdruck (fehlt ein Semikolon?)");
    return { kind:"expr", expr: e, line: ln };
  }

  function parseVarDecl(){
    const ln = line();
    let isFinal = false;
    if(isKw("final")){ isFinal = true; next(); }
    const type = parseType(false);
    const decls = [];
    for(;;){
      const nm = expectId("für die Variable");
      let extra = 0;
      while(isP("[") && isP("]", 1)){ next(); next(); extra++; }   // int a[] — auch erlaubt
      let init = null;
      if(isP("=")){ next(); init = isP("{") ? parseArrayLiteral() : parseExpr(); }
      const t = extra ? T(type.base, type.dims + extra, type.elem) : type;
      decls.push({ name: nm, type: t, init });
      if(isP(",")) next(); else break;
    }
    return { kind:"vardecl", decls, final: isFinal, line: ln };
  }

  function parseArrayLiteral(){
    const ln = line();
    expectP("{");
    const items = [];
    if(!isP("}")){
      for(;;){
        items.push(isP("{") ? parseArrayLiteral() : parseExpr());
        if(isP(",")) next(); else break;
      }
    }
    expectP("}", "am Ende des Array-Literals");
    return { kind:"arrlit", items, line: ln };
  }

  function parseArgs(){
    expectP("(");
    const args = [];
    if(!isP(")")){
      for(;;){ args.push(parseExpr()); if(isP(",")) next(); else break; }
    }
    expectP(")", "nach den Argumenten");
    return args;
  }

  /* --- Ausdrücke (Präzedenz absteigend) --- */
  function parseExpr(){ return parseAssign(); }

  function parseAssign(){
    const ln = line();
    const left = parseTernary();
    if(isP("=") || isP("+=") || isP("-=") || isP("*=") || isP("/=") || isP("%=")){
      const op = next().v;
      const right = isP("{") ? parseArrayLiteral() : parseAssign();
      return { kind:"assign", op, target: left, value: right, line: ln };
    }
    return left;
  }

  function parseTernary(){
    const ln = line();
    const c = parseOr();
    if(isP("?")){
      next();
      const a = parseExpr();
      expectP(":", "im ?:-Ausdruck");
      const b = parseTernary();
      return { kind:"ternary", cond: c, then: a, els: b, line: ln };
    }
    return c;
  }

  function bin(sub, ops){
    return function(){
      let l = sub();
      for(;;){
        let hit = null;
        for(const o of ops){ if(isP(o)){ hit = o; break; } }
        if(!hit) break;
        const ln = line(); next();
        const r = sub();
        l = { kind:"bin", op: hit, l, r, line: ln };
      }
      return l;
    };
  }
  const parseMul   = bin(parseUnary, ["*","/","%"]);
  const parseAdd   = bin(parseMul, ["+","-"]);
  function parseRel(){
    let l = parseAdd();
    for(;;){
      if(isKw("instanceof")){
        const ln = line(); next();
        const t = parseType(false);
        l = { kind:"instanceof", expr: l, type: t, line: ln };
        continue;
      }
      let hit = null;
      for(const o of ["<=",">=","<",">"]){ if(isP(o)){ hit = o; break; } }
      if(!hit) break;
      const ln = line(); next();
      const r = parseAdd();
      l = { kind:"bin", op: hit, l, r, line: ln };
    }
    return l;
  }
  const parseEqOp  = bin(parseRel, ["==","!="]);
  const parseAnd   = bin(parseEqOp, ["&&"]);
  const parseOr    = bin(parseAnd, ["||"]);

  function parseUnary(){
    const ln = line();
    if(isP("!")){ next(); return { kind:"not", expr: parseUnary(), line: ln }; }
    if(isP("-")){ next(); return { kind:"neg", expr: parseUnary(), line: ln }; }
    if(isP("+")){ next(); return parseUnary(); }
    if(isP("++") || isP("--")){
      const op = next().v;
      return { kind:"predec", op, target: parseUnary(), line: ln };
    }
    // Cast: ( Typ ) unary — Lookahead
    if(isP("(")){
      const save = p;
      next();
      let ok = false, castT = null;
      try{
        if((cur().t === "kw" && PRIMS.has(cur().v)) || cur().t === "id"){
          castT = parseType(false);
          if(isP(")")){
            const after = peek(1);
            // Nach einem Cast muss ein Operand kommen
            if(after.t === "id" || after.t === "num" || after.t === "dnum" || after.t === "str" ||
               after.t === "char" || (after.t === "kw" && ["this","super","new","true","false","null"].includes(after.v)) ||
               (after.t === "p" && (after.v === "(" || after.v === "!" || after.v === "-"))){
              // Nur casten, wenn prim ODER bekannter Klassen-Stil (Großbuchstabe) — Checker prüft Rest
              if(castT.dims > 0 || PRIMS.has(castT.base) || /^[A-Z]/.test(castT.base)) ok = true;
            }
          }
        }
      } catch(e){ ok = false; }
      if(ok){
        next(); // )
        return { kind:"cast", type: castT, expr: parseUnary(), line: ln };
      }
      p = save;
    }
    return parsePostfix();
  }

  function parsePostfix(){
    let e = parsePrimary();
    for(;;){
      const ln = line();
      if(isP(".")){
        next();
        const nm = expectId("nach dem Punkt");
        if(isP("(")){
          const args = parseArgs();
          e = { kind:"mcall", obj: e, name: nm, args, line: ln };
        } else {
          e = { kind:"field", obj: e, name: nm, line: ln };
        }
        continue;
      }
      if(isP("[")){
        next();
        const idx = parseExpr();
        expectP("]", "nach dem Array-Index");
        e = { kind:"index", arr: e, idx, line: ln };
        continue;
      }
      if(isP("++") || isP("--")){
        const op = next().v;
        e = { kind:"postdec", op, target: e, line: ln };
        continue;
      }
      break;
    }
    return e;
  }

  function parsePrimary(){
    const ln = line();
    const t = cur();
    if(t.t === "num"){ next(); return { kind:"int", v: t.v, line: ln }; }
    if(t.t === "dnum"){ next(); return { kind:"double", v: t.v, line: ln }; }
    if(t.t === "str"){ next(); return { kind:"str", v: t.v, line: ln }; }
    if(t.t === "char"){ next(); return { kind:"charlit", v: t.v, line: ln }; }
    if(isKw("true")){ next(); return { kind:"bool", v: true, line: ln }; }
    if(isKw("false")){ next(); return { kind:"bool", v: false, line: ln }; }
    if(isKw("null")){ next(); return { kind:"null", line: ln }; }
    if(isKw("this")){ next(); return { kind:"this", line: ln }; }
    if(isKw("super")){
      next();
      expectP(".", "nach 'super'");
      const nm = expectId("nach 'super.'");
      const args = parseArgs();
      return { kind:"supercall", name: nm, args, line: ln };
    }
    if(isKw("new")){
      next();
      const base = (cur().t === "kw" && PRIMS.has(cur().v)) ? next().v : expectId("nach 'new'");
      let elem = null, ntargs = null;
      if(isP("<")){
        next(); ntargs = [];
        if(!isP(">")){ for(;;){ ntargs.push(parseType(false)); if(isP(",")) next(); else break; } }   // leer = Diamant <>
        expectP(">", "bei den Typ-Argumenten");
        if(base === "ArrayList" && ntargs.length) elem = ntargs[0];
      }
      if(isP("[")){
        // Array: new int[5], new int[3][4], new int[]{1,2}
        next();
        if(isP("]")){
          next();
          let dims = 1;
          while(isP("[") && isP("]", 1)){ next(); next(); dims++; }
          const lit = parseArrayLiteral();
          return { kind:"newarr", base, dims, sizes: [], lit, line: ln };
        }
        const s1 = parseExpr();
        expectP("]", "nach der Array-Größe");
        const sizes = [s1];
        let dims = 1;
        while(isP("[")){
          next();
          if(isP("]")){ next(); dims++; continue; }   // new int[3][]
          sizes.push(parseExpr());
          expectP("]"); dims++;
        }
        if(dims > 2) throw cerr(file, ln, "Nur 1- und 2-dimensionale Arrays werden unterstützt.");
        return { kind:"newarr", base, dims, sizes, lit: null, line: ln };
      }
      const args = parseArgs();
      return { kind:"new", className: base, elem, targs: base === "ArrayList" ? null : ntargs, args, line: ln };
    }
    if(isP("(")){
      next();
      const e = parseExpr();
      expectP(")", "nach dem geklammerten Ausdruck");
      return e;
    }
    if(t.t === "id"){
      next();
      if(isP("(")){
        const args = parseArgs();
        return { kind:"call", name: t.v, args, line: ln };
      }
      return { kind:"var", name: t.v, line: ln };
    }
    throw cerr(file, ln, "Unerwartetes Zeichen: '" + t.v + "' — hier wird ein Wert oder Ausdruck erwartet.");
  }

  return { parseFile };
}

/* ------------------------------------------------- Eingebaute Bibliothek -- */
/* Wrapper-Elementtypen für ArrayList: Integer≈int, Double≈double, … */
const BOX = { Integer:"int", Double:"double", Boolean:"boolean", Character:"char" };
function unbox(t){ return (t && !t.dims && BOX[t.base]) ? T(BOX[t.base]) : t; }

const STR_METH = {
  length:{a:[[ ]], r:()=>T_INT}, isEmpty:{a:[[ ]], r:()=>T_BOOL},
  charAt:{a:[[T_INT]], r:()=>T_CHAR},
  substring:{a:[[T_INT],[T_INT,T_INT]], r:()=>T_STR},
  equals:{a:[[T_STR]], r:()=>T_BOOL}, equalsIgnoreCase:{a:[[T_STR]], r:()=>T_BOOL},
  contains:{a:[[T_STR]], r:()=>T_BOOL}, startsWith:{a:[[T_STR]], r:()=>T_BOOL}, endsWith:{a:[[T_STR]], r:()=>T_BOOL},
  indexOf:{a:[[T_STR],[T_CHAR]], r:()=>T_INT}, lastIndexOf:{a:[[T_STR],[T_CHAR]], r:()=>T_INT},
  toUpperCase:{a:[[ ]], r:()=>T_STR}, toLowerCase:{a:[[ ]], r:()=>T_STR}, trim:{a:[[ ]], r:()=>T_STR},
  replace:{a:[[T_CHAR,T_CHAR],[T_STR,T_STR]], r:()=>T_STR},
  compareTo:{a:[[T_STR]], r:()=>T_INT},
  split:{a:[[T_STR]], r:()=>T("String",1)},
  toString:{a:[[ ]], r:()=>T_STR},
};
const LIST_METH = {  // E = Elementtyp
  add:{a:[["E"],[T_INT,"E"]], r:(E,argc)=> argc===1 ? T_BOOL : T_VOID},
  get:{a:[[T_INT]], r:(E)=>E}, set:{a:[[T_INT,"E"]], r:(E)=>E},
  remove:{a:[[T_INT]], r:(E)=>E}, size:{a:[[ ]], r:()=>T_INT},
  isEmpty:{a:[[ ]], r:()=>T_BOOL}, contains:{a:[["E"]], r:()=>T_BOOL},
  indexOf:{a:[["E"]], r:()=>T_INT}, clear:{a:[[ ]], r:()=>T_VOID},
  toString:{a:[[ ]], r:()=>T_STR},
};
const SCAN_METH = {
  nextInt:{a:[[ ]], r:()=>T_INT}, nextDouble:{a:[[ ]], r:()=>T_DOUBLE},
  nextLine:{a:[[ ]], r:()=>T_STR}, next:{a:[[ ]], r:()=>T_STR},
  nextBoolean:{a:[[ ]], r:()=>T_BOOL}, hasNextInt:{a:[[ ]], r:()=>T_BOOL},
  hasNext:{a:[[ ]], r:()=>T_BOOL}, close:{a:[[ ]], r:()=>T_VOID},
};
const BUILTIN_CLASSES = new Set(["String","ArrayList","Scanner","Math","System","Integer","Double","Boolean","Character","Object"]);
const WRAPPER_ELEMS  = new Set(["Integer","Double","Boolean","Character","String"]);

/* -------------------------------------------------------------- Prüfer ---- */
function Checker(units){         // units = [{file, classes:[clsDecl]}]
  const classes = new Map();     // Name -> clsDecl (Nutzerklassen)
  for(const u of units){
    for(const c of u.classes){
      if(BUILTIN_CLASSES.has(c.name)) throw cerr(c.file, c.line, "Der Klassenname '" + c.name + "' ist von der Standard-Bibliothek belegt.");
      if(classes.has(c.name)){
        const o = classes.get(c.name);
        throw cerr(c.file, c.line, "Die Klasse '" + c.name + "' existiert schon (in " + o.file + ", Zeile " + o.line + ").");
      }
      classes.set(c.name, c);
    }
  }
  /* Vererbung auflösen + Zyklen */
  for(const c of classes.values()){
    if(c.superName){
      if(BUILTIN_CLASSES.has(c.superName)) throw cerr(c.file, c.line, "Von '" + c.superName + "' kann nicht geerbt werden.");
      if(!classes.has(c.superName)) throw cerr(c.file, c.line, "Unbekannte Oberklasse '" + c.superName + "'.");
      if(c.superName === c.name) throw cerr(c.file, c.line, "Eine Klasse kann nicht von sich selbst erben.");
      if(classes.get(c.superName).typeParams) throw cerr(c.file, c.line, "Von einer generischen Klasse kann nicht geerbt werden (bewusste Vereinfachung).");
    }
  }
  for(const c of classes.values()){
    const seen = new Set([c.name]);
    let s = c.superName;
    while(s){
      if(seen.has(s)) throw cerr(c.file, c.line, "Vererbungs-Kreis entdeckt bei '" + c.name + "'.");
      seen.add(s);
      s = classes.get(s).superName;
    }
  }
  const superOf = (name) => { const c = classes.get(name); return (c && c.superName) ? classes.get(c.superName) : null; };
  function isSubclass(sub, sup){           // Namen; auch gleich
    let c = classes.get(sub);
    while(c){ if(c.name === sup) return true; c = c.superName ? classes.get(c.superName) : null; }
    return false;
  }
  function chainOf(name){
    const out = []; let c = classes.get(name);
    while(c){ out.push(c); c = c.superName ? classes.get(c.superName) : null; }
    return out;
  }
  function findFieldIn(clsName, fname){
    for(const c of chainOf(clsName)){
      const f = c.fields.find(x => x.name === fname);
      if(f) return { field: f, owner: c };
    }
    return null;
  }
  function findMethodIn(clsName, mname, argc){
    for(const c of chainOf(clsName)){
      const m = c.methods.find(x => x.name === mname && x.params.length === argc);
      if(m) return { method: m, owner: c };
    }
    return null;
  }
  function methodExistsAnyArity(clsName, mname){
    for(const c of chainOf(clsName)){ if(c.methods.some(x => x.name === mname)) return true; }
    return false;
  }

  /* Klassentyp-Helfer */
  const isClassType = t => t && !t.dims && !PRIMS.has(t.base) && t.base !== "String" && t.base !== "void" && t.base !== "null" && classes.has(t.base);
  let CUR_TP = null;                    // Typ-Parameter der gerade geprüften (generischen) Klasse
  function isTypeParam(base){ return !!(CUR_TP && CUR_TP.has(base)); }
  /* Substitution: Typ-Parameter -> konkrete Typ-Argumente (fuer Member-Zugriffe von aussen) */
  function substT(t, map){
    if(!t || !map) return t;
    if(map[t.base]){
      const r = map[t.base];
      return T(r.base, r.dims + t.dims, r.elem, r.targs);
    }
    if(t.targs && t.targs.length) return T(t.base, t.dims, t.elem && substT(t.elem, map), t.targs.map(x => substT(x, map)));
    if(t.elem) return T(t.base, t.dims, substT(t.elem, map));
    return t;
  }
  function tpMapOf(clsDecl, objType){
    if(!clsDecl.typeParams) return null;
    const m = {};
    clsDecl.typeParams.forEach((p, i) => { m[p] = (objType.targs && objType.targs[i]) || T_STR; });
    return m;
  }
  const unboxDeep = t => (t && !t.dims && WRAPPER_ELEMS.has(t.base) && t.base !== "String") ? unbox(t) : t;
  function validType(t, file, line){
    if(!t.dims && isTypeParam(t.base)){                            // T innerhalb der eigenen generischen Klasse
      if(t.targs && t.targs.length) throw cerr(file, line, "Ein Typ-Parameter wie '" + t.base + "' darf keine Typ-Argumente haben.");
      return;
    }
    if(t.dims > 0){ if(isTypeParam(t.base)) return; validType(T(t.base, 0, t.elem, t.targs), file, line); return; }
    if(PRIMS.has(t.base) || t.base === "void" || t.base === "String") { if(t.elem || (t.targs && t.targs.length)) throw cerr(file, line, tName(t) + ": '" + t.base + "' darf keine Typ-Argumente haben."); return; }
    if(t.base === "ArrayList"){
      if(!t.elem) throw cerr(file, line, "ArrayList braucht genau EINEN Elementtyp, z. B. ArrayList<String>.");
      if(PRIMS.has(t.elem.base) && !t.elem.dims) throw cerr(file, line, "ArrayList<" + t.elem.base + "> gibt es in Java nicht — nutze ArrayList<" + ({int:"Integer",double:"Double",boolean:"Boolean",char:"Character"})[t.elem.base] + ">.");
      if(t.elem.dims) throw cerr(file, line, "Arrays als ArrayList-Elementtyp werden nicht unterstützt.");
      if(!WRAPPER_ELEMS.has(t.elem.base) && !classes.has(t.elem.base) && !isTypeParam(t.elem.base)) throw cerr(file, line, "Unbekannter Elementtyp '" + t.elem.base + "'.");
      return;
    }
    if(t.base === "Scanner"){ if(t.targs && t.targs.length) throw cerr(file, line, "'Scanner' ist keine generische Klasse — Typ-Argumente hier entfernen."); return; }
    if(BOX[t.base]) throw cerr(file, line, "'" + t.base + "' ist nur als Typ-Argument (z. B. ArrayList<" + t.base + ">) erlaubt — nutze sonst '" + BOX[t.base] + "'.");
    if(t.base === "Object" || t.base === "System" || t.base === "Math") throw cerr(file, line, "'" + t.base + "' kann nicht als Variablentyp verwendet werden.");
    if(!classes.has(t.base)) throw cerr(file, line, "Unbekannter Typ '" + t.base + "'. (Tippfehler? Klasse noch nicht angelegt?)");
    /* eigene generische Klassen: Typ-Argumente prüfen */
    const gcls = classes.get(t.base);
    if(gcls.typeParams){
      if(!t.targs || !t.targs.length) throw cerr(file, line, "'" + t.base + "' ist generisch — bitte Typ-Argumente angeben: " + t.base + "<" + gcls.typeParams.join(", ") + ">.");
      if(t.targs.length !== gcls.typeParams.length) throw cerr(file, line, "'" + t.base + "' erwartet " + gcls.typeParams.length + " Typ-Argument(e), nicht " + t.targs.length + ".");
      for(const ta of t.targs){
        if(ta.dims) throw cerr(file, line, "Arrays als Typ-Argument werden nicht unterstützt.");
        if(PRIMS.has(ta.base)) throw cerr(file, line, t.base + "<" + ta.base + "> gibt es in Java nicht — nutze " + t.base + "<" + ({int:"Integer",double:"Double",boolean:"Boolean",char:"Character"})[ta.base] + ">.");
        if(!WRAPPER_ELEMS.has(ta.base) && !isTypeParam(ta.base)) validType(ta, file, line);
      }
    } else if(t.targs && t.targs.length){
      throw cerr(file, line, "'" + t.base + "' ist keine generische Klasse — Typ-Argumente hier entfernen.");
    }
  }

  function assignable(to, from, fromNode){
    if(!to || !from) return false;
    if(tEq(to, from)) return true;
    if(from.base === "null" && to.base !== "void" && (to.dims > 0 || !PRIMS.has(to.base))) return true;   // null -> jede Referenz, auch int[] etc.
    if(to.dims || from.dims) return false;                        // Arrays invariant (außer null)
    // Wrapper-Boxing für ArrayList-Elemente
    const tb = unbox(to), fb = unbox(from);
    if(tEq(tb, fb)) return true;
    if(tb.base === "double" && (fb.base === "int" || fb.base === "char")) return true;   // Widening
    if(tb.base === "int" && fb.base === "char") return true;
    if(tb.base === "char" && fb.base === "int" && fromNode && fromNode.kind === "int" && fromNode.v >= 0 && fromNode.v <= 65535) return true;  // Konstante
    if(isClassType(to) && isClassType(from)
       && !classes.get(to.base).typeParams && !classes.get(from.base).typeParams   // generische Klassen: nur exakt (invariant, via tEq oben)
       && isSubclass(from.base, to.base)) return true;   // Sub → Super
    return false;
  }
  const numeric = t => t && !t.dims && (t.base === "int" || t.base === "double" || t.base === "char");
  function strHow(t){
    if(!t) return "str";
    if(t.dims > 0) return "arr";
    if(t.base === "char") return "char";
    if(t.base === "double") return "double";
    if(t.base === "boolean") return "bool";
    if(t.base === "String") return "str";
    if(t.base === "int") return "int";
    return "obj";                                              // Klassen, ArrayList, null → toString/null
  }

  /* Mitglieds-Validierung: Overrides, abstract, Konstruktoren */
  function usesTP(t){ if(!t) return false; if(CUR_TP && CUR_TP.has(t.base)) return true; if(t.elem && usesTP(t.elem)) return true; return !!(t.targs && t.targs.some(usesTP)); }
  for(const c of classes.values()){
    CUR_TP = c.typeParams ? new Set(c.typeParams) : null;
    const seenF = new Set(), seenM = new Set(), seenC = new Set();
    for(const f of c.fields){
      if(f.static && usesTP(f.type)) throw cerr(f.file, f.line, "Der Typ-Parameter darf in einem static-Feld nicht verwendet werden — static gehört zur Klasse, nicht zum Objekt.");
      validType(f.type, f.file, f.line);
      if(seenF.has(f.name)) throw cerr(f.file, f.line, "Das Feld '" + f.name + "' existiert in dieser Klasse schon.");
      seenF.add(f.name);
      if(c.superName){
        const hid = findFieldIn(c.superName, f.name);
        if(hid) throw cerr(f.file, f.line, "Das Feld '" + f.name + "' existiert schon in der Oberklasse '" + hid.owner.name + "' — Felder dürfen nicht überdeckt werden.");
      }
    }
    for(const m of c.methods){
      if(m.static && (usesTP(m.ret) || m.params.some(pa => usesTP(pa.type)))) throw cerr(m.file, m.line, "Der Typ-Parameter darf in einer static-Methode nicht verwendet werden — static gehört zur Klasse, nicht zum Objekt.");
      validType(m.ret, m.file, m.line);
      for(const pa of m.params) validType(pa.type, m.file, m.line);
      const key = m.name + "/" + m.params.length;
      if(seenM.has(key)) throw cerr(m.file, m.line, "Die Methode '" + m.name + "' mit " + m.params.length + " Parameter(n) existiert schon. (Überladung geht nur mit unterschiedlicher Parameter-ANZAHL.)");
      seenM.add(key);
      if(m.abstract && !c.abstract) throw cerr(m.file, m.line, "Abstrakte Methoden sind nur in einer 'abstract class' erlaubt.");
      if(m.abstract && m.static) throw cerr(m.file, m.line, "'static' und 'abstract' schließen sich aus.");
      if(m.name === "main"){
        if(!m.static) throw cerr(m.file, m.line, "main muss 'static' sein: public static void main(String[] args)");
      }
      // Override-Regeln
      if(c.superName){
        const sup = findMethodIn(c.superName, m.name, m.params.length);
        if(sup){
          const sm = sup.method;
          if(sm.static !== m.static) throw cerr(m.file, m.line, "'" + m.name + "' ist in der Oberklasse " + (sm.static ? "static" : "eine Instanz-Methode") + " — das darf beim Überschreiben nicht wechseln.");
          if(sm.final) throw cerr(m.file, m.line, "'" + m.name + "' ist in der Oberklasse final und darf nicht überschrieben werden.");
          const retOk = tEq(sm.ret, m.ret) || (isClassType(sm.ret) && isClassType(m.ret) && isSubclass(m.ret.base, sm.ret.base));
          if(!retOk) throw cerr(m.file, m.line, "Beim Überschreiben von '" + m.name + "' muss der Rückgabetyp passen (Oberklasse: " + tName(sm.ret) + ").");
          for(let i = 0; i < m.params.length; i++){
            if(!tEq(sm.params[i].type, m.params[i].type)) throw cerr(m.file, m.line, "Beim Überschreiben von '" + m.name + "' müssen die Parametertypen exakt gleich sein (Oberklasse: " + tName(sm.params[i].type) + ").");
          }
          const rank = v => v === "private" ? 0 : v === "protected" ? 1 : 2;
          if(rank(m.vis) < rank(sm.vis)) throw cerr(m.file, m.line, "Beim Überschreiben darf die Sichtbarkeit nicht kleiner werden (Oberklasse: " + sm.vis + ").");
          if(sm.vis === "private") throw cerr(m.file, m.line, "'" + m.name + "' ist in der Oberklasse private und kann nicht überschrieben werden — benenne die Methode um.");
        }
      }
    }
    for(const k of c.ctors){
      for(const pa of k.params) validType(pa.type, k.file, k.line);
      const key = String(k.params.length);
      if(seenC.has(key)) throw cerr(k.file, k.line, "Es gibt schon einen Konstruktor mit " + k.params.length + " Parameter(n).");
      seenC.add(key);
    }
    if(!c.ctors.length) c.ctors.push({ params: [], body: { kind:"block", body: [], line: c.line }, vis:"public", implicit: true, file: c.file, line: c.line });
  }
  /* abstract: nicht implementierte Methoden in konkreten Klassen */
  for(const c of classes.values()){
    if(c.abstract) continue;
    const pending = new Map();
    for(const anc of chainOf(c.name).reverse()){       // Wurzel zuerst
      for(const m of anc.methods){
        const key = m.name + "/" + m.params.length;
        if(m.abstract) pending.set(key, { m, anc }); else pending.delete(key);
      }
    }
    if(pending.size){
      const first = [...pending.values()][0];
      throw cerr(c.file, c.line, "Klasse '" + c.name + "' muss die abstrakte Methode '" + first.m.name + "' (aus " + first.anc.name + ") implementieren — oder selbst 'abstract' sein.");
    }
  }

  /* ---------------- Ausdrucks-/Statement-Prüfung ---------------- */
  let env = null;                 // Scope-Kette {vars:Map(name->{type,final}), parent}
  let ctx = null;                 // {cls, method|ctor, static, inLoop, inSwitch, file}
  const pushEnv = () => { env = { vars: new Map(), parent: env }; };
  const popEnv  = () => { env = env.parent; };
  function declare(name, type, isFinal, file, line){
    for(let e = env; e; e = e.parent){
      if(e.vars.has(name)) throw cerr(file, line, "Die Variable '" + name + "' existiert hier schon.");
    }
    env.vars.set(name, { type, final: !!isFinal, assigned: false });
  }
  function lookupVar(name){
    for(let e = env; e; e = e.parent){ if(e.vars.has(name)) return e.vars.get(name); }
    return null;
  }
  function checkVisible(member, ownerCls, file, line, what){
    if(member.vis === "private" && ownerCls.name !== ctx.cls.name)
      throw cerr(file, line, what + " '" + member.name + "' ist private in '" + ownerCls.name + "' und hier nicht zugreifbar.");
    if(member.vis === "protected" && !isSubclass(ctx.cls.name, ownerCls.name))
      throw cerr(file, line, what + " '" + member.name + "' ist protected und nur in Unterklassen von '" + ownerCls.name + "' zugreifbar.");
  }

  function checkArgs(args, sigs, E, file, line, what){
    /* sigs: Liste möglicher Parameterlisten (Elemente: Typ oder "E") — nach Anzahl wählen */
    const argTs = args.map(a => checkExpr(a));
    const cands = sigs.filter(s => s.length === args.length);
    if(!cands.length) throw cerr(file, line, what + ": falsche Anzahl Argumente (" + args.length + ").");
    // erst passende Überladung suchen (z. B. indexOf(char) vs. indexOf(String)), sonst erste für die Fehlermeldung
    const fit = cands.find(s => s.every((p, i) => assignable(p === "E" ? E : p, argTs[i], args[i]))) || cands[0];
    for(let i = 0; i < fit.length; i++){
      const want = fit[i] === "E" ? E : fit[i];
      if(!assignable(want, argTs[i], args[i]))
        throw cerr(file, line, what + ": Argument " + (i+1) + " hat Typ " + tName(argTs[i]) + ", erwartet wird " + tName(want) + ".");
      args[i].strHow = strHow(argTs[i]);
    }
    return argTs;
  }
  function checkUserCall(entry, args, file, line, map){
    const m = entry.method;
    checkVisible(m, entry.owner, file, line, "Die Methode");
    const argTs = args.map(a => checkExpr(a));
    for(let i = 0; i < m.params.length; i++){
      const want = map ? substT(m.params[i].type, map) : m.params[i].type;
      if(!assignable(want, argTs[i], args[i]))
        throw cerr(file, line, "'" + m.name + "': Argument " + (i+1) + " hat Typ " + tName(argTs[i]) + ", erwartet wird " + tName(want) + ".");
    }
    return map ? unboxDeep(substT(m.ret, map)) : m.ret;
  }

  function checkExpr(n){
    const t = checkExprInner(n);
    n.jt = t;
    return t;
  }
  function checkExprInner(n){
    const file = ctx.file;
    switch(n.kind){
      case "int": return T_INT;
      case "double": return T_DOUBLE;
      case "str": return T_STR;
      case "charlit": return T_CHAR;
      case "bool": return T_BOOL;
      case "null": return T_NULL;
      case "this":
        if(ctx.static) throw cerr(file, n.line, "'this' gibt es in einer statischen Methode nicht.");
        return T(ctx.cls.name, 0, null, ctx.cls.typeParams ? ctx.cls.typeParams.map(p => T(p)) : null);
      case "var": {
        const v = lookupVar(n.name);
        if(v){ n.ref = "local"; return v.type; }
        const ff = findFieldIn(ctx.cls.name, n.name);
        if(ff){
          checkVisible(ff.field, ff.owner, file, n.line, "Das Feld");
          if(!ff.field.static && ctx.static) throw cerr(file, n.line, "Das Instanz-Feld '" + n.name + "' ist in einer statischen Methode nicht verfügbar.");
          n.ref = ff.field.static ? "sfield" : "ifield";
          n.owner = ff.owner.name;
          return ff.field.type;
        }
        if(classes.has(n.name) || n.name === "System" || n.name === "Math" || n.name === "Integer" || n.name === "Double" || n.name === "Boolean" || n.name === "Character" || n.name === "String"){
          n.ref = "class";
          return T("§class:" + n.name);
        }
        throw cerr(file, n.line, "Unbekannte Variable '" + n.name + "'. (Deklariert? Schreibweise?)");
      }
      case "assign": return checkAssign(n);
      case "ternary": {
        const ct = checkExpr(n.cond);
        if(!tEq(ct, T_BOOL)) throw cerr(file, n.line, "Vor dem '?' muss ein boolean stehen (ist: " + tName(ct) + ").");
        const a = checkExpr(n.then), b = checkExpr(n.els);
        if(assignable(a, b, n.els)) return a;
        if(assignable(b, a, n.then)) return b;
        if(numeric(a) && numeric(b)) return (a.base === "double" || b.base === "double") ? T_DOUBLE : T_INT;
        throw cerr(file, n.line, "Die beiden ?:-Ergebnisse passen nicht zusammen (" + tName(a) + " / " + tName(b) + ").");
      }
      case "bin": return checkBin(n);
      case "not": {
        const t = checkExpr(n.expr);
        if(!tEq(t, T_BOOL)) throw cerr(file, n.line, "'!' braucht ein boolean (ist: " + tName(t) + ").");
        return T_BOOL;
      }
      case "neg": {
        const t = checkExpr(n.expr);
        if(!numeric(t)) throw cerr(file, n.line, "'-' braucht eine Zahl (ist: " + tName(t) + ").");
        return t.base === "double" ? T_DOUBLE : T_INT;
      }
      case "predec": case "postdec": {
        const t = checkLValue(n.target, "++/--");
        if(!numeric(t)) throw cerr(file, n.line, "++/-- braucht eine Zahlen-Variable (ist: " + tName(t) + ").");
        return t;
      }
      case "cast": {
        const from = checkExpr(n.expr);
        const to = n.type;
        if(PRIMS.has(to.base) && !to.dims){
          if(!numeric(from) && !(from.base === "boolean" && to.base === "boolean"))
            throw cerr(file, n.line, "(" + tName(to) + ") kann " + tName(from) + " nicht umwandeln.");
          return T(to.base);
        }
        if(classes.has(to.base) && classes.get(to.base).typeParams) throw cerr(file, n.line, "Casts auf generische Klassen werden nicht unterstützt.");
        validType(to, file, n.line);
        if(to.base === "String"){
          if(from.base === "String" || from.base === "null") return T_STR;
          throw cerr(file, n.line, "(String) kann " + tName(from) + " nicht umwandeln — nutze String.valueOf(…).");
        }
        if(isClassType(to) && (from.base === "null" || (isClassType(from) && (isSubclass(from.base, to.base) || isSubclass(to.base, from.base)))))
          return to;
        throw cerr(file, n.line, "Cast von " + tName(from) + " nach " + tName(to) + " ist nicht möglich.");
      }
      case "instanceof": {
        const t = checkExpr(n.expr);
        if(classes.has(n.type.base) && classes.get(n.type.base).typeParams) throw cerr(file, n.line, "instanceof mit generischen Klassen wird nicht unterstützt.");
        validType(n.type, file, n.line);
        if(!isClassType(n.type)) throw cerr(file, n.line, "instanceof funktioniert nur mit Klassen.");
        if(!isClassType(t) && t.base !== "null") throw cerr(file, n.line, "Links von instanceof muss ein Objekt stehen (ist: " + tName(t) + ").");
        return T_BOOL;
      }
      case "arrlit": throw cerr(file, n.line, "Array-Literale {…} sind nur direkt bei der Deklaration erlaubt: int[] a = {1,2,3};");
      case "newarr": {
        const base = n.base;
        if(!PRIMS.has(base) && base !== "String" && !classes.has(base)) throw cerr(file, n.line, "Unbekannter Array-Typ '" + base + "'.");
        for(const s of n.sizes){
          const st = checkExpr(s);
          if(!assignable(T_INT, st, s)) throw cerr(file, n.line, "Die Array-Größe muss ein int sein (ist: " + tName(st) + ").");
        }
        const t = T(base, n.dims);
        if(n.lit) checkArrLit(n.lit, t, file);
        return t;
      }
      case "new": {
        if(n.className === "Scanner"){
          // new Scanner(System.in)
          if(n.args.length !== 1) throw cerr(file, n.line, "new Scanner(System.in) erwartet genau System.in.");
          const a = n.args[0];
          if(!(a.kind === "field" && a.name === "in" && a.obj.kind === "var" && a.obj.name === "System"))
            throw cerr(file, n.line, "Der Scanner liest hier immer von System.in: new Scanner(System.in)");
          a.skipCheck = true;
          n.builtin = "scanner";
          return T("Scanner");
        }
        if(n.className === "ArrayList"){
          const t = T("ArrayList", 0, n.elem || null);
          if(!n.elem) throw cerr(file, n.line, "Bitte Elementtyp angeben: new ArrayList<Typ>() (Diamant <> braucht links den Typ — schreibe ihn hier aus).");
          validType(t, file, n.line);
          if(n.args.length) throw cerr(file, n.line, "new ArrayList<…>() erwartet keine Argumente.");
          n.builtin = "arraylist";
          return t;
        }
        const cls = classes.get(n.className);
        if(!cls) throw cerr(file, n.line, "Unbekannte Klasse '" + n.className + "'.");
        if(cls.abstract) throw cerr(file, n.line, "'" + n.className + "' ist abstract — davon kann kein Objekt erzeugt werden.");
        let map = null, retT = T(n.className);
        if(cls.typeParams){
          if(!n.targs || !n.targs.length) throw cerr(file, n.line, "'" + n.className + "' ist generisch — bitte mit Typ-Argumenten erzeugen: new " + n.className + "<…>(…). (Den Diamanten <> bitte ausschreiben.)");
          retT = T(n.className, 0, null, n.targs);
          validType(retT, file, n.line);
          map = tpMapOf(cls, retT);
        } else if(n.targs && n.targs.length){
          throw cerr(file, n.line, "'" + n.className + "' ist keine generische Klasse — Typ-Argumente hier entfernen.");
        }
        const k = cls.ctors.find(k2 => k2.params.length === n.args.length);
        if(!k) throw cerr(file, n.line, "Kein Konstruktor von '" + n.className + "' nimmt " + n.args.length + " Argument(e).");
        const argTs = n.args.map(a => checkExpr(a));
        for(let i = 0; i < k.params.length; i++){
          const want = map ? substT(k.params[i].type, map) : k.params[i].type;
          if(!assignable(want, argTs[i], n.args[i]))
            throw cerr(file, n.line, "Konstruktor von '" + n.className + "': Argument " + (i+1) + " hat Typ " + tName(argTs[i]) + ", erwartet wird " + tName(want) + ".");
        }
        return retT;
      }
      case "index": {
        const at = checkExpr(n.arr);
        if(!at.dims) throw cerr(file, n.line, tName(at) + " ist kein Array. (ArrayList nutzt .get(i))");
        const it = checkExpr(n.idx);
        if(!assignable(T_INT, it, n.idx)) throw cerr(file, n.line, "Der Array-Index muss ein int sein (ist: " + tName(it) + ").");
        return T(at.base, at.dims - 1, at.elem);
      }
      case "field": return checkFieldAccess(n);
      case "call": {
        // unqualifizierter Aufruf: Methode der eigenen Klasse(nkette)
        const entry = findMethodIn(ctx.cls.name, n.name, n.args.length);
        if(!entry){
          if(methodExistsAnyArity(ctx.cls.name, n.name))
            throw cerr(file, n.line, "'" + n.name + "' wird hier mit " + n.args.length + " Argument(en) aufgerufen — passende Version gibt es nicht.");
          throw cerr(file, n.line, "Unbekannte Methode '" + n.name + "'.");
        }
        if(!entry.method.static && ctx.static) throw cerr(file, n.line, "Die Instanz-Methode '" + n.name + "' kann nicht aus einer statischen Methode aufgerufen werden (kein Objekt!).");
        n.dispatch = entry.method.static ? "static" : "virtual";
        n.owner = entry.owner.name;
        return checkUserCall(entry, n.args, file, n.line);
      }
      case "mcall": return checkMCall(n);
      case "supercall": {
        if(ctx.static) throw cerr(file, n.line, "'super' gibt es in statischen Methoden nicht.");
        if(!ctx.cls.superName) throw cerr(file, n.line, "'" + ctx.cls.name + "' hat keine Oberklasse.");
        const entry = findMethodIn(ctx.cls.superName, n.name, n.args.length);
        if(!entry) throw cerr(file, n.line, "Die Oberklasse hat keine Methode '" + n.name + "' mit " + n.args.length + " Parameter(n).");
        if(entry.method.abstract) throw cerr(file, n.line, "super." + n.name + "(…) geht nicht — die Methode ist dort abstract.");
        n.owner = entry.owner.name;
        return checkUserCall(entry, n.args, file, n.line);
      }
    }
    throw cerr(file, n.line || 0, "Interner Fehler: unbekannter Ausdruck '" + n.kind + "'.");
  }

  function checkArrLit(lit, t, file){
    if(t.dims < 1) throw cerr(file, lit.line, "Zu viele geschachtelte { } für den Typ " + tName(t) + ".");
    const inner = T(t.base, t.dims - 1, t.elem);
    for(const it of lit.items){
      if(it.kind === "arrlit"){ checkArrLit(it, inner, file); }
      else {
        const et = checkExpr(it);
        if(!assignable(inner, et, it)) throw cerr(file, lit.line, "Array-Element hat Typ " + tName(et) + ", erwartet wird " + tName(inner) + ".");
      }
    }
    lit.jt = t;
  }

  function checkLValue(n, what){
    if(n.kind === "var"){
      const t = checkExpr(n);
      if(n.ref === "local"){
        const v = lookupVar(n.name);
        if(v.final && v.assigned) throw cerr(ctx.file, n.line, "'" + n.name + "' ist final und wurde schon zugewiesen.");
        v.assigned = true;
      } else if(n.ref === "class"){
        throw cerr(ctx.file, n.line, what + ": '" + n.name + "' ist ein Klassenname, keine Variable.");
      } else {
        const ff = findFieldIn(n.owner, n.name);
        if(ff && ff.field.final && !ctx.ctor) throw cerr(ctx.file, n.line, "Das Feld '" + n.name + "' ist final.");
      }
      return t;
    }
    if(n.kind === "field"){
      const t = checkExpr(n);
      if(n.fkind === "length") throw cerr(ctx.file, n.line, "'length' kann nicht zugewiesen werden.");
      if(n.fkind === "user" ){
        const ff = findFieldIn(n.ownerCls, n.name);
        if(ff && ff.field.final && !ctx.ctor) throw cerr(ctx.file, n.line, "Das Feld '" + n.name + "' ist final.");
      }
      if(n.fkind && n.fkind.startsWith("builtin")) throw cerr(ctx.file, n.line, what + ": dieses Feld kann nicht zugewiesen werden.");
      return t;
    }
    if(n.kind === "index"){ return checkExpr(n); }
    throw cerr(ctx.file, n.line, what + ": links steht kein zuweisbares Ziel (Variable, Feld oder Array-Element).");
  }

  function checkAssign(n){
    const file = ctx.file;
    const tt = checkLValue(n.target, "Zuweisung");
    if(n.op === "="){
      if(n.value.kind === "arrlit"){
        if(!tt.dims) throw cerr(file, n.line, "{…} passt nur zu einem Array-Typ.");
        checkArrLit(n.value, tt, file);
        return tt;
      }
      const vt = checkExpr(n.value);
      if(!assignable(tt, vt, n.value)) throw cerr(file, n.line, "Einer Variable vom Typ " + tName(tt) + " kann kein " + tName(vt) + " zugewiesen werden.");
      n.value.strHow = strHow(vt);
      return tt;
    }
    // += -= *= /= %=
    const vt = checkExpr(n.value);
    if(n.op === "+=" && tt.base === "String" && !tt.dims){
      n.concat = true;
      n.value.strHow = strHow(vt);
      return tt;
    }
    if(!numeric(tt)) throw cerr(file, n.line, "'" + n.op + "' braucht links eine Zahlen-Variable (ist: " + tName(tt) + ").");
    if(!numeric(vt)) throw cerr(file, n.line, "'" + n.op + "' braucht rechts eine Zahl (ist: " + tName(vt) + ").");
    if(tt.base === "int" && vt.base === "double") throw cerr(file, n.line, "double passt nicht ohne Cast in eine int-Variable.");
    return tt;
  }

  function checkBin(n){
    const file = ctx.file;
    const lt = checkExpr(n.l), rt = checkExpr(n.r);
    const op = n.op;
    if(op === "+" && ((lt.base === "String" && !lt.dims) || (rt.base === "String" && !rt.dims))){
      n.concat = true;
      n.l.strHow = strHow(lt); n.r.strHow = strHow(rt);
      return T_STR;
    }
    if(op === "+" || op === "-" || op === "*" || op === "/" || op === "%"){
      if(!numeric(lt) || !numeric(rt)) throw cerr(file, n.line, "'" + op + "' braucht Zahlen (" + tName(lt) + " " + op + " " + tName(rt) + ").");
      const d = lt.base === "double" || rt.base === "double";
      n.intDiv = (op === "/" && !d);
      n.intMod = (op === "%" && !d);
      return d ? T_DOUBLE : T_INT;
    }
    if(op === "<" || op === ">" || op === "<=" || op === ">="){
      if(!numeric(lt) || !numeric(rt)) throw cerr(file, n.line, "'" + op + "' vergleicht Zahlen (" + tName(lt) + " " + op + " " + tName(rt) + ").");
      return T_BOOL;
    }
    if(op === "==" || op === "!="){
      if(lt.base === "String" && rt.base === "String" && !lt.dims && !rt.dims)
        throw cerr(file, n.line, "Strings vergleicht man in Java mit .equals(…), nicht mit " + op + ".");
      if(numeric(lt) && numeric(rt)) return T_BOOL;
      if(lt.base === "boolean" && rt.base === "boolean") return T_BOOL;
      const refL = lt.dims > 0 || (!PRIMS.has(lt.base) && lt.base !== "void");
      const refR = rt.dims > 0 || (!PRIMS.has(rt.base) && rt.base !== "void");
      if(refL && refR && (assignable(lt, rt, n.r) || assignable(rt, lt, n.l) || lt.base === "null" || rt.base === "null")) return T_BOOL;
      throw cerr(file, n.line, tName(lt) + " und " + tName(rt) + " können nicht mit " + op + " verglichen werden.");
    }
    if(op === "&&" || op === "||"){
      if(!tEq(lt, T_BOOL) || !tEq(rt, T_BOOL)) throw cerr(file, n.line, "'" + op + "' braucht zwei boolean-Werte.");
      return T_BOOL;
    }
    throw cerr(file, n.line, "Der Operator '" + op + "' wird nicht unterstützt.");
  }

  function checkFieldAccess(n){
    const file = ctx.file;
    // System.out
    if(n.obj.kind === "var" && n.obj.name === "System" && !lookupVar("System")){
      if(n.name === "out"){ n.fkind = "sysout"; return T("§sysout"); }
      if(n.name === "in"){ throw cerr(file, n.line, "System.in wird nur in new Scanner(System.in) verwendet."); }
      throw cerr(file, n.line, "System." + n.name + " wird nicht unterstützt.");
    }
    // Math.PI / Integer.MAX_VALUE …
    if(n.obj.kind === "var" && !lookupVar(n.obj.name)){
      const cn = n.obj.name;
      if(cn === "Math" && n.name === "PI"){ n.fkind = "mathpi"; return T_DOUBLE; }
      if(cn === "Integer" && (n.name === "MAX_VALUE" || n.name === "MIN_VALUE")){ n.fkind = "intconst"; return T_INT; }
      if(classes.has(cn)){
        const ff = findFieldIn(cn, n.name);
        if(!ff) throw cerr(file, n.line, "Die Klasse '" + cn + "' hat kein Feld '" + n.name + "'.");
        if(!ff.field.static) throw cerr(file, n.line, "'" + n.name + "' ist kein statisches Feld — es gehört zu einem Objekt.");
        checkVisible(ff.field, ff.owner, file, n.line, "Das Feld");
        n.fkind = "user-static"; n.ownerCls = ff.owner.name;
        return ff.field.type;
      }
    }
    const ot = checkExpr(n.obj);
    if(ot.dims > 0){
      if(n.name === "length"){ n.fkind = "length"; return T_INT; }
      throw cerr(file, n.line, "Arrays haben nur '.length'.");
    }
    if(ot.base === "String"){
      if(n.name === "length") throw cerr(file, n.line, "Bei String heißt es length() MIT Klammern.");
      throw cerr(file, n.line, "String hat kein Feld '" + n.name + "'.");
    }
    if(isClassType(ot)){
      const ff = findFieldIn(ot.base, n.name);
      if(!ff) throw cerr(file, n.line, "Die Klasse '" + ot.base + "' hat kein Feld '" + n.name + "'.");
      checkVisible(ff.field, ff.owner, file, n.line, "Das Feld");
      n.fkind = "user"; n.ownerCls = ff.owner.name; n.isStatic = ff.field.static;
      const decl = classes.get(ot.base);
      if(decl.typeParams) return unboxDeep(substT(ff.field.type, tpMapOf(decl, ot)));
      return ff.field.type;
    }
    throw cerr(file, n.line, tName(ot) + " hat kein Feld '" + n.name + "'.");
  }

  function checkMCall(n){
    const file = ctx.file;
    // System.out.println / print
    if(n.obj.kind === "field"){
      const ft = checkExpr(n.obj);
      if(ft.base === "§sysout"){
        if(n.name !== "println" && n.name !== "print") throw cerr(file, n.line, "System.out kennt nur print und println.");
        if(n.args.length > 1) throw cerr(file, n.line, n.name + " erwartet höchstens ein Argument.");
        if(n.args.length === 1){
          const at = checkExpr(n.args[0]);
          if(tEq(at, T_VOID)) throw cerr(file, n.line, "Dieser Ausdruck hat keinen Wert (void) und kann nicht ausgegeben werden.");
          n.args[0].strHow = strHow(at);
        }
        n.mkind = "sysout";
        return T_VOID;
      }
      // sonst normal weiter unten (Feld liefert Objekt)
      return checkMCallOn(n, ft);
    }
    // Statische Aufrufe: Math.xxx, Integer.parseInt, Klasse.methode(...)
    if(n.obj.kind === "var" && !lookupVar(n.obj.name)){
      const cn = n.obj.name;
      if(cn === "Math"){ return checkMath(n); }
      if(cn === "Integer"){
        if(n.name === "parseInt"){ checkArgs(n.args, [[T_STR]], null, file, n.line, "Integer.parseInt"); n.mkind = "parseInt"; return T_INT; }
        if(n.name === "toString"){ checkArgs(n.args, [[T_INT]], null, file, n.line, "Integer.toString"); n.mkind = "intToString"; return T_STR; }
        throw cerr(file, n.line, "Integer." + n.name + " wird nicht unterstützt.");
      }
      if(cn === "Double"){
        if(n.name === "parseDouble"){ checkArgs(n.args, [[T_STR]], null, file, n.line, "Double.parseDouble"); n.mkind = "parseDouble"; return T_DOUBLE; }
        throw cerr(file, n.line, "Double." + n.name + " wird nicht unterstützt.");
      }
      if(cn === "Boolean"){
        if(n.name === "parseBoolean"){ checkArgs(n.args, [[T_STR]], null, file, n.line, "Boolean.parseBoolean"); n.mkind = "parseBoolean"; return T_BOOL; }
        if(n.name === "toString"){ checkArgs(n.args, [[T_BOOL]], null, file, n.line, "Boolean.toString"); n.mkind = "boolToString"; return T_STR; }
        throw cerr(file, n.line, "Boolean." + n.name + " wird nicht unterstützt (verfügbar: parseBoolean, toString).");
      }
      if(cn === "Character"){
        const M = { isDigit:T_BOOL, isLetter:T_BOOL, toUpperCase:T_CHAR, toLowerCase:T_CHAR };
        if(M[n.name]){ checkArgs(n.args, [[T_CHAR]], null, file, n.line, "Character." + n.name); n.mkind = "char-" + n.name; return M[n.name]; }
        throw cerr(file, n.line, "Character." + n.name + " wird nicht unterstützt.");
      }
      if(cn === "String"){
        if(n.name === "valueOf"){
          if(n.args.length !== 1) throw cerr(file, n.line, "String.valueOf erwartet genau ein Argument.");
          const at = checkExpr(n.args[0]);
          n.args[0].strHow = strHow(at);
          n.mkind = "valueOf";
          return T_STR;
        }
        throw cerr(file, n.line, "String." + n.name + " wird nicht unterstützt.");
      }
      if(classes.has(cn)){
        const entry = findMethodIn(cn, n.name, n.args.length);
        if(!entry) throw cerr(file, n.line, "Die Klasse '" + cn + "' hat keine Methode '" + n.name + "' mit " + n.args.length + " Parameter(n).");
        if(!entry.method.static) throw cerr(file, n.line, "'" + n.name + "' ist keine statische Methode — rufe sie auf einem Objekt auf.");
        n.mkind = "user-static"; n.ownerCls = entry.owner.name;
        return checkUserCall(entry, n.args, file, n.line);
      }
    }
    const ot = checkExpr(n.obj);
    return checkMCallOn(n, ot);
  }
  function checkMath(n){
    const file = ctx.file;
    const nm = n.name;
    const one = (ret) => { const a = checkExpr(n.args[0]); if(!numeric(a)) throw cerr(file, n.line, "Math." + nm + " braucht eine Zahl."); return ret || null; };
    if(n.args.length === 1 && (nm === "abs")){ const a = checkExpr(n.args[0]); if(!numeric(a)) throw cerr(file, n.line, "Math.abs braucht eine Zahl."); n.mkind = "math"; return a.base === "double" ? T_DOUBLE : T_INT; }
    if(n.args.length === 2 && (nm === "max" || nm === "min")){
      const a = checkExpr(n.args[0]), b = checkExpr(n.args[1]);
      if(!numeric(a) || !numeric(b)) throw cerr(file, n.line, "Math." + nm + " braucht zwei Zahlen.");
      n.mkind = "math";
      return (a.base === "double" || b.base === "double") ? T_DOUBLE : T_INT;
    }
    if(nm === "pow"){ checkArgs(n.args, [[T_DOUBLE,T_DOUBLE]], null, file, n.line, "Math.pow"); n.mkind = "math"; return T_DOUBLE; }
    if(nm === "sqrt" || nm === "floor" || nm === "ceil"){ if(n.args.length !== 1) throw cerr(file, n.line, "Math." + nm + " erwartet ein Argument."); one(); n.mkind = "math"; return T_DOUBLE; }
    if(nm === "round"){ if(n.args.length !== 1) throw cerr(file, n.line, "Math.round erwartet ein Argument."); one(); n.mkind = "math"; return T_INT; }
    if(nm === "random"){ if(n.args.length) throw cerr(file, n.line, "Math.random() erwartet keine Argumente."); n.mkind = "math"; return T_DOUBLE; }
    throw cerr(file, n.line, "Math." + nm + " wird nicht unterstützt.");
  }
  function checkMCallOn(n, ot){
    const file = ctx.file;
    if(ot.base === "String" && !ot.dims){
      const m = STR_METH[n.name];
      if(!m) throw cerr(file, n.line, "String hat keine Methode '" + n.name + "'. (Verfügbar u. a.: length, charAt, substring, equals, contains, indexOf, toUpperCase, toLowerCase, trim, replace, split)");
      checkArgs(n.args, m.a, null, file, n.line, "String." + n.name);
      n.mkind = "string";
      return m.r(null, n.args.length);
    }
    if(ot.base === "ArrayList" && !ot.dims){
      const m = LIST_METH[n.name];
      if(!m) throw cerr(file, n.line, "ArrayList hat keine Methode '" + n.name + "'. (Verfügbar: add, get, set, remove, size, isEmpty, contains, indexOf, clear)");
      const E = ot.elem ? (WRAPPER_ELEMS.has(ot.elem.base) ? unbox(ot.elem) : ot.elem) : T_STR;
      checkArgs(n.args, m.a, E, file, n.line, "ArrayList." + n.name);
      n.mkind = "list";
      n.elemHow = strHow(E);
      const r = m.r(E, n.args.length);
      return (r && WRAPPER_ELEMS.has(r.base)) ? unbox(r) : r;
    }
    if(ot.base === "Scanner" && !ot.dims){
      const m = SCAN_METH[n.name];
      if(!m) throw cerr(file, n.line, "Scanner hat keine Methode '" + n.name + "'. (Verfügbar: nextInt, nextDouble, nextLine, next, nextBoolean, close)");
      checkArgs(n.args, m.a, null, file, n.line, "Scanner." + n.name);
      n.mkind = "scanner";
      return m.r();
    }
    if(isClassType(ot)){
      if(n.name === "toString" && !n.args.length && !findMethodIn(ot.base, "toString", 0)){
        n.mkind = "toString-default";
        return T_STR;
      }
      if(n.name === "equals" && n.args.length === 1 && !findMethodIn(ot.base, "equals", 1)){
        const at = checkExpr(n.args[0]);
        if(!isClassType(at) && at.base !== "null") throw cerr(file, n.line, "equals erwartet ein Objekt.");
        n.mkind = "equals-default";
        return T_BOOL;
      }
      const entry = findMethodIn(ot.base, n.name, n.args.length);
      if(!entry){
        if(methodExistsAnyArity(ot.base, n.name))
          throw cerr(file, n.line, "'" + n.name + "' wird mit " + n.args.length + " Argument(en) aufgerufen — passende Version gibt es in '" + ot.base + "' nicht.");
        throw cerr(file, n.line, "Die Klasse '" + ot.base + "' hat keine Methode '" + n.name + "'.");
      }
      if(entry.method.static) throw cerr(file, n.line, "'" + n.name + "' ist static — Aufruf über den Klassennamen: " + ot.base + "." + n.name + "(…).");
      n.mkind = "user"; n.ownerCls = entry.owner.name;
      const gdecl = classes.get(ot.base);
      return checkUserCall(entry, n.args, file, n.line, gdecl.typeParams ? tpMapOf(gdecl, ot) : null);
    }
    if(ot.base === "null") throw cerr(file, n.line, "Auf 'null' kann keine Methode aufgerufen werden.");
    throw cerr(file, n.line, tName(ot) + " hat keine Methoden" + (ot.dims ? " (Arrays haben nur .length)" : "") + ".");
  }

  /* ------- Statements ------- */
  function checkStmt(s){
    const file = ctx.file;
    switch(s.kind){
      case "block": pushEnv(); for(const x of s.body) checkStmt(x); popEnv(); return;
      case "empty": return;
      case "vardecl":
        for(const d of s.decls){
          validType(d.type, file, s.line);
          if(d.init){
            if(d.init.kind === "arrlit"){
              if(!d.type.dims) throw cerr(file, s.line, "{…} passt nur zu einem Array-Typ.");
              checkArrLit(d.init, d.type, file);
            } else {
              const it = checkExpr(d.init);
              if(!assignable(d.type, it, d.init)) throw cerr(file, s.line, "Einer Variable vom Typ " + tName(d.type) + " kann kein " + tName(it) + " zugewiesen werden.");
            }
          }
          declare(d.name, d.type, s.final, file, s.line);
          if(d.init) lookupVar(d.name).assigned = true;
        }
        return;
      case "expr": {
        const e = s.expr;
        const ok = ["assign","mcall","call","new","predec","postdec","supercall"].includes(e.kind);
        if(!ok) throw cerr(file, s.line, "Dieser Ausdruck bewirkt nichts. (Meintest du eine Zuweisung oder einen Methodenaufruf?)");
        checkExpr(e);
        return;
      }
      case "if": {
        const ct = checkExpr(s.cond);
        if(!tEq(ct, T_BOOL)) throw cerr(file, s.line, "Die if-Bedingung muss boolean sein (ist: " + tName(ct) + "). In Java gibt es kein if(zahl).");
        checkStmt(s.then);
        if(s.els) checkStmt(s.els);
        return;
      }
      case "while": case "dowhile": {
        const ct = checkExpr(s.cond);
        if(!tEq(ct, T_BOOL)) throw cerr(file, s.line, "Die Schleifen-Bedingung muss boolean sein (ist: " + tName(ct) + ").");
        ctx.inLoop++; checkStmt(s.body); ctx.inLoop--;
        return;
      }
      case "for": {
        pushEnv();
        if(s.init) checkStmt(s.init.kind === "vardecl" ? s.init : s.init);
        if(s.cond){
          const ct = checkExpr(s.cond);
          if(!tEq(ct, T_BOOL)) throw cerr(file, s.line, "Die for-Bedingung muss boolean sein (ist: " + tName(ct) + ").");
        }
        if(s.step) checkStmt(s.step);
        ctx.inLoop++; checkStmt(s.body); ctx.inLoop--;
        popEnv();
        return;
      }
      case "foreach": {
        validType(s.varType, file, s.line);
        const it = checkExpr(s.iter);
        let elemT = null;
        if(it.dims > 0) elemT = T(it.base, it.dims - 1, it.elem);
        else if(it.base === "ArrayList") elemT = WRAPPER_ELEMS.has(it.elem.base) ? unbox(it.elem) : it.elem;
        else throw cerr(file, s.line, "for-each läuft über Arrays oder ArrayList (ist: " + tName(it) + ").");
        if(!assignable(s.varType, elemT)) throw cerr(file, s.line, "Die for-each-Variable (" + tName(s.varType) + ") passt nicht zu den Elementen (" + tName(elemT) + ").");
        pushEnv();
        declare(s.varName, s.varType, false, file, s.line);
        lookupVar(s.varName).assigned = true;
        ctx.inLoop++; checkStmt(s.body); ctx.inLoop--;
        popEnv();
        s.iterKind = it.dims > 0 ? "arr" : "list";
        return;
      }
      case "switch": {
        const st = checkExpr(s.subject);
        const okT = (!st.dims) && (st.base === "int" || st.base === "char" || st.base === "String");
        if(!okT) throw cerr(file, s.line, "switch funktioniert mit int, char oder String (ist: " + tName(st) + ").");
        const seen = new Set();
        for(const c of s.cases){
          const v = c.value;
          const constOk = v.kind === "int" || v.kind === "charlit" || v.kind === "str" || (v.kind === "neg" && v.expr.kind === "int");
          if(!constOk) throw cerr(file, v.line, "case braucht eine Konstante (Zahl, 'zeichen' oder \"text\").");
          const vt = checkExpr(v);
          if(!assignable(st, vt, v) && !assignable(vt, st)) throw cerr(file, v.line, "Der case-Wert (" + tName(vt) + ") passt nicht zum switch-Typ (" + tName(st) + ").");
          const key = v.kind === "neg" ? String(-v.expr.v) : String(v.v);
          if(seen.has(key)) throw cerr(file, v.line, "Der case-Wert " + key + " kommt doppelt vor.");
          seen.add(key);
          ctx.inSwitch++;
          for(const x of c.stmts) checkStmt(x);
          ctx.inSwitch--;
        }
        if(s.def){ ctx.inSwitch++; for(const x of s.def) checkStmt(x); ctx.inSwitch--; }
        return;
      }
      case "return": {
        const want = ctx.ctor ? T_VOID : ctx.method.ret;
        if(tEq(want, T_VOID)){
          if(s.val) throw cerr(file, s.line, (ctx.ctor ? "Ein Konstruktor" : "Eine void-Methode") + " gibt keinen Wert zurück.");
          return;
        }
        if(!s.val) throw cerr(file, s.line, "Diese Methode muss einen " + tName(want) + "-Wert zurückgeben.");
        const vt = checkExpr(s.val);
        if(!assignable(want, vt, s.val)) throw cerr(file, s.line, "return liefert " + tName(vt) + ", die Methode verspricht aber " + tName(want) + ".");
        return;
      }
      case "break":
        if(!ctx.inLoop && !ctx.inSwitch) throw cerr(file, s.line, "'break' geht nur in einer Schleife oder einem switch.");
        return;
      case "continue":
        if(!ctx.inLoop) throw cerr(file, s.line, "'continue' geht nur in einer Schleife.");
        return;
      case "superctor":
        throw cerr(file, s.line, "super(…) darf nur die ERSTE Anweisung eines Konstruktors sein.");
    }
    throw cerr(file, s.line || 0, "Interner Fehler: unbekannte Anweisung '" + s.kind + "'.");
  }

  /* Rückgabe-Pfad-Analyse (einfach, Java-orientiert) */
  function hasLoopBreak(s){          // break, das DIESE Schleife trifft (nicht in innere Schleifen/switch absteigen)
    if(!s) return false;
    switch(s.kind){
      case "break": return true;
      case "block": return s.body.some(hasLoopBreak);
      case "if": return hasLoopBreak(s.then) || hasLoopBreak(s.els);
      default: return false;
    }
  }
  function alwaysReturns(s){
    if(!s) return false;
    switch(s.kind){
      case "return": return true;
      case "block": return s.body.some(alwaysReturns);
      case "if": return !!(s.els && alwaysReturns(s.then) && alwaysReturns(s.els));
      case "while": return !!(s.cond && s.cond.kind === "bool" && s.cond.v === true && !hasLoopBreak(s.body));
      case "dowhile": return alwaysReturns(s.body) || (s.cond.kind === "bool" && s.cond.v === true && !hasLoopBreak(s.body));
      case "for": return !s.cond && !hasLoopBreak(s.body);
      default: return false;
    }
  }

  /* ------- Alle Rümpfe prüfen ------- */
  for(const c of classes.values()){
    CUR_TP = c.typeParams ? new Set(c.typeParams) : null;
    // statische + Instanz-Feld-Initialisierer
    for(const f of c.fields){
      if(f.init){
        CUR_TP = (!f.static && c.typeParams) ? new Set(c.typeParams) : null;   // T gibt es in static-Kontexten nicht
        ctx = { cls: c, method: null, ctor: false, static: f.static, inLoop: 0, inSwitch: 0, file: c.file };
        env = null; pushEnv();
        if(f.init.kind === "arrlit"){
          if(!f.type.dims) throw cerr(c.file, f.line, "{…} passt nur zu einem Array-Typ.");
          checkArrLit(f.init, f.type, c.file);
        } else {
          const it = checkExpr(f.init);
          if(!assignable(f.type, it, f.init)) throw cerr(c.file, f.line, "Das Feld '" + f.name + "' (" + tName(f.type) + ") kann nicht mit " + tName(it) + " initialisiert werden.");
        }
        popEnv();
      }
    }
    for(const m of c.methods){
      if(m.abstract) continue;
      CUR_TP = (!m.static && c.typeParams) ? new Set(c.typeParams) : null;     // T gibt es in static-Methoden nicht
      ctx = { cls: c, method: m, ctor: false, static: m.static, inLoop: 0, inSwitch: 0, file: m.file };
      env = null; pushEnv();
      for(const pa of m.params) declare(pa.name, pa.type, false, m.file, m.line), lookupVar(pa.name).assigned = true;
      checkStmt(m.body);
      if(!tEq(m.ret, T_VOID) && !alwaysReturns(m.body))
        throw cerr(m.file, m.line, "Die Methode '" + m.name + "' muss auf JEDEM Weg einen " + tName(m.ret) + "-Wert zurückgeben (fehlt am Ende ein return?).");
      popEnv();
    }
    for(const k of c.ctors){
      CUR_TP = c.typeParams ? new Set(c.typeParams) : null;                    // Konstruktor = Instanz-Kontext
      ctx = { cls: c, method: null, ctor: true, static: false, inLoop: 0, inSwitch: 0, file: k.file };
      env = null; pushEnv();
      for(const pa of k.params) declare(pa.name, pa.type, false, k.file, k.line), lookupVar(pa.name).assigned = true;
      // super(...)-Regel
      const body = k.body.body;
      let start = 0;
      if(body.length && body[0].kind === "superctor"){
        if(!c.superName) throw cerr(k.file, body[0].line, "'" + c.name + "' hat keine Oberklasse — super(…) ist hier falsch.");
        const supCls = classes.get(c.superName);
        const sk = supCls.ctors.find(x => x.params.length === body[0].args.length);
        if(!sk) throw cerr(k.file, body[0].line, "Kein Konstruktor von '" + c.superName + "' nimmt " + body[0].args.length + " Argument(e).");
        const argTs = body[0].args.map(a => checkExpr(a));
        for(let i = 0; i < sk.params.length; i++){
          if(!assignable(sk.params[i].type, argTs[i], body[0].args[i]))
            throw cerr(k.file, body[0].line, "super(…): Argument " + (i+1) + " hat Typ " + tName(argTs[i]) + ", erwartet wird " + tName(sk.params[i].type) + ".");
        }
        body[0].superArity = body[0].args.length;
        start = 1;
      } else if(c.superName){
        const supCls = classes.get(c.superName);
        if(!supCls.ctors.some(x => x.params.length === 0))
          throw cerr(k.file, k.line, "Die Oberklasse '" + c.superName + "' hat keinen Konstruktor ohne Parameter — rufe als erste Anweisung super(…) auf.");
        k.implicitSuper = true;
      }
      for(let i = start; i < body.length; i++) checkStmt(body[i]);
      popEnv();
    }
  }

  /* ------- main finden ------- */
  const mains = [];
  for(const c of classes.values()){
    for(const m of c.methods){
      if(m.name === "main" && m.static){
        const ok = tEq(m.ret, T_VOID) && m.params.length === 1 &&
                   m.params[0].type.base === "String" && m.params[0].type.dims === 1;
        if(!ok) throw cerr(m.file, m.line, "main muss exakt so aussehen: public static void main(String[] args)");
        mains.push({ cls: c, m });
      }
    }
  }
  if(!mains.length) throw cerr(units[0] ? units[0].file : "?", 1, "Keine main-Methode gefunden. Eine Klasse braucht: public static void main(String[] args)");
  if(mains.length > 1){
    const pref = mains.find(x => x.cls.name === "Main") || null;
    if(!pref) throw cerr(mains[1].m.file, mains[1].m.line, "Mehrere main-Methoden gefunden (" + mains.map(x => x.cls.name).join(", ") + ") — nur eine ist erlaubt (oder nenne die Startklasse 'Main').");
    mains.length = 0; mains.push(pref);
  }

  return { classes, mainClass: mains[0].cls.name, isSubclass, chainOf, findFieldIn, findMethodIn };
}

/* ----------------------------------------------------------- Interpreter -- */
class Signal { constructor(kind, v){ this.kind = kind; this.v = v; } }   // break/continue/return
const SIG_BREAK = new Signal("break"), SIG_CONT = new Signal("continue");

let OBJ_ID = 1;
function newObj(cls){ return { __cls: cls, __id: OBJ_ID++, __f: {} }; }
function hexId(o){ return (o.__id * 2654435761 % 0xFFFFFF).toString(16); }

function i32(v){ return v | 0; }
function jAdd(a, b){ return (a + b) | 0; }
function jSub(a, b){ return (a - b) | 0; }
function jMul(a, b){ return Math.imul(a, b); }

function dstr(v){                                  // Java-Ausgabe für double
  if(Number.isNaN(v)) return "NaN";
  if(v === Infinity) return "Infinity";
  if(v === -Infinity) return "-Infinity";
  if(Number.isInteger(v) && Math.abs(v) < 1e15) return (Object.is(v, -0) ? "-0" : String(v)) + ".0";
  return String(v);
}

function defaultVal(t){
  if(t.dims > 0) return null;
  switch(t.base){
    case "int": case "char": return 0;
    case "double": return 0.0;
    case "boolean": return false;
    default: return null;
  }
}

function Interp(chk, io, opts){
  opts = opts || {};
  const S = {
    chk, io,
    statics: new Map(),           // Klassenname -> {feld:wert}
    steps: 0,
    maxSteps: opts.maxSteps || 20000000,
    depth: 0,
    maxDepth: opts.maxDepth || 3500,
    curFile: "?", curLine: 0,
    pend: "",                     // Scanner-Puffer (Zeilen mit \n)
    stopFlag: opts.stopFlag || { stopped: false },
    yieldEvery: opts.yieldEvery || 60000,
    sinceYield: 0,
  };
  const classes = chk.classes;

  function guard(line){
    if(line) S.curLine = line;
    if(S.stopFlag.stopped) throw rerrObj("Gestoppt", "Programm wurde gestoppt.", S.curFile, S.curLine);
    if(++S.steps > S.maxSteps) throw rerrObj("Zu viele Schritte", "Das Programm läuft zu lange (Endlosschleife?).", S.curFile, S.curLine);
  }
  async function maybeYield(){
    if(++S.sinceYield >= S.yieldEvery){
      S.sinceYield = 0;
      await new Promise(r => setTimeout(r, 0));
      if(S.stopFlag.stopped) throw rerrObj("Gestoppt", "Programm wurde gestoppt.", S.curFile, S.curLine);
    }
  }
  const rerr = (name, msg) => rerrObj(name, msg, S.curFile, S.curLine);

  /* ---------- Stringifizierung ---------- */
  async function toStr(v, how){
    switch(how){
      case "int": return String(v);
      case "double": return dstr(v);
      case "char": return String.fromCharCode(v);
      case "bool": return v ? "true" : "false";
      case "str": return v === null ? "null" : v;
      case "arr": return v === null ? "null" : "[A@" + (v.__aid || (v.__aid = (OBJ_ID++).toString(16))) + "]";
      case "obj":
        if(v === null) return "null";
        if(typeof v !== "object") return typeof v === "boolean" ? (v ? "true" : "false") : String(v);   // Erasure: T kann Wrapper-Inhalt tragen
        return objToString(v);
      default: return String(v);
    }
  }
  async function objToString(v){
    if(v.__list){                                       // ArrayList
      const parts = [];
      for(const x of v.__list) parts.push(await toStr(x, v.__how || "obj"));
      return "[" + parts.join(", ") + "]";
    }
    if(v.__scanner) return "java.util.Scanner";
    const entry = chk.findMethodIn(v.__cls, "toString", 0);
    if(entry && !entry.method.abstract){
      const r = await invoke(v, entry.method, []);
      return r === null ? "null" : String(r);
    }
    return v.__cls + "@" + hexId(v);
  }

  /* ---------- Scanner ---------- */
  async function fillInput(){
    const line = await S.io.input();
    if(S.stopFlag.stopped)                       // ⏹ Stopp während wartender Eingabe -> sauberer Stopp-Pfad
      throw rerr("Gestoppt", "Programm wurde gestoppt.");
    if(line === null || line === undefined)
      throw rerr("NoSuchElementException", "Der Scanner wollte lesen, aber es gibt keine (weitere) Eingabe.");
    S.pend += String(line) + "\n";
  }
  async function scanToken(){
    for(;;){
      let i = 0;
      while(i < S.pend.length && /\s/.test(S.pend[i])) i++;
      if(i < S.pend.length){
        let j = i;
        while(j < S.pend.length && !/\s/.test(S.pend[j])) j++;
        const tok = S.pend.slice(i, j);
        S.pend = S.pend.slice(j);
        return tok;
      }
      S.pend = "";
      await fillInput();
    }
  }
  async function scanLine(){
    for(;;){
      const nl = S.pend.indexOf("\n");
      if(nl >= 0){
        const line = S.pend.slice(0, nl);
        S.pend = S.pend.slice(nl + 1);
        return line;
      }
      await fillInput();
    }
  }

  /* ---------- Statics initialisieren ---------- */
  async function initStatics(){
    for(const c of classes.values()){
      const st = {};
      for(const f of c.fields) if(f.static) st[f.name] = defaultVal(f.type);
      S.statics.set(c.name, st);
    }
    for(const c of classes.values()){
      for(const f of c.fields){
        if(f.static && f.init){
          const fr = { vars: new Map(), self: null, cls: c.name };
          S.curFile = c.file;
          S.statics.get(c.name)[f.name] = await evalInit(f.init, f.type, fr);
        }
      }
    }
  }
  async function evalInit(init, type, fr){
    if(init.kind === "arrlit") return buildArrLit(init, type, fr);
    return coerce(await evalE(init, fr), init.jt, type);
  }
  async function buildArrLit(lit, type, fr){
    const inner = T(type.base, type.dims - 1, type.elem);
    const out = [];
    for(const it of lit.items){
      if(it.kind === "arrlit") out.push(await buildArrLit(it, inner, fr));
      else out.push(coerce(await evalE(it, fr), it.jt, inner));
    }
    return out;
  }
  function coerce(v, from, to){                       // implizites Widening / char-Ziel
    if(!from || !to) return v;
    if(to.base === "double" && !to.dims && from && (from.base === "int" || from.base === "char")) return v + 0.0;
    if(to.base === "char" && !to.dims && from && from.base === "int") return v & 0xFFFF;
    if(to.base === "int" && !to.dims && from && from.base === "char") return v;
    return v;
  }

  /* ---------- Objekterzeugung ---------- */
  async function construct(clsName, arity, argVals){
    const obj = newObj(clsName);
    for(const c of chk.chainOf(clsName)){             // alle Felder mit Defaults
      for(const f of c.fields) if(!f.static) obj.__f[f.name] = defaultVal(f.type);
    }
    await runCtor(obj, clsName, arity, argVals);
    return obj;
  }
  async function runCtor(obj, clsName, arity, argVals){
    guard();
    if(++S.depth > S.maxDepth){
      S.depth--;
      throw rerr("StackOverflowError", "Zu tiefe Verschachtelung von Konstruktor-Aufrufen (erzeugt ein Konstruktor endlos neue Objekte?).");
    }
    await null;   // Entkopplungspunkt: verhindert nativen JS-Stapelüberlauf bei Ctor-/Feldinit-Rekursion
    try{ await runCtorInner(obj, clsName, arity, argVals); } finally { S.depth--; }
  }
  async function runCtorInner(obj, clsName, arity, argVals){
    const c = classes.get(clsName);
    const k = c.ctors.find(x => x.params.length === arity);
    const fr = { vars: new Map(), self: obj, cls: clsName };
    for(let i = 0; i < k.params.length; i++) fr.vars.set(k.params[i].name, coerce(argVals[i], null, k.params[i].type));
    const body = k.body.body;
    let start = 0;
    S.curFile = c.file;
    if(body.length && body[0].kind === "superctor"){
      const sArgs = [];
      for(const a of body[0].args) sArgs.push(await evalE(a, fr));
      await runCtor(obj, c.superName, body[0].superArity, sArgs);
      start = 1;
    } else if(c.superName){
      await runCtor(obj, c.superName, 0, []);
    }
    for(const f of c.fields){                          // Feld-Initialisierer DIESER Klasse
      if(!f.static && f.init){
        S.curFile = c.file;
        obj.__f[f.name] = await evalInit(f.init, f.type, { vars: new Map(), self: obj, cls: clsName });
      }
    }
    S.curFile = c.file;
    try{
      for(let i = start; i < body.length; i++) await exec(body[i], fr);
    } catch(sig){
      if(sig instanceof Signal && sig.kind === "return") return;
      throw sig;
    }
  }

  /* ---------- Methodenaufruf ---------- */
  async function invoke(self, method, argVals){
    guard();
    if(++S.depth > S.maxDepth){
      S.depth--;
      throw rerr("StackOverflowError", "Zu tiefe Verschachtelung von Methodenaufrufen (endlose Rekursion?).");
    }
    const fr = { vars: new Map(), self: method.static ? null : self, cls: method.static ? method.__owner : (self ? self.__cls : method.__owner) };
    for(let i = 0; i < method.params.length; i++) fr.vars.set(method.params[i].name, coerce(argVals[i], null, method.params[i].type));
    const pf = S.curFile, pl = S.curLine;
    S.curFile = method.file;
    try{
      await exec(method.body, fr);
      return defaultVal(method.ret);
    } catch(sig){
      if(sig instanceof Signal && sig.kind === "return") return sig.v;
      throw sig;
    } finally {
      S.depth--;
      S.curFile = pf; S.curLine = pl;
    }
  }
  function dispatch(runtimeCls, name, argc){
    const entry = chk.findMethodIn(runtimeCls, name, argc);
    if(!entry) throw rerr("Interner Fehler", "Methode " + name + " nicht gefunden.");
    entry.method.__owner = entry.owner.name;
    return entry.method;
  }

  /* ---------- Statements ---------- */
  async function exec(s, fr){
    guard(s.line);
    await maybeYield();
    switch(s.kind){
      case "block": for(const x of s.body) await exec(x, fr); return;
      case "empty": return;
      case "vardecl":
        for(const d of s.decls){
          let v;
          if(d.init) v = await evalInit(d.init, d.type, fr);
          else v = defaultVal(d.type);
          fr.vars.set(d.name, v);
        }
        return;
      case "expr": await evalE(s.expr, fr); return;
      case "if":
        if(await evalE(s.cond, fr)) await exec(s.then, fr);
        else if(s.els) await exec(s.els, fr);
        return;
      case "while":
        while(await evalE(s.cond, fr)){
          guard(s.line);
          try{ await exec(s.body, fr); }
          catch(sig){
            if(sig === SIG_BREAK) return;
            if(sig === SIG_CONT) continue;
            throw sig;
          }
        }
        return;
      case "dowhile":
        do{
          guard(s.line);
          try{ await exec(s.body, fr); }
          catch(sig){
            if(sig === SIG_BREAK) return;
            if(sig === SIG_CONT) continue;
            throw sig;
          }
        } while(await evalE(s.cond, fr));
        return;
      case "for": {
        if(s.init) await exec(s.init, fr);
        for(;;){
          guard(s.line);
          if(s.cond && !(await evalE(s.cond, fr))) break;
          try{ await exec(s.body, fr); }
          catch(sig){
            if(sig === SIG_BREAK) break;
            if(sig !== SIG_CONT) throw sig;
          }
          if(s.step) await exec(s.step, fr);
        }
        return;
      }
      case "foreach": {
        const it = await evalE(s.iter, fr);
        if(it === null) throw rerr("NullPointerException", "for-each über null.");
        const arr = s.iterKind === "list" ? it.__list.slice() : it;
        for(const el of arr){
          guard(s.line);
          fr.vars.set(s.varName, coerce(el, null, s.varType));
          try{ await exec(s.body, fr); }
          catch(sig){
            if(sig === SIG_BREAK) return;
            if(sig !== SIG_CONT) throw sig;
          }
        }
        return;
      }
      case "switch": {
        const v = await evalE(s.subject, fr);
        let idx = -1;
        for(let i = 0; i < s.cases.length; i++){
          const cv = await evalE(s.cases[i].value, fr);
          if(cv === v || (typeof v === "string" && cv === v)){ idx = i; break; }
        }
        try{
          if(idx >= 0){
            for(let i = idx; i < s.cases.length; i++)     // Fallthrough wie in Java
              for(const x of s.cases[i].stmts) await exec(x, fr);
            if(s.def) for(const x of s.def) await exec(x, fr);
          } else if(s.def){
            for(const x of s.def) await exec(x, fr);
          }
        } catch(sig){
          if(sig === SIG_BREAK) return;
          throw sig;
        }
        return;
      }
      case "return":
        throw new Signal("return", s.val ? await evalE(s.val, fr) : null);
      case "break": throw SIG_BREAK;
      case "continue": throw SIG_CONT;
    }
    throw rerr("Interner Fehler", "Unbekannte Anweisung: " + s.kind);
  }

  /* ---------- L-Values ---------- */
  async function lref(n, fr){
    if(n.kind === "var"){
      if(n.ref === "local") return { get: () => fr.vars.get(n.name), set: v => fr.vars.set(n.name, v) };
      if(n.ref === "ifield"){
        if(!fr.self) throw rerr("NullPointerException", "Kein Objekt-Kontext für Feld '" + n.name + "'.");
        return { get: () => fr.self.__f[n.name], set: v => { fr.self.__f[n.name] = v; } };
      }
      if(n.ref === "sfield"){
        const st = S.statics.get(n.owner);
        return { get: () => st[n.name], set: v => { st[n.name] = v; } };
      }
    }
    if(n.kind === "field"){
      if(n.fkind === "user"){
        if(n.isStatic){
          const st = S.statics.get(n.ownerCls);
          return { get: () => st[n.name], set: v => { st[n.name] = v; } };
        }
        const o = await evalE(n.obj, fr);
        if(o === null) throw rerr("NullPointerException", "Zugriff auf Feld '" + n.name + "' von null.");
        return { get: () => o.__f[n.name], set: v => { o.__f[n.name] = v; } };
      }
      if(n.fkind === "user-static"){
        const st = S.statics.get(n.ownerCls);
        return { get: () => st[n.name], set: v => { st[n.name] = v; } };
      }
    }
    if(n.kind === "index"){
      const a = await evalE(n.arr, fr);
      if(a === null) throw rerr("NullPointerException", "Array ist null.");
      const i = await evalE(n.idx, fr);
      if(i < 0 || i >= a.length) throw rerr("ArrayIndexOutOfBoundsException", "Index " + i + " liegt außerhalb (Länge " + a.length + ").");
      return { get: () => a[i], set: v => { a[i] = v; } };
    }
    throw rerr("Interner Fehler", "Kein zuweisbares Ziel.");
  }

  /* ---------- Ausdrücke ---------- */
  async function evalE(n, fr){
    guard(n.line);
    switch(n.kind){
      case "int": case "double": return n.v;
      case "charlit": return n.v;
      case "str": return n.v;
      case "bool": return n.v;
      case "null": return null;
      case "this": return fr.self;
      case "var": {
        if(n.ref === "local") return fr.vars.get(n.name);
        if(n.ref === "ifield") return fr.self.__f[n.name];
        if(n.ref === "sfield") return S.statics.get(n.owner)[n.name];
        return null;                                   // Klassenreferenz (nur als Präfix)
      }
      case "assign": {
        const ref = await lref(n.target, fr);
        if(n.op === "="){
          let v;
          if(n.value.kind === "arrlit") v = await buildArrLit(n.value, n.value.jt, fr);
          else v = coerce(await evalE(n.value, fr), n.value.jt, n.target.jt);
          ref.set(v);
          return v;
        }
        const old = ref.get();
        if(n.concat){                                  // String +=
          const add = await toStr(await evalE(n.value, fr), n.value.strHow);
          const nv = (old === null ? "null" : old) + add;
          ref.set(nv);
          return nv;
        }
        const rhs = await evalE(n.value, fr);
        const tb = n.target.jt.base;
        let nv;
        const isI = tb === "int" || tb === "char";
        switch(n.op){
          case "+=": nv = isI ? jAdd(old, rhs) : old + rhs; break;
          case "-=": nv = isI ? jSub(old, rhs) : old - rhs; break;
          case "*=": nv = isI ? jMul(old, rhs) : old * rhs; break;
          case "/=":
            if(isI){ if(rhs === 0) throw rerr("ArithmeticException", "Division durch 0."); nv = i32(Math.trunc(old / rhs)); }
            else nv = old / rhs;
            break;
          case "%=":
            if(isI){ if(rhs === 0) throw rerr("ArithmeticException", "Division durch 0 (Modulo)."); nv = i32(old % rhs); }
            else nv = old % rhs;
            break;
        }
        if(tb === "char") nv = nv & 0xFFFF;
        ref.set(nv);
        return nv;
      }
      case "ternary": return (await evalE(n.cond, fr)) ? await evalE(n.then, fr) : await evalE(n.els, fr);
      case "bin": {
        if(n.op === "&&"){ return (await evalE(n.l, fr)) ? await evalE(n.r, fr) : false; }
        if(n.op === "||"){ return (await evalE(n.l, fr)) ? true : await evalE(n.r, fr); }
        const a = await evalE(n.l, fr);
        if(n.concat){
          const b = await evalE(n.r, fr);
          return (await toStr(a, n.l.strHow)) + (await toStr(b, n.r.strHow));
        }
        const b = await evalE(n.r, fr);
        const lt = n.l.jt, rt = n.r.jt;
        const anyD = (lt && lt.base === "double") || (rt && rt.base === "double");
        switch(n.op){
          case "+": return anyD ? a + b : jAdd(a, b);
          case "-": return anyD ? a - b : jSub(a, b);
          case "*": return anyD ? a * b : jMul(a, b);
          case "/":
            if(n.intDiv){ if(b === 0) throw rerr("ArithmeticException", "Division durch 0."); return i32(Math.trunc(a / b)); }
            return a / b;
          case "%":
            if(n.intMod){ if(b === 0) throw rerr("ArithmeticException", "Division durch 0 (Modulo)."); return i32(a % b); }
            return a % b;
          case "<": return a < b; case ">": return a > b;
          case "<=": return a <= b; case ">=": return a >= b;
          case "==": return a === b;
          case "!=": return a !== b;
        }
        throw rerr("Interner Fehler", "Operator " + n.op);
      }
      case "not": return !(await evalE(n.expr, fr));
      case "neg": {
        const v = await evalE(n.expr, fr);
        return n.expr.jt && n.expr.jt.base === "double" ? -v : i32(-v);
      }
      case "predec": case "postdec": {
        const ref = await lref(n.target, fr);
        const old = ref.get();
        const tb = n.target.jt.base;
        let nv = n.op === "++" ? (tb === "double" ? old + 1 : jAdd(old, 1)) : (tb === "double" ? old - 1 : jSub(old, 1));
        if(tb === "char") nv = nv & 0xFFFF;
        ref.set(nv);
        return n.kind === "predec" ? nv : old;
      }
      case "cast": {
        const v = await evalE(n.expr, fr);
        const to = n.type;
        if(!to.dims && PRIMS.has(to.base)){
          if(to.base === "int") return i32(Math.trunc(v));
          if(to.base === "char") return i32(Math.trunc(v)) & 0xFFFF;
          if(to.base === "double") return v + 0.0;
          return v;
        }
        if(v === null) return null;
        if(v.__cls && !chk.isSubclass(v.__cls, to.base))
          throw rerr("ClassCastException", "Ein " + v.__cls + "-Objekt ist kein " + to.base + ".");
        return v;
      }
      case "instanceof": {
        const v = await evalE(n.expr, fr);
        if(v === null) return false;
        return !!(v.__cls && chk.isSubclass(v.__cls, n.type.base));
      }
      case "newarr": {
        if(n.lit) return buildArrLit(n.lit, T(n.base, n.dims), fr);
        const sizes = [];
        for(const s2 of n.sizes) sizes.push(await evalE(s2, fr));
        for(const sz of sizes) if(sz < 0) throw rerr("NegativeArraySizeException", "Negative Array-Größe: " + sz);
        let total = 1; for(const sz of sizes) total *= Math.max(1, sz);
        if(total > 10000000) throw rerr("OutOfMemoryError", "Das Array ist zu groß (" + sizes.join("×") + ").");
        const elemT = T(n.base, 0);
        const mk = (d) => {
          if(d >= sizes.length) return null;
          const len = sizes[d];
          const arr = new Array(len);
          for(let i = 0; i < len; i++)
            arr[i] = (d === n.dims - 1) ? defaultVal(elemT) : (d + 1 < sizes.length ? mk(d + 1) : null);
          return arr;
        };
        return mk(0);
      }
      case "new": {
        if(n.builtin === "scanner") return { __scanner: true, __id: OBJ_ID++ };
        if(n.builtin === "arraylist") return { __list: [], __how: strHowRuntime(n.jt), __id: OBJ_ID++ };
        const args = [];
        for(const a of n.args) args.push(await evalE(a, fr));
        return construct(n.className, n.args.length, args);
      }
      case "index": {
        const a = await evalE(n.arr, fr);
        if(a === null) throw rerr("NullPointerException", "Array ist null.");
        const i = await evalE(n.idx, fr);
        if(i < 0 || i >= a.length) throw rerr("ArrayIndexOutOfBoundsException", "Index " + i + " liegt außerhalb (Länge " + a.length + ").");
        return a[i];
      }
      case "field": {
        if(n.fkind === "sysout") return "§sysout";
        if(n.fkind === "mathpi") return Math.PI;
        if(n.fkind === "intconst") return n.name === "MAX_VALUE" ? 2147483647 : -2147483648;
        if(n.fkind === "user-static") return S.statics.get(n.ownerCls)[n.name];
        if(n.fkind === "length"){
          const a = await evalE(n.obj, fr);
          if(a === null) throw rerr("NullPointerException", "Array ist null (.length).");
          return a.length;
        }
        // user (Instanz oder static über Objekt)
        const o = await evalE(n.obj, fr);
        if(n.isStatic) return S.statics.get(n.ownerCls)[n.name];
        if(o === null) throw rerr("NullPointerException", "Zugriff auf Feld '" + n.name + "' von null.");
        return o.__f[n.name];
      }
      case "call": {
        const args = [];
        for(const a of n.args) args.push(await evalE(a, fr));
        if(n.dispatch === "static"){
          const m = dispatch(n.owner, n.name, n.args.length);
          return invoke(null, m, args);
        }
        const self = fr.self;
        if(self === null) throw rerr("NullPointerException", "Kein Objekt für '" + n.name + "'.");
        const m = dispatch(self.__cls, n.name, n.args.length);
        return invoke(self, m, args);
      }
      case "supercall": {
        const args = [];
        for(const a of n.args) args.push(await evalE(a, fr));
        const m = dispatch(n.owner, n.name, n.args.length);   // NICHT virtuell
        return invoke(fr.self, m, args);
      }
      case "mcall": return evalMCall(n, fr);
    }
    throw rerr("Interner Fehler", "Unbekannter Ausdruck: " + n.kind);
  }
  function strHowRuntime(t){
    if(!t || !t.elem) return "obj";
    const e = unbox(t.elem);
    return strHow2(e);
  }
  function strHow2(t){
    if(t.dims > 0) return "arr";
    switch(t.base){
      case "char": return "char"; case "double": return "double";
      case "boolean": return "bool"; case "String": return "str"; case "int": return "int";
      default: return "obj";
    }
  }

  async function evalMCall(n, fr){
    const file = n.file;
    if(n.mkind === "sysout"){
      let text = "";
      if(n.args.length){
        const v = await evalE(n.args[0], fr);
        text = await toStr(v, n.args[0].strHow);
      }
      S.io.print(text + (n.name === "println" ? "\n" : ""));
      return null;
    }
    if(n.mkind === "math"){
      const vs = [];
      for(const a of n.args) vs.push(await evalE(a, fr));
      const isIntArgs = n.args.every(a => a.jt && a.jt.base !== "double");
      switch(n.name){
        case "abs": return isIntArgs ? i32(Math.abs(vs[0])) : Math.abs(vs[0]);
        case "max": return isIntArgs ? i32(Math.max(vs[0], vs[1])) : Math.max(vs[0], vs[1]);
        case "min": return isIntArgs ? i32(Math.min(vs[0], vs[1])) : Math.min(vs[0], vs[1]);
        case "pow": return Math.pow(vs[0], vs[1]);
        case "sqrt": return Math.sqrt(vs[0]);
        case "floor": return Math.floor(vs[0]);
        case "ceil": return Math.ceil(vs[0]);
        case "round": return i32(Math.round(vs[0]));
        case "random": return Math.random();
      }
    }
    if(n.mkind === "parseInt"){
      const s2 = await evalE(n.args[0], fr);
      if(s2 === null) throw rerr("NumberFormatException", "Integer.parseInt(null).");
      const t = s2.trim();
      if(!/^[+-]?\d+$/.test(t)) throw rerr("NumberFormatException", '"' + s2 + '" ist keine ganze Zahl.');
      return i32(parseInt(t, 10));
    }
    if(n.mkind === "parseDouble"){
      const s2 = await evalE(n.args[0], fr);
      if(s2 === null) throw rerr("NumberFormatException", "Double.parseDouble(null).");
      if(s2.includes(",")) throw rerr("NumberFormatException", '"' + s2 + '" — in Java trennt der PUNKT die Nachkommastellen (z. B. 3.5 statt 3,5).');
      const v = Number(s2.trim());
      if(!isFinite(v) && !/^[+-]?(Infinity)$/.test(s2.trim())) throw rerr("NumberFormatException", '"' + s2 + '" ist keine Zahl.');
      if(Number.isNaN(v)) throw rerr("NumberFormatException", '"' + s2 + '" ist keine Zahl.');
      return v;
    }
    if(n.mkind === "intToString"){ return String(await evalE(n.args[0], fr)); }
    if(n.mkind === "parseBoolean"){ const s2 = await evalE(n.args[0], fr); return s2 !== null && s2.toLowerCase() === "true"; }
    if(n.mkind === "boolToString"){ return (await evalE(n.args[0], fr)) ? "true" : "false"; }
    if(n.mkind === "valueOf"){ return toStr(await evalE(n.args[0], fr), n.args[0].strHow); }
    if(n.mkind && n.mkind.startsWith("char-")){
      const c = await evalE(n.args[0], fr);
      const ch = String.fromCharCode(c);
      switch(n.mkind){
        case "char-isDigit": return /\d/.test(ch);
        case "char-isLetter": return /[A-Za-zÄÖÜäöüß]/.test(ch);
        case "char-toUpperCase": return ch.toUpperCase().charCodeAt(0);
        case "char-toLowerCase": return ch.toLowerCase().charCodeAt(0);
      }
    }
    if(n.mkind === "string"){
      const s2 = await evalE(n.obj, fr);
      if(s2 === null) throw rerr("NullPointerException", "String-Methode '" + n.name + "' auf null.");
      const vs = [];
      for(const a of n.args) vs.push(await evalE(a, fr));
      switch(n.name){
        case "length": return s2.length;
        case "isEmpty": return s2.length === 0;
        case "charAt":
          if(vs[0] < 0 || vs[0] >= s2.length) throw rerr("StringIndexOutOfBoundsException", "charAt(" + vs[0] + ") — Länge ist " + s2.length + ".");
          return s2.charCodeAt(vs[0]);
        case "substring": {
          const a0 = vs[0], a1 = vs.length > 1 ? vs[1] : s2.length;
          if(a0 < 0 || a1 > s2.length || a0 > a1) throw rerr("StringIndexOutOfBoundsException", "substring(" + vs.join(", ") + ") — Länge ist " + s2.length + ".");
          return s2.substring(a0, a1);
        }
        case "equals": return vs[0] !== null && s2 === vs[0];
        case "equalsIgnoreCase": return vs[0] !== null && s2.toLowerCase() === vs[0].toLowerCase();
        case "contains": return s2.includes(vs[0]);
        case "startsWith": return s2.startsWith(vs[0]);
        case "endsWith": return s2.endsWith(vs[0]);
        case "indexOf": return s2.indexOf(typeof vs[0] === "number" ? String.fromCharCode(vs[0]) : vs[0]);
        case "lastIndexOf": return s2.lastIndexOf(typeof vs[0] === "number" ? String.fromCharCode(vs[0]) : vs[0]);
        case "toUpperCase": return s2.toUpperCase();
        case "toLowerCase": return s2.toLowerCase();
        case "trim": return s2.trim();
        case "replace":
          if(n.args[0].jt.base === "char") return s2.split(String.fromCharCode(vs[0])).join(String.fromCharCode(vs[1]));
          return s2.split(vs[0]).join(vs[1]);
        case "compareTo": return s2 < vs[0] ? -1 : s2 > vs[0] ? 1 : 0;
        case "split": return s2.split(new RegExp(vs[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        case "toString": return s2;
      }
    }
    if(n.mkind === "list"){
      const L = await evalE(n.obj, fr);
      if(L === null) throw rerr("NullPointerException", "ArrayList-Methode '" + n.name + "' auf null.");
      const vs = [];
      for(const a of n.args) vs.push(await evalE(a, fr));
      const arr = L.__list;
      const eq = (x, y) => x === y;
      switch(n.name){
        case "add":
          if(vs.length === 1){ arr.push(vs[0]); return true; }
          if(vs[0] < 0 || vs[0] > arr.length) throw rerr("IndexOutOfBoundsException", "add(" + vs[0] + ") — Größe ist " + arr.length + ".");
          arr.splice(vs[0], 0, vs[1]); return null;
        case "get":
          if(vs[0] < 0 || vs[0] >= arr.length) throw rerr("IndexOutOfBoundsException", "get(" + vs[0] + ") — Größe ist " + arr.length + ".");
          return arr[vs[0]];
        case "set": {
          if(vs[0] < 0 || vs[0] >= arr.length) throw rerr("IndexOutOfBoundsException", "set(" + vs[0] + ") — Größe ist " + arr.length + ".");
          const old = arr[vs[0]]; arr[vs[0]] = vs[1]; return old;
        }
        case "remove": {
          if(vs[0] < 0 || vs[0] >= arr.length) throw rerr("IndexOutOfBoundsException", "remove(" + vs[0] + ") — Größe ist " + arr.length + ".");
          return arr.splice(vs[0], 1)[0];
        }
        case "size": return arr.length;
        case "isEmpty": return arr.length === 0;
        case "contains": return arr.some(x => eq(x, vs[0]));
        case "indexOf": return arr.findIndex(x => eq(x, vs[0]));
        case "clear": arr.length = 0; return null;
        case "toString": return objToString(L);
      }
    }
    if(n.mkind === "scanner"){
      const sc = await evalE(n.obj, fr);
      if(sc === null) throw rerr("NullPointerException", "Scanner ist null.");
      switch(n.name){
        case "nextInt": {
          const t = await scanToken();
          if(!/^[+-]?\d+$/.test(t)) throw rerr("InputMismatchException", '"' + t + '" ist keine ganze Zahl.');
          return i32(parseInt(t, 10));
        }
        case "nextDouble": {
          const t = await scanToken();
          if(t.includes(",")) throw rerr("InputMismatchException", '"' + t + '" — in Java trennt der PUNKT die Nachkommastellen (z. B. 3.5 statt 3,5).');
          const v = Number(t);
          if(Number.isNaN(v) || t === "") throw rerr("InputMismatchException", '"' + t + '" ist keine Zahl.');
          return v;
        }
        case "next": return scanToken();
        case "nextLine": return scanLine();
        case "nextBoolean": {
          const t = (await scanToken()).toLowerCase();
          if(t !== "true" && t !== "false") throw rerr("InputMismatchException", '"' + t + '" ist kein boolean (true/false).');
          return t === "true";
        }
        case "hasNextInt": case "hasNext": return true;   // vereinfachte Annahme (interaktive Konsole)
        case "close": return null;
      }
    }
    if(n.mkind === "toString-default"){
      const o = await evalE(n.obj, fr);
      if(o === null) throw rerr("NullPointerException", "toString() auf null.");
      return objToString(o);
    }
    if(n.mkind === "equals-default"){
      const o = await evalE(n.obj, fr);
      const b = await evalE(n.args[0], fr);
      if(o === null) throw rerr("NullPointerException", "equals(…) auf null.");
      return o === b;
    }
    if(n.mkind === "user-static"){
      const args = [];
      for(const a of n.args) args.push(await evalE(a, fr));
      const m = dispatch(n.ownerCls, n.name, n.args.length);
      return invoke(null, m, args);
    }
    /* Instanz-Methode einer Nutzerklasse (dynamische Bindung) */
    const o = await evalE(n.obj, fr);
    if(o === null) throw rerr("NullPointerException", "Methodenaufruf '" + n.name + "' auf null.");
    const args = [];
    for(const a of n.args) args.push(await evalE(a, fr));
    const m = dispatch(o.__cls, n.name, n.args.length);
    return invoke(o, m, args);
  }

  /* ---------- Programmstart ---------- */
  async function runMain(){
    await initStatics();
    const mainCls = classes.get(chk.mainClass);
    const m = mainCls.methods.find(x => x.name === "main" && x.static);
    m.__owner = mainCls.name;
    S.curFile = m.file;
    await invoke(null, m, [[]]);
    return S.steps;
  }
  return { runMain, S };
}

/* --------------------------------------------------------- Öffentliche API */
function compile(files){
  const units = [];
  for(const f of files){
    const toks = lex(f.content || "", f.name);
    units.push({ file: f.name, classes: Parser(toks, f.name).parseFile() });
  }
  const chk = Checker(units);
  return { chk };
}

async function run(compiled, io, opts){
  const it = Interp(compiled.chk, io, opts);
  return it.runMain();
}

async function runHeadless(files, stdinLines, opts){
  opts = opts || {};
  let output = "";
  const lines = (stdinLines || []).slice();
  const io = {
    print: s => { output += s; if(output.length > 200000) throw rerrObj("Zu viel Ausgabe", "Das Programm erzeugt zu viel Ausgabe.", "?", 0); },
    input: async () => lines.length ? lines.shift() : null,
  };
  try{
    const compiled = compile(files);
    const steps = await run(compiled, io, Object.assign({ maxSteps: opts.maxSteps || 4000000, yieldEvery: 1e9 }, opts));
    return { ok: true, output, steps };
  } catch(e){
    const j = e && e.jerr;
    if(j) return { ok: false, output, error: j, errorText: fmtErr(j) };
    if(e instanceof RangeError){   // nativer Stapelüberlauf -> freundliche Java-Meldung
      const jr = { kind:"runtime", name:"StackOverflowError", message:"Zu tiefe Verschachtelung von Aufrufen (endlose Rekursion?)." };
      return { ok: false, output, error: jr, errorText: fmtErr(jr) };
    }
    return { ok: false, output, error: { kind:"runtime", name:"Fehler", message: String(e && e.message || e) }, errorText: String(e && e.message || e) };
  }
}

function fmtErr(j){
  if(!j) return "Unbekannter Fehler";
  const loc = (j.file ? j.file : "") + (j.line ? " (Zeile " + j.line + ")" : "");
  if(j.kind === "compile") return "Compilerfehler" + (loc ? " in " + loc : "") + ": " + j.message;
  return (j.name || "Laufzeitfehler") + (loc ? " in " + loc : "") + ": " + j.message;
}

window.JavaEngine = { compile, run, runHeadless, fmtErr, Interp };

})();
