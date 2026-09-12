
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class HRDataService {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.file = path.join(baseDir, "hrpro-data.json");
    this.backupDir = path.join(baseDir, "backups");
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.db = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      return {
        meta: { version: "1.0.3", createdAt: new Date().toISOString() },
        companies: [],
        branches: [],
        departments: [],
        positions: [],
        employees: [],
        attendance: [],
        leaveTypes: [],
        leaveBalances: [],
        leaveRequests: [],
        loans: [],
        deductions: [],
        payrollRuns: [],
        payrollItems: [],
        settlements: [],
        notifications: [],
        auditLog: []
      };
    }
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch { throw new Error("قاعدة البيانات تالفة أو غير قابلة للقراءة"); }
  }

  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  id(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  }

  table(name) {
    if (!Object.prototype.hasOwnProperty.call(this.db, name)) throw new Error("جدول غير معروف: "+name);
    return this.db[name];
  }

  list(name, filter={}) {
    return this.table(name).filter(row => Object.entries(filter).every(([k,v]) => v === "" || v == null || row[k] === v));
  }

  create(name, data, actor="system") {
    const row = { id: data.id || this.id(name.slice(0,3).toUpperCase()), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.table(name).push(row);
    this.audit(actor, "CREATE", name, row.id, data);
    this.save();
    return row;
  }

  update(name, id, patch, actor="system") {
    const t=this.table(name), i=t.findIndex(x=>x.id===id);
    if(i<0) throw new Error("السجل غير موجود");
    const before={...t[i]};
    t[i]={...t[i],...patch,id,updatedAt:new Date().toISOString()};
    this.audit(actor, "UPDATE", name, id, {before,after:t[i]});
    this.save();
    return t[i];
  }

  remove(name,id,actor="system") {
    const t=this.table(name), i=t.findIndex(x=>x.id===id);
    if(i<0) throw new Error("السجل غير موجود");
    const [row]=t.splice(i,1);
    this.audit(actor,"DELETE",name,id,row);
    this.save();
    return row;
  }

  audit(actor, action, entity, entityId, details) {
    this.db.auditLog.push({
      id:this.id("AUD"), actor, action, entity, entityId,
      details, createdAt:new Date().toISOString()
    });
  }

  backup(actor="system") {
    this.save();
    const name=`HRPRO-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
    const dest=path.join(this.backupDir,name);
    fs.copyFileSync(this.file,dest);
    this.audit(actor,"BACKUP","database",name,{});
    this.save();
    return dest;
  }

  health() {
    const stat=fs.statSync(this.file);
    return { ok:true, file:this.file, bytes:stat.size, tables:Object.fromEntries(Object.keys(this.db).filter(k=>Array.isArray(this.db[k])).map(k=>[k,this.db[k].length])) };
  }
}
module.exports={HRDataService};
