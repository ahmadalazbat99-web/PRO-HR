const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');
const html=fs.readFileSync(path.join(root,'src','index.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const findings=[];
function must(name,ok,detail){if(!ok)findings.push({severity:'HIGH',name,detail});else console.log('PASS',name)}
must('contextIsolation',main.includes('contextIsolation:true'),'BrowserWindow must isolate renderer context');
must('nodeIntegration disabled',main.includes('nodeIntegration:false'),'Renderer must not get Node integration');
must('sandbox enabled',main.includes('sandbox:true'),'Renderer should run sandboxed');
must('external windows denied',main.includes("setWindowOpenHandler(()=>({action:'deny'}))"),'Block renderer-created windows');
must('external navigation denied',main.includes("will-navigate") && main.includes("startsWith('file://')"),'Block non-file navigation');
must('session tokens',main.includes('currentSessions')&&main.includes("auth:logout"),'Use process-side sessions');
must('password hashing',main.includes("scryptSync")&&main.includes("hashPassword('admin123')"),'Seed password must be hashed');
must('atomic sqlite write',main.includes("const tmp=dbPath+'.tmp'")&&main.includes('fs.renameSync(tmp,dbPath)'),'Avoid partially written DB files');
must('legacy json writes blocked',main.includes('مسار JSON القديم متوقف'),'Do not use duplicate JSON datastore for production writes');
must('secure backup permission',main.includes("guard(p.token,'backup','can_export')"),'Backup must require authorization');
must('package version 1.4.1',pkg.version==='1.4.1','Commercial hardening release must be 1.4.1');
const criticalPatterns=[/eval\s*\(/,/child_process\.(exec|spawn|fork)\s*\(/,/shell\.openExternal\s*\(/,/remote\s*:\s*true/];
for(const re of criticalPatterns){
  const hit=re.test(main)||re.test(preload)||re.test(html);
  console.log(hit?'REVIEW':'PASS',`pattern ${re}`);
  if(hit)findings.push({severity:'REVIEW',name:`pattern ${re}`,detail:'Manual review required'});
}
if(findings.length){console.log('\nFindings:');for(const f of findings)console.log(`${f.severity}: ${f.name} — ${f.detail}`);process.exitCode=1}else console.log('\nNo active static security findings. This is not a certification.');
