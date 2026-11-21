"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const games=[
 ["ege9-roots",["diagKind:'repair'","ruleStats","ruleNames"]],
 ["ege10-pristavgrad",["diagKind:'word'","ruleStats","ruleNames"]],
 ["paronimoskop",["diagKind:'question'","ruleStats","ruleNames"]],
 ["tr26-links",["diagKind='question'","function diagTopic26","ruleStats"]],
 ["slovar11",["diagKind='lexeme'","wordBreakdown","ruleNames"]],
 ["legopunkt",["diagKind='stage'","function lpStageFail","lpDiag"]]
];
for(const [g,needles] of games){
 const fname=path.join(root,"games",g,"index.html");
 const html=fs.readFileSync(fname,"utf8");
 assert(html.length>1000,g+" source unexpectedly short");
 for(const needle of needles)assert(html.includes(needle),g+" missing "+needle);
 let parsed=0;const re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;let m;
 while((m=re.exec(html))){
  if(/\btype\s*=\s*["'](?:application\/json|application\/ld\+json)["']/i.test(m[1]))continue;
  if(!m[2].trim())continue;
  try{new vm.Script(m[2],{filename:g+" inline script "+(++parsed)});}
  catch(e){throw Error(g+" inline JavaScript parse failed: "+e.message);}
 }
 assert(parsed>0,g+" missing parsed scripts");
 console.log("PASS",g,"scripts",parsed,"bytes",Buffer.byteLength(html));
}
const gs=fs.readFileSync(path.join(__dirname,"GameSkillStats.gs"),"utf8");
new vm.Script(gs,{filename:"GameSkillStats.gs"});
for(const id of ["TR8_01","TR8_02","HOSPITAL","TR21_DASH","TR21_COLON","TR21_COMMA","TR22"]){
 assert(gs.includes(id),"Legacy category missing "+id);
}
const saved=[];
let prior=[];
const sheet={
 getLastRow(){return prior.length+1;},
 getMaxRows(){return 6000;},
 insertRowsAfter(){},
 getRange(row,col,n,c){
  return {
   getDisplayValues(){return prior.map(x=>x.slice(col-1,col-1+c).map(String))},
   setValues(v){assert.equal(c,13);saved.push(...v);prior.push(...v);},
   setNumberFormat(){}
  };
 }
};
const sandbox={console,Date,
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
vm.createContext(sandbox);vm.runInContext(gs,sandbox);
const book={getSheetByName(n){assert.equal(n,"Тренажёры — навыки");return sheet;}};
const payload={ruleStats:{test:[3,1],other:[2,0]},ruleNames:{test:"Тестовое правило",other:"Второе правило"},diagKind:"word"};
sandbox.e4SaveGameSkills_(book,"123","Ученица","ege10-pristavgrad","ПриставьГрад","attempt-123",payload);
assert.equal(saved.length,2,"two rule rows saved");
assert.equal(saved[0][8],3);assert.equal(saved[0][9],1);assert.equal(saved[0][10],2);
sandbox.e4SaveGameSkills_(book,"123","Ученица","ege10-pristavgrad","ПриставьГрад","attempt-123",payload);
assert.equal(saved.length,2,"replays idempotent");
sandbox.e4SaveGameSkills_(book,"123","Ученица","HOSPITAL","Больница","attempt-124",{tested:{"Слитное написание наречий":15,"Раздельное написание наречий":15},errors:{"Слитное написание наречий":4}});
assert.equal(saved.length,4,"legacy game data persisted");
assert.equal(saved[2][8],15);assert.equal(saved[2][9],4);
console.log("ALL RULE DIAGNOSTIC CONTRACT CHECKS PASSED");
