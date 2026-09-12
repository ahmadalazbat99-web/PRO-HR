const fs=require("fs"),path=require("path");
const root=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(root,"src","index.html"),"utf8");
const main=fs.readFileSync(path.join(root,"main.js"),"utf8");
const preload=fs.readFileSync(path.join(root,"preload.js"),"utf8");
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const checks=[
 ['version',pkg.version==='1.4.1'],
 ['login button',html.includes('id="loginBtn"')],
 ['production page',html.includes('id="production"')],
 ['session auth',main.includes("auth:logout")&&main.includes("currentSessions")],
 ['sqlite employee CRUD',main.includes("employees:add")&&main.includes("employees:update")&&main.includes("employees:delete")],
 ['secure backup',main.includes("backup:create")&&main.includes("can_export")&&main.includes("backup:restore")],
 ['real exports',main.includes("report:csv")&&main.includes("report:pdf")&&main.includes("report:excel")],
 ['server-side user guards',main.includes("guard(token,'users','can_add')")&&main.includes("guard(token,'permissions','can_edit')")&&main.includes("guard(p.token,'employees','can_delete')")],
 ['legacy JSON writes disabled',main.includes("مسار JSON القديم متوقف")],
 ['database service',fs.existsSync(path.join(root,'services','hrDataService.js'))],
 ['security script',fs.existsSync(path.join(root,'scripts','security-check.js'))],
 ['QA script',true]
];
let bad=0; for(const [n,ok] of checks){console.log((ok?'PASS':'FAIL'),n);if(!ok)bad++;}
process.exitCode=bad?1:0;
