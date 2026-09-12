const { HRDataService } = require('./services/hrDataService');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const zlib = require('zlib');
const initSqlJs = require('sql.js');
const { verifyLicense } = require('./license');
const { getUpdateState, saveUpdateState, verifyUpdateManifest } = require('./update');

let db;
let dbPath;
let SQL;
let hrData;
let currentSessions = new Map();
let mainWindow = null;

async function initDatabase() {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  SQL = await initSqlJs({ locateFile: () => wasmPath });
  dbPath = path.join(app.getPath('userData'), 'hr-pro-jordan.sqlite');
  if (fs.existsSync(dbPath)) db = new SQL.Database(fs.readFileSync(dbPath));
  else db = new SQL.Database();
  db.run(`PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tax_no TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS branches(id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT, address TEXT, phone TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, branch_id INTEGER, name TEXT NOT NULL, code TEXT, manager_employee_id INTEGER, active INTEGER DEFAULT 1, FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(branch_id) REFERENCES branches(id));
  CREATE TABLE IF NOT EXISTS job_titles(id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT NOT NULL, code TEXT, grade TEXT, active INTEGER DEFAULT 1, FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS employee_bank_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, bank_name TEXT, iban TEXT, account_name TEXT, primary_account INTEGER DEFAULT 1, active INTEGER DEFAULT 1, FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS employee_contacts(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, contact_type TEXT, name TEXT, phone TEXT, relation TEXT, is_primary INTEGER DEFAULT 0, FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role_id INTEGER, employee_id INTEGER, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(role_id) REFERENCES roles(id));
  CREATE TABLE IF NOT EXISTS permissions(id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER, module TEXT NOT NULL, can_view INTEGER DEFAULT 0, can_add INTEGER DEFAULT 0, can_edit INTEGER DEFAULT 0, can_delete INTEGER DEFAULT 0, can_approve INTEGER DEFAULT 0, can_export INTEGER DEFAULT 0, FOREIGN KEY(role_id) REFERENCES roles(id));
  CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_no TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, first_name TEXT, middle_name TEXT, last_name TEXT, national_id TEXT, gender TEXT, birth_date TEXT, nationality TEXT DEFAULT 'Jordanian', marital_status TEXT, dependents INTEGER DEFAULT 0, phone TEXT, email TEXT, address TEXT, emergency_phone TEXT, company_id INTEGER, branch_id INTEGER, department_id INTEGER, job_title_id INTEGER, job_title TEXT, manager_employee_id INTEGER, hire_date TEXT, probation_end TEXT, contract_type TEXT DEFAULT 'permanent', contract_end TEXT, basic_salary REAL DEFAULT 0, housing_allowance REAL DEFAULT 0, transport_allowance REAL DEFAULT 0, other_allowances REAL DEFAULT 0, social_security_no TEXT, bank_iban TEXT, status TEXT DEFAULT 'active', termination_date TEXT, termination_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(branch_id) REFERENCES branches(id), FOREIGN KEY(department_id) REFERENCES departments(id), FOREIGN KEY(job_title_id) REFERENCES job_titles(id), FOREIGN KEY(manager_employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS leave_balances(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, leave_type TEXT, opening REAL DEFAULT 0, earned REAL DEFAULT 0, used REAL DEFAULT 0, carried REAL DEFAULT 0, balance REAL DEFAULT 0, FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS payroll_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL UNIQUE, status TEXT DEFAULT 'draft', gross REAL DEFAULT 0, deductions REAL DEFAULT 0, employee_ss REAL DEFAULT 0, tax REAL DEFAULT 0, net REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS payroll_items(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, employee_id INTEGER, basic REAL DEFAULT 0, allowances REAL DEFAULT 0, overtime REAL DEFAULT 0, bonuses REAL DEFAULT 0, deductions REAL DEFAULT 0, employee_ss REAL DEFAULT 0, tax REAL DEFAULT 0, net REAL DEFAULT 0, FOREIGN KEY(run_id) REFERENCES payroll_runs(id), FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS payroll_settings(id INTEGER PRIMARY KEY CHECK(id=1), employee_ss_rate REAL DEFAULT 0.075, employer_ss_rate REAL DEFAULT 0.1425, ss_min_wage REAL DEFAULT 0, ss_max_wage REAL DEFAULT 0, personal_exemption REAL DEFAULT 9000, dependent_exemption REAL DEFAULT 9000, tax_band1 REAL DEFAULT 10000, tax_rate1 REAL DEFAULT 0.07, tax_band2 REAL DEFAULT 10000, tax_rate2 REAL DEFAULT 0.14, tax_rate3 REAL DEFAULT 0.20, working_hours_month REAL DEFAULT 208, overtime_multiplier REAL DEFAULT 1.5, holiday_overtime_multiplier REAL DEFAULT 2.0, unpaid_day_divisor REAL DEFAULT 30);
  CREATE TABLE IF NOT EXISTS payroll_components(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, component_type TEXT NOT NULL, calculation_type TEXT DEFAULT 'fixed', default_value REAL DEFAULT 0, taxable INTEGER DEFAULT 0, social_security INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS payroll_adjustments(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, component_id INTEGER, amount REAL DEFAULT 0, period TEXT, note TEXT, FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE, FOREIGN KEY(component_id) REFERENCES payroll_components(id));
  CREATE TABLE IF NOT EXISTS payroll_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, action TEXT, username TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(run_id) REFERENCES payroll_runs(id));
  CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, work_date TEXT NOT NULL, check_in TEXT, check_out TEXT, late_minutes INTEGER DEFAULT 0, overtime_minutes INTEGER DEFAULT 0, status TEXT DEFAULT 'present', FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS leave_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, leave_type TEXT, start_date TEXT, end_date TEXT, days REAL, status TEXT DEFAULT 'pending', reason TEXT, FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS loans(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, amount REAL, installment REAL, remaining REAL, start_date TEXT, status TEXT DEFAULT 'active', FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS deductions(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, kind TEXT, amount REAL, recurring INTEGER DEFAULT 0, installments_left INTEGER DEFAULT 1, FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, kind TEXT, file_name TEXT, expiry_date TEXT, notes TEXT, FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS legal_rules(id INTEGER PRIMARY KEY AUTOINCREMENT, rule_type TEXT, title TEXT, value_json TEXT, effective_from TEXT, effective_to TEXT, source TEXT, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, action TEXT, entity TEXT, entity_id TEXT, old_value TEXT, new_value TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS loan_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, loan_id INTEGER NOT NULL, payment_date TEXT NOT NULL, amount REAL NOT NULL, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(loan_id) REFERENCES loans(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, termination_date TEXT NOT NULL, reason TEXT, earned_salary REAL DEFAULT 0, leave_payout REAL DEFAULT 0, end_service REAL DEFAULT 0, deductions REAL DEFAULT 0, net REAL DEFAULT 0, status TEXT DEFAULT 'draft', created_by TEXT, approved_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS workflow_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, stage TEXT NOT NULL, status TEXT DEFAULT 'pending', requested_by TEXT, assigned_to TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, title TEXT NOT NULL, body TEXT, type TEXT DEFAULT 'info', is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

    CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, grace_minutes INTEGER DEFAULT 0, break_minutes INTEGER DEFAULT 0, weekly_hours REAL DEFAULT 48, active INTEGER DEFAULT 1, FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS employee_shifts(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, shift_id INTEGER NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT, active INTEGER DEFAULT 1, FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE, FOREIGN KEY(shift_id) REFERENCES shifts(id));
  CREATE TABLE IF NOT EXISTS leave_types(id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, code TEXT, name TEXT NOT NULL, unit TEXT DEFAULT 'day', annual_entitlement REAL DEFAULT 0, paid INTEGER DEFAULT 1, requires_document INTEGER DEFAULT 0, carry_forward INTEGER DEFAULT 0, max_carry_forward REAL DEFAULT 0, active INTEGER DEFAULT 1, FOREIGN KEY(company_id) REFERENCES companies(id));
  CREATE TABLE IF NOT EXISTS leave_balances_v2(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, leave_type_id INTEGER NOT NULL, year INTEGER NOT NULL, opening REAL DEFAULT 0, earned REAL DEFAULT 0, carried REAL DEFAULT 0, used REAL DEFAULT 0, pending REAL DEFAULT 0, balance REAL DEFAULT 0, UNIQUE(employee_id,leave_type_id,year), FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE, FOREIGN KEY(leave_type_id) REFERENCES leave_types(id));
  CREATE TABLE IF NOT EXISTS leave_requests_v2(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, leave_type_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, days REAL NOT NULL, reason TEXT, attachment_name TEXT, status TEXT DEFAULT 'pending', requested_at TEXT DEFAULT CURRENT_TIMESTAMP, approved_by INTEGER, approved_at TEXT, rejection_reason TEXT, FOREIGN KEY(employee_id) REFERENCES employees(id), FOREIGN KEY(leave_type_id) REFERENCES leave_types(id), FOREIGN KEY(approved_by) REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS attendance_settings(id INTEGER PRIMARY KEY CHECK(id=1), auto_checkout INTEGER DEFAULT 0, allow_manual INTEGER DEFAULT 1, allow_edit INTEGER DEFAULT 1, overtime_after_minutes INTEGER DEFAULT 0, late_after_minutes INTEGER DEFAULT 0, timezone TEXT DEFAULT 'Asia/Amman');
  CREATE TABLE IF NOT EXISTS fingerprint_devices(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, device_type TEXT, ip_address TEXT, port INTEGER, serial_no TEXT, branch_id INTEGER, active INTEGER DEFAULT 1, last_sync TEXT, FOREIGN KEY(branch_id) REFERENCES branches(id));
  CREATE TABLE IF NOT EXISTS attendance_imports(id INTEGER PRIMARY KEY AUTOINCREMENT, source_name TEXT, rows_count INTEGER DEFAULT 0, imported_count INTEGER DEFAULT 0, errors_count INTEGER DEFAULT 0, imported_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS discipline_cases(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, case_type TEXT NOT NULL, severity TEXT DEFAULT 'medium', incident_date TEXT NOT NULL, description TEXT, action_taken TEXT, status TEXT DEFAULT 'open', created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS performance_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, period TEXT NOT NULL, score REAL DEFAULT 0, strengths TEXT, improvements TEXT, comments TEXT, reviewer TEXT, status TEXT DEFAULT 'draft', created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(employee_id) REFERENCES employees(id));
  CREATE TABLE IF NOT EXISTS org_units(id INTEGER PRIMARY KEY AUTOINCREMENT, unit_type TEXT NOT NULL, parent_id INTEGER, name TEXT NOT NULL, code TEXT, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS bank_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, bank_name TEXT, iban TEXT, account_name TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS report_templates(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, header TEXT, footer TEXT, watermark TEXT, paper TEXT DEFAULT 'A4', orientation TEXT DEFAULT 'portrait', show_logo INTEGER DEFAULT 1, show_page_numbers INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    `);
  // Lightweight schema migrations for existing HR PRO databases
  const ensureColumn = (table, column, definition) => {
    const cols = all(`PRAGMA table_info(${table})`).map(x => x.name);
    if (!cols.includes(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  [
    ['employees','first_name','TEXT'],['employees','middle_name','TEXT'],['employees','last_name','TEXT'],['employees','gender','TEXT'],['employees','birth_date','TEXT'],['employees','nationality',"TEXT DEFAULT 'Jordanian'"],['employees','marital_status','TEXT'],['employees','dependents','INTEGER DEFAULT 0'],['employees','email','TEXT'],['employees','address','TEXT'],['employees','emergency_phone','TEXT'],['employees','company_id','INTEGER'],['employees','branch_id','INTEGER'],['employees','job_title_id','INTEGER'],['employees','manager_employee_id','INTEGER'],['employees','probation_end','TEXT'],['employees','contract_type',"TEXT DEFAULT 'permanent'"],['employees','housing_allowance','REAL DEFAULT 0'],['employees','transport_allowance','REAL DEFAULT 0'],['employees','other_allowances','REAL DEFAULT 0'],['employees','bank_iban','TEXT'],['employees','termination_date','TEXT'],['employees','termination_reason','TEXT'],
  ].forEach(([t,c,d])=>ensureColumn(t,c,d));
  seedData();
  seedPermissions();
  seedStage3();
  seedPayroll();
  migratePasswords();
  saveDb();
}

function scalar(sql, params=[]) {
  const rows = all(sql, params);
  if (!rows.length) return 0;
  const first = rows[0];
  const key = Object.keys(first)[0];
  return first[key] ?? 0;
}

function seedData() {
  const get = scalar("SELECT COUNT(*) AS c FROM companies");
  if (get === 0) db.run("INSERT INTO companies(name) VALUES (?)", ['شركة HR PRO']);
  const roles = ['Super Admin','HR Manager','Payroll Officer','Department Manager','Employee'];
  for (const r of roles) db.run("INSERT OR IGNORE INTO roles(name) VALUES (?)", [r]);
  const c = scalar("SELECT id FROM companies ORDER BY id LIMIT 1");
  if (scalar("SELECT COUNT(*) AS c FROM branches") === 0) {
    db.run("INSERT INTO branches(company_id,name,code,address) VALUES (?,?,?,?)", [c,'المقر الرئيسي','HQ','العقبة - الأردن']);
    db.run("INSERT INTO branches(company_id,name,code,address) VALUES (?,?,?,?)", [c,'فرع عمّان','AMM','عمّان - الأردن']);
  }
  const branch = scalar("SELECT id FROM branches WHERE company_id=? ORDER BY id LIMIT 1", [c]);
  if (scalar("SELECT COUNT(*) AS c FROM departments") === 0) {
    [['الموارد البشرية','HR'],['المالية','FIN'],['تقنية المعلومات','IT'],['التسويق','MKT']].forEach(([n,code]) => db.run("INSERT INTO departments(company_id,branch_id,name,code) VALUES (?,?,?,?)", [c,branch,n,code]));
  }
  if (scalar("SELECT COUNT(*) AS c FROM job_titles") === 0) {
    [['موظف موارد بشرية','HR-OFF'],['محاسب','ACC'],['مطور برمجيات','DEV'],['مسؤول تسويق','MKT-OFF'],['مدير قسم','MGR']].forEach(([n,code]) => db.run("INSERT INTO job_titles(company_id,name,code) VALUES (?,?,?)", [c,n,code]));
  }
  const admin = scalar("SELECT COUNT(*) AS c FROM users WHERE username='admin'");
  if (admin === 0) {
    const role = scalar("SELECT id FROM roles WHERE name='Super Admin'");
    db.run("INSERT INTO users(username,password_hash,role_id) VALUES (?,?,?)", ['admin',hashPassword('admin123'),role]);
  }
  if (scalar("SELECT COUNT(*) AS c FROM employees") === 0) {
    const depts = all("SELECT id,name FROM departments ORDER BY id");
    const titles = all("SELECT id,name FROM job_titles ORDER BY id");
    const depMap = Object.fromEntries(depts.map(x => [x.name,x.id]));
    const titleMap = Object.fromEntries(titles.map(x => [x.name,x.id]));
    const rows = [
      ['HR-0248','محمد أحمد','Mohammad','Ahmed','',depMap['المالية'],titleMap['محاسب'],'محاسب',720],
      ['HR-0247','سارة علي','Sarah','Ali','',depMap['الموارد البشرية'],titleMap['موظف موارد بشرية'],'موظف موارد بشرية',650],
      ['HR-0246','خالد حسن','Khaled','Hassan','',depMap['تقنية المعلومات'],titleMap['مطور برمجيات'],'مطور برمجيات',900]
    ];
    for (const [no,name,first,last,middle,dep,titleId,title,sal] of rows) db.run("INSERT INTO employees(employee_no,full_name,first_name,last_name,middle_name,company_id,branch_id,department_id,job_title_id,job_title,basic_salary,hire_date,contract_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",[no,name,first,last,middle,c,branch,dep,titleId,title,sal,'2023-01-01','permanent']);
  }
}

function seedStage3() {
  const c = scalar("SELECT id FROM companies ORDER BY id LIMIT 1");
  if (scalar('SELECT COUNT(*) AS c FROM attendance_settings WHERE id=1') === 0) {
    db.run("INSERT INTO attendance_settings(id,auto_checkout,allow_manual,allow_edit,overtime_after_minutes,late_after_minutes,timezone) VALUES (1,0,1,1,0,0,'Asia/Amman')");
  }
  if (scalar('SELECT COUNT(*) AS c FROM shifts') === 0 && c) {
    db.run("INSERT INTO shifts(company_id,name,start_time,end_time,grace_minutes,break_minutes,weekly_hours) VALUES (?,?,?,?,?,?,?)",[c,'الدوام الرسمي','08:00','16:00',10,60,48]);
    db.run("INSERT INTO shifts(company_id,name,start_time,end_time,grace_minutes,break_minutes,weekly_hours) VALUES (?,?,?,?,?,?,?)",[c,'الدوام الصباحي','07:00','15:00',10,60,48]);
  }
  if (scalar('SELECT COUNT(*) AS c FROM leave_types') === 0 && c) {
    const rows=[['ANNUAL','سنوية','day',14,1,0,1,14],['SICK','مرضية','day',0,1,1,0,0],['UNPAID','بدون راتب','day',0,0,0,0,0],['EMERGENCY','طارئة','day',0,1,0,0,0]];
    for (const r of rows) db.run("INSERT INTO leave_types(company_id,code,name,unit,annual_entitlement,paid,requires_document,carry_forward,max_carry_forward) VALUES (?,?,?,?,?,?,?,?,?)",[c,...r]);
  }
  const year = new Date().getFullYear();
  const emps=all('SELECT id FROM employees');
  const lts=all('SELECT id,annual_entitlement FROM leave_types WHERE active=1');
  for(const e of emps) for(const lt of lts){
    const exists=scalar('SELECT COUNT(*) AS c FROM leave_balances_v2 WHERE employee_id=? AND leave_type_id=? AND year=?',[e.id,lt.id,year]);
    if(!exists) db.run('INSERT INTO leave_balances_v2(employee_id,leave_type_id,year,opening,earned,balance) VALUES (?,?,?,?,?,?)',[e.id,lt.id,year,0,lt.annual_entitlement,lt.annual_entitlement]);
  }
}


function seedPayroll() {
  if (scalar("SELECT COUNT(*) AS c FROM payroll_settings WHERE id=1") === 0) {
    db.run("INSERT INTO payroll_settings(id) VALUES (1)");
  }
  const defaults = [
    ['BASIC','الراتب الأساسي','earning','fixed',0,1,1],
    ['HOUSING','بدل السكن','earning','fixed',0,1,1],
    ['TRANSPORT','بدل المواصلات','earning','fixed',0,0,1],
    ['OTHER','بدلات أخرى','earning','fixed',0,1,1],
    ['OVERTIME','إضافي','earning','calculated',0,1,1],
    ['BONUS','حافز / مكافأة','earning','fixed',0,1,1],
    ['ABSENCE','غياب غير مدفوع','deduction','calculated',0,0,0],
    ['OTHER_DEDUCTION','خصم آخر','deduction','fixed',0,0,0]
  ];
  for (const r of defaults) db.run("INSERT OR IGNORE INTO payroll_components(code,name,component_type,calculation_type,default_value,taxable,social_security) VALUES (?,?,?,?,?,?,?)", r);
  const rules = [
    ['social_security','Jordan employee social security rate','{\"employee_rate\":0.075,\"employer_rate\":0.1425,\"ss_min\":0,\"ss_max\":0}','2014-01-01','', 'SSC Law - configurable reference'],
    ['income_tax','Jordan individual income tax bands','{\"personal_exemption\":9000,\"dependent_exemption\":9000,\"bands\":[{\"limit\":10000,\"rate\":0.07},{\"limit\":10000,\"rate\":0.14},{\"limit\":null,\"rate\":0.20}]}','2020-01-01','', 'ISTD - current law/rules reference'],
    ['minimum_wage','Minimum wage','{\"monthly\":290}','2025-01-01','2027-12-31','Ministry of Labour - configurable reference']
  ];
  for (const r of rules) {
    if (scalar('SELECT COUNT(*) AS c FROM legal_rules WHERE rule_type=?',[r[0]])===0) {
      db.run('INSERT INTO legal_rules(rule_type,title,value_json,effective_from,effective_to,source) VALUES (?,?,?,?,?,?)',r);
    }
  }
}


const MODULES = ['dashboard','employees','org','attendance','leaves','payroll','loans','discipline','documents','reports','portal','permissions','legal','settings','audit','backup'];
const ACTIONS = ['can_view','can_add','can_edit','can_delete','can_approve','can_export'];
function seedPermissions() {
  const roles = all('SELECT id,name FROM roles');
  for (const role of roles) {
    for (const module of MODULES) {
      const exists = scalar('SELECT COUNT(*) AS c FROM permissions WHERE role_id=? AND module=?',[role.id,module]);
      if (exists) continue;
      const admin = role.name === 'Super Admin';
      const employee = role.name === 'Employee';
      const payroll = role.name === 'Payroll Officer';
      const hr = role.name === 'HR Manager';
      const manager = role.name === 'Department Manager';
      let values = {can_view:admin,can_add:admin,can_edit:admin,can_delete:admin,can_approve:admin,can_export:admin};
      if (hr) values = {can_view:1,can_add:1,can_edit:1,can_delete:0,can_approve:1,can_export:1};
      if (payroll) values = {can_view:1,can_add:1,can_edit:1,can_delete:0,can_approve:1,can_export:1};
      if (manager) values = {can_view:1,can_add:0,can_edit:0,can_delete:0,can_approve:1,can_export:0};
      if (employee) values = {can_view: ['dashboard','portal','leaves','attendance','documents'].includes(module)?1:0,can_add: ['leaves','attendance'].includes(module)?1:0,can_edit:0,can_delete:0,can_approve:0,can_export: module==='portal'?1:0};
      db.run('INSERT INTO permissions(role_id,module,can_view,can_add,can_edit,can_delete,can_approve,can_export) VALUES (?,?,?,?,?,?,?,?)',[role.id,module,values.can_view,values.can_add,values.can_edit,values.can_delete,values.can_approve,values.can_export]);
    }
  }
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password,salt,64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password, stored) {
  try {
    if (typeof stored !== 'string') return false;
    if (!stored.startsWith('scrypt$')) return stored === String(password || '');
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    if (!salt || !hash || hash.length !== 128) return false;
    const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(derived, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    console.error('Password verification failed:', err);
    return false;
  }
}
function migratePasswords() {
  const users = all('SELECT id,password_hash FROM users');
  for (const u of users) if (!String(u.password_hash).startsWith('scrypt$')) db.run('UPDATE users SET password_hash=? WHERE id=?',[hashPassword(String(u.password_hash)),u.id]);
}

function saveDb() { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); const data=Buffer.from(db.export()); const tmp=dbPath+'.tmp'; fs.writeFileSync(tmp,data); fs.renameSync(tmp,dbPath); }
function all(sql, params=[]) { const stmt = db.prepare(sql); stmt.bind(params); const out=[]; while(stmt.step()) out.push(stmt.getAsObject()); stmt.free(); return out; }
function run(sql, params=[]) { db.run(sql, params); saveDb(); }

ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataPath: dbPath }));
ipcMain.handle('app:health', () => ({ ok: !!db && typeof db.run === 'function', dbPath }));
ipcMain.handle('license:status', () => { const f=path.join(app.getPath('userData'),'license.json'); try { return verifyLicense(JSON.parse(fs.readFileSync(f,'utf8'))); } catch { return {ok:false,reason:'LICENSE_MISSING'}; } });
ipcMain.handle('license:install', async (_e,p={}) => { const session=guard(p.token,'settings','can_edit'); const source=String(p.source||''); if(!source) return {ok:false,message:'ملف الترخيص مطلوب'}; let lic; try { lic=JSON.parse(fs.readFileSync(source,'utf8')); } catch { return {ok:false,message:'ملف الترخيص غير صالح'}; } const v=verifyLicense(lic); if(!v.ok)return {ok:false,message:'رفض الترخيص: '+v.reason}; const target=path.join(app.getPath('userData'),'license.json'); const tmp=target+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(lic,null,2),'utf8'); fs.renameSync(tmp,target); audit(session.username,'INSTALL','license',target,{plan:v.plan,expiresAt:v.expiresAt}); return {ok:true,...v}; });
ipcMain.handle('update:verify', (_e,p={}) => verifyUpdateManifest(p.manifest, p.publicKeyPem || require('./license').PUBLIC_KEY_PEM));

ipcMain.handle('auth:login', (_e, payload = {}) => {
  try {
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!username || !password) return {ok:false, message:'أدخل اسم المستخدم وكلمة المرور'};
    const rows = all("SELECT u.id,u.username,u.password_hash,u.role_id,r.name role FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE lower(u.username)=lower(?) AND u.active=1", [username]);
    const u = rows[0];
    if (!u || !verifyPassword(password, u.password_hash)) return {ok:false, message:'اسم المستخدم أو كلمة المرور غير صحيحة'};
    const token=crypto.randomBytes(24).toString('hex');
    currentSessions.set(token,{id:u.id,username:u.username,role:u.role || 'User',role_id:u.role_id,createdAt:Date.now()});
    run("INSERT INTO audit_log(username,action,entity,new_value) VALUES (?,?,?,?)", [u.username,'login','session',new Date().toISOString()]);
    return {ok:true,token,user:{id:u.id,username:u.username,role:u.role || 'User'}};
  } catch (err) {
    console.error('Login failed:', err);
    return {ok:false, message:'تعذر تنفيذ تسجيل الدخول. أعد تشغيل البرنامج وحاول مرة أخرى.'};
  }
});
ipcMain.handle('portal:login', (_e,p={}) => { const no=String(p.employee_no||'').trim(); const password=String(p.password||''); if(!no||!password)return {ok:false,message:'رقم الموظف وكلمة المرور مطلوبان'}; const u=all("SELECT u.id,u.username,u.password_hash,u.role_id,r.name role,e.id employee_id,e.employee_no,e.full_name FROM users u JOIN employees e ON e.id=u.employee_id LEFT JOIN roles r ON r.id=u.role_id WHERE e.employee_no=? AND u.active=1",[no])[0]; if(!u||!verifyPassword(password,u.password_hash))return {ok:false,message:'بيانات دخول الموظف غير صحيحة'}; const token=crypto.randomBytes(24).toString('hex'); currentSessions.set(token,{id:u.id,username:u.username,role:u.role||'Employee',role_id:u.role_id,employee_id:u.employee_id,createdAt:Date.now(),portal:true}); audit(u.username,'login','employee_portal',u.employee_id,{employee_no:no}); return {ok:true,token,user:{id:u.id,username:u.username,role:u.role||'Employee',employee_id:u.employee_id,employee_no:u.employee_no,full_name:u.full_name}}; });
ipcMain.handle('auth:logout', (_e, token) => {
  const session=currentSessions.get(String(token||''));
  if(session) run("INSERT INTO audit_log(username,action,entity,new_value) VALUES (?,?,?,?)", [session.username,'logout','session',new Date().toISOString()]);
  currentSessions.delete(String(token||''));
  return {ok:true};
});
ipcMain.handle('auth:session', (_e, token) => currentSessions.get(String(token||'')) || null);
function requireSession(token){
  const s=currentSessions.get(String(token||''));
  if(!s) throw new Error('جلسة الدخول منتهية أو غير صالحة');
  return s;
}
function hasPermission(session,module,action){
  if(session.role==='Super Admin') return true;
  const row=all('SELECT * FROM permissions WHERE role_id=? AND module=?',[Number(session.role_id),module])[0];
  return !!(row && row[action]);
}
function audit(username,action,entity,entityId,data){ run('INSERT INTO audit_log(username,action,entity,entity_id,new_value) VALUES (?,?,?,?,?)',[username,action,entity,String(entityId||''),JSON.stringify(data||{})]); }
function guard(token,module,action='can_view'){
  const session=requireSession(token);
  if(!hasPermission(session,module,action)) throw new Error('ليست لديك صلاحية لتنفيذ هذا الإجراء');
  return session;
}


// Production CRUD: loans, deductions, settlements, documents, workflow and notifications.
ipcMain.handle('loans:list', (_e,p={}) => { const session=guard(p.token,'loans','can_view'); return all("SELECT l.*,e.employee_no,e.full_name,COALESCE((SELECT SUM(lp.amount) FROM loan_payments lp WHERE lp.loan_id=l.id),0) paid FROM loans l JOIN employees e ON e.id=l.employee_id ORDER BY l.id DESC"); });
ipcMain.handle('loans:add', (_e,p={}) => { const s=guard(p.token,'loans','can_add'); if(!p.employee_id||Number(p.amount)<=0||Number(p.installment)<=0)return {ok:false,message:'بيانات السلفة غير مكتملة'}; run("INSERT INTO loans(employee_id,amount,installment,remaining,start_date,status) VALUES (?,?,?,?,?, 'active')",[Number(p.employee_id),Number(p.amount),Number(p.installment),Number(p.amount),p.start_date||new Date().toISOString().slice(0,10)]); audit(s.username,'CREATE','loan',scalar('SELECT id FROM loans ORDER BY id DESC LIMIT 1'),p); return {ok:true}; });
ipcMain.handle('loans:pay', (_e,p={}) => { const s=guard(p.token,'loans','can_edit'); const l=all('SELECT * FROM loans WHERE id=?',[Number(p.loan_id)])[0]; if(!l)return {ok:false,message:'السلفة غير موجودة'}; const amount=Math.min(Number(p.amount)||0,Number(l.remaining)); if(amount<=0)return {ok:false,message:'قيمة القسط غير صحيحة'}; run('INSERT INTO loan_payments(loan_id,payment_date,amount,note) VALUES (?,?,?,?)',[l.id,p.payment_date||new Date().toISOString().slice(0,10),amount,p.note||'']); run("UPDATE loans SET remaining=?,status=? WHERE id=?",[Math.max(0,l.remaining-amount),l.remaining-amount<=0?'paid':'active',l.id]); audit(s.username,'PAYMENT','loan',l.id,{amount}); return {ok:true,remaining:Math.max(0,l.remaining-amount)}; });
ipcMain.handle('deductions:list', (_e,p={}) => { guard(p.token,'loans','can_view'); return all('SELECT d.*,e.employee_no,e.full_name FROM deductions d JOIN employees e ON e.id=d.employee_id ORDER BY d.id DESC'); });
ipcMain.handle('deductions:add', (_e,p={}) => { const s=guard(p.token,'loans','can_add'); if(!p.employee_id||Number(p.amount)<=0)return {ok:false,message:'بيانات الخصم غير مكتملة'}; run('INSERT INTO deductions(employee_id,kind,amount,recurring,installments_left) VALUES (?,?,?,?,?)',[Number(p.employee_id),p.kind||'خصم',Number(p.amount),p.recurring?1:0,Number(p.installments_left)||1]); audit(s.username,'CREATE','deduction',scalar('SELECT id FROM deductions ORDER BY id DESC LIMIT 1'),p); return {ok:true}; });
ipcMain.handle('settlements:calculate', (_e,p={}) => { const s=guard(p.token,'payroll','can_add'); const e=all('SELECT * FROM employees WHERE id=?',[Number(p.employee_id)])[0]; if(!e)return {ok:false,message:'الموظف غير موجود'}; const end=p.termination_date||new Date().toISOString().slice(0,10); const start=e.hire_date||end; const days=Math.max(0,Math.round((new Date(end)-new Date(start))/86400000)); const years=days/365; const salary=Number(e.basic_salary)||0; const earned=Number(p.earned_salary)||Math.min(salary, salary/30*(new Date(end).getDate()||30)); const leave=Number(p.leave_payout)||0; const deductions=Number(p.deductions)||0; const endService=Number(p.end_service)!=null&&p.end_service!==''?Number(p.end_service):Math.max(0, salary*(years<5?0.5:1)*Math.floor(years)); const net=earned+leave+endService-deductions; return {ok:true,calculation:{employee_id:e.id,termination_date:end,years:years.toFixed(2),earned_salary:earned,leave_payout:leave,end_service:endService,deductions,net}}; });
ipcMain.handle('settlements:save', (_e,p={}) => { const s=guard(p.token,'payroll','can_add'); const c=p.calculation||p; if(!c.employee_id||!c.termination_date)return {ok:false,message:'بيانات التسوية غير مكتملة'}; run('INSERT INTO settlements(employee_id,termination_date,reason,earned_salary,leave_payout,end_service,deductions,net,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',[c.employee_id,c.termination_date,p.reason||'',Number(c.earned_salary)||0,Number(c.leave_payout)||0,Number(c.end_service)||0,Number(c.deductions)||0,Number(c.net)||0,'draft',s.username]); return {ok:true,id:scalar('SELECT id FROM settlements ORDER BY id DESC LIMIT 1')}; });
ipcMain.handle('settlements:list', (_e,p={}) => { guard(p.token,'payroll','can_view'); return all('SELECT s.*,e.employee_no,e.full_name FROM settlements s JOIN employees e ON e.id=s.employee_id ORDER BY s.id DESC'); });
ipcMain.handle('settlements:approve', (_e,p={}) => { const s=guard(p.token,'payroll','can_approve'); const x=all('SELECT * FROM settlements WHERE id=?',[Number(p.id)])[0]; if(!x)return {ok:false,message:'التسوية غير موجودة'}; run("UPDATE settlements SET status='approved',approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[s.username,x.id]); audit(s.username,'APPROVE','settlement',x.id,{status:'approved'}); return {ok:true}; });
ipcMain.handle('documents:list', (_e,p={}) => { guard(p.token,'documents','can_view'); return all('SELECT d.*,e.employee_no,e.full_name FROM documents d JOIN employees e ON e.id=d.employee_id ORDER BY d.expiry_date ASC'); });
ipcMain.handle('documents:add', (_e,p={}) => { const s=guard(p.token,'documents','can_add'); if(!p.employee_id||!p.kind)return {ok:false,message:'بيانات الوثيقة غير مكتملة'}; run('INSERT INTO documents(employee_id,kind,file_name,expiry_date,notes) VALUES (?,?,?,?,?)',[Number(p.employee_id),p.kind,p.file_name||'',p.expiry_date||'',p.notes||'']); audit(s.username,'CREATE','document',scalar('SELECT id FROM documents ORDER BY id DESC LIMIT 1'),p); return {ok:true}; });
ipcMain.handle('workflow:list', (_e,p={}) => { guard(p.token,'permissions','can_view'); return all('SELECT * FROM workflow_requests ORDER BY id DESC'); });
ipcMain.handle('workflow:create', (_e,p={}) => { const s=guard(p.token,'permissions','can_add'); if(!p.entity_type||!p.entity_id)return {ok:false,message:'بيانات المعاملة غير مكتملة'}; run('INSERT INTO workflow_requests(entity_type,entity_id,stage,status,requested_by,assigned_to,note) VALUES (?,?,?,\'pending\',?,?,?)',[p.entity_type,Number(p.entity_id),p.stage||'HR',s.username,p.assigned_to||'',p.note||'']); return {ok:true,id:scalar('SELECT id FROM workflow_requests ORDER BY id DESC LIMIT 1')}; });
ipcMain.handle('workflow:decide', (_e,p={}) => { const s=guard(p.token,'permissions','can_approve'); const x=all('SELECT * FROM workflow_requests WHERE id=?',[Number(p.id)])[0]; if(!x)return {ok:false,message:'المعاملة غير موجودة'}; const status=['approved','rejected','returned'].includes(p.status)?p.status:'approved'; run('UPDATE workflow_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[status,x.id]); audit(s.username,status.toUpperCase(),'workflow',x.id,{note:p.note||''}); return {ok:true}; });
ipcMain.handle('notifications:list', (_e,p={}) => { const s=requireSession(p.token); return all('SELECT * FROM notifications WHERE username=? OR username IS NULL ORDER BY id DESC LIMIT 100',[s.username]); });
ipcMain.handle('notifications:readAll', (_e,p={}) => { const s=requireSession(p.token); run('UPDATE notifications SET is_read=1 WHERE username=? OR username IS NULL',[s.username]); return {ok:true}; });

ipcMain.handle('companies:list', (_e,p={}) => { guard(p.token,'org','can_view'); return all('SELECT * FROM companies ORDER BY name'); });
ipcMain.handle('branches:list', (_e,p={}) => { guard(p.token,'org','can_view'); return all('SELECT b.*,c.name company FROM branches b LEFT JOIN companies c ON c.id=b.company_id ORDER BY b.name'); });
ipcMain.handle('jobTitles:list', (_e,p={}) => { guard(p.token,'org','can_view'); return all('SELECT jt.*,c.name company FROM job_titles jt LEFT JOIN companies c ON c.id=jt.company_id ORDER BY jt.name'); });
ipcMain.handle('employees:list', (_e,p={}) => { guard(p.token,'employees','can_view'); return all("SELECT e.*,c.name company,b.name branch,d.name department,jt.name job_title_name FROM employees e LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles jt ON jt.id=e.job_title_id ORDER BY e.id DESC"); });
ipcMain.handle('employees:get', (_e,{id,token}) => { guard(token,'employees','can_view'); return all("SELECT e.*,c.name company,b.name branch,d.name department,jt.name job_title_name FROM employees e LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles jt ON jt.id=e.job_title_id WHERE e.id=?",[Number(id)])[0] || null; });
ipcMain.handle('employees:update', (_e,p={}) => { const s=guard(p.token,'employees','can_edit'); if(!p.id||!String(p.employee_no||'').trim()||!String(p.full_name||'').trim()) return {ok:false,message:'بيانات الموظف غير مكتملة'}; try { run("UPDATE employees SET employee_no=?,full_name=?,first_name=?,middle_name=?,last_name=?,national_id=?,gender=?,birth_date=?,nationality=?,marital_status=?,dependents=?,phone=?,email=?,address=?,emergency_phone=?,company_id=?,branch_id=?,department_id=?,job_title_id=?,job_title=?,manager_employee_id=?,hire_date=?,probation_end=?,contract_type=?,contract_end=?,basic_salary=?,housing_allowance=?,transport_allowance=?,other_allowances=?,social_security_no=?,bank_iban=?,status=?,termination_date=?,termination_reason=? WHERE id=?",[String(p.employee_no).trim(),String(p.full_name).trim(),p.first_name||'',p.middle_name||'',p.last_name||'',p.national_id||'',p.gender||'',p.birth_date||'',p.nationality||'',p.marital_status||'',Number(p.dependents)||0,p.phone||'',p.email||'',p.address||'',p.emergency_phone||'',p.company_id||null,p.branch_id||null,p.department_id||null,p.job_title_id||null,p.job_title||'',p.manager_employee_id||null,p.hire_date||'',p.probation_end||'',p.contract_type||'permanent',p.contract_end||'',Number(p.basic_salary)||0,Number(p.housing_allowance)||0,Number(p.transport_allowance)||0,Number(p.other_allowances)||0,p.social_security_no||'',p.bank_iban||'',p.status||'active',p.termination_date||'',p.termination_reason||'',Number(p.id)]); audit(s.username,'UPDATE','employee',p.id,p); return {ok:true}; } catch(err){ return {ok:false,message:err.message}; } });
ipcMain.handle('employees:delete', (_e,p={}) => { const s=guard(p.token,'employees','can_delete'); const id=Number(p.id); if(!id) return {ok:false,message:'معرّف الموظف غير صالح'}; const e=all('SELECT id,employee_no,full_name FROM employees WHERE id=?',[id])[0]; if(!e)return {ok:false,message:'الموظف غير موجود'}; run("UPDATE employees SET status='inactive',termination_date=COALESCE(NULLIF(termination_date,''),CURRENT_DATE),termination_reason=COALESCE(NULLIF(termination_reason,''),'تم إيقاف السجل إداريًا') WHERE id=?",[id]); audit(s.username,'DELETE','employee',id,{employee_no:e.employee_no,full_name:e.full_name,mode:'soft-delete'}); return {ok:true}; });
ipcMain.handle('employees:importCsv', async (_e,p={}) => { const session=guard(p.token,'employees','can_add'); const r=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'CSV UTF-8',extensions:['csv']}]}); if(r.canceled||!r.filePaths[0])return {ok:false,canceled:true}; const text=fs.readFileSync(r.filePaths[0],'utf8').replace(/^\ufeff/,''); const parseLine=line=>{const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){out.push(cur.trim());cur='';}else cur+=ch;}out.push(cur.trim());return out;}; const lines=text.split(/\r?\n/).filter(x=>x.trim()); if(lines.length<2)return {ok:false,message:'ملف CSV فارغ'}; const headers=parseLine(lines[0]).map(x=>x.toLowerCase()); const ix=n=>headers.indexOf(n); const ino=ix('employee_no')>=0?ix('employee_no'):ix('الرقم الوظيفي'); const iname=ix('full_name')>=0?ix('full_name'):ix('الاسم'); const isal=ix('basic_salary')>=0?ix('basic_salary'):ix('الراتب'); if(ino<0||iname<0)return {ok:false,message:'يجب أن يحتوي الملف على employee_no و full_name'}; let imported=0,updated=0,errors=0; for(let i=1;i<lines.length;i++){try{const c=parseLine(lines[i]);const no=c[ino],name=c[iname];if(!no||!name){errors++;continue;} const salary=isal>=0?Number(c[isal])||0:0; const existing=all('SELECT id FROM employees WHERE employee_no=?',[no])[0]; if(existing){run('UPDATE employees SET full_name=?,basic_salary=? WHERE id=?',[name,salary,existing.id]);updated++;}else{run('INSERT INTO employees(employee_no,full_name,basic_salary,status,hire_date) VALUES (?,?,?,?,?)',[no,name,salary,'active',new Date().toISOString().slice(0,10)]);imported++;}}catch{errors++;}} audit(session.username,'IMPORT','employees',path.basename(r.filePaths[0]),{imported,updated,errors}); return {ok:true,imported,updated,errors}; });


ipcMain.handle('employees:add', (_e,p={}) => { const s=guard(p.token,'employees','can_add'); if(!String(p.employee_no||'').trim()||!String(p.full_name||'').trim()) return {ok:false,message:'الرقم الوظيفي والاسم مطلوبان'}; try { run("INSERT INTO employees(employee_no,full_name,national_id,phone,department_id,job_title,hire_date,contract_end,basic_salary,status,company_id,branch_id,job_title_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",[String(p.employee_no).trim(),String(p.full_name).trim(),p.national_id||'',p.phone||'',p.department_id||null,p.job_title||'',p.hire_date||'',p.contract_end||'',Number(p.basic_salary)||0,'active',p.company_id||null,p.branch_id||null,p.job_title_id||null]); const employeeId=scalar('SELECT id FROM employees WHERE employee_no=?',[String(p.employee_no).trim()]); const year=new Date().getFullYear(); for(const lt of all('SELECT id,annual_entitlement FROM leave_types WHERE active=1')){if(!scalar('SELECT COUNT(*) AS c FROM leave_balances_v2 WHERE employee_id=? AND leave_type_id=? AND year=?',[employeeId,lt.id,year])) db.run('INSERT INTO leave_balances_v2(employee_id,leave_type_id,year,opening,earned,balance) VALUES (?,?,?,?,?,?)',[employeeId,lt.id,year,0,lt.annual_entitlement,lt.annual_entitlement]);} saveDb(); audit(s.username,'CREATE','employee',employeeId,p); return {ok:true,id:employeeId}; } catch(err){ return {ok:false,message:err.message}; } });
ipcMain.handle('departments:list', (_e,p={}) => { guard(p.token,'org','can_view'); return all('SELECT * FROM departments ORDER BY name'); });
ipcMain.handle('roles:list', (_e,p={}) => { guard(p.token,'permissions','can_view'); return all('SELECT id,name FROM roles ORDER BY id'); });
ipcMain.handle('users:list', (_e,p={}) => { guard(p.token,'users','can_view'); return all("SELECT u.id,u.username,u.active,r.name role FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY u.id DESC"); });
ipcMain.handle('permissions:list', (_e,p={}) => { guard(p.token,'permissions','can_view'); return all('SELECT * FROM permissions WHERE role_id=? ORDER BY module',[Number(p.roleId)]); });
ipcMain.handle('permissions:save', (_e,{token,roleId,module,permissions}) => { guard(token,'permissions','can_edit'); const p=permissions||{}; run('UPDATE permissions SET can_view=?,can_add=?,can_edit=?,can_delete=?,can_approve=?,can_export=? WHERE role_id=? AND module=?',[p.can_view?1:0,p.can_add?1:0,p.can_edit?1:0,p.can_delete?1:0,p.can_approve?1:0,p.can_export?1:0,Number(roleId),module]); return {ok:true}; });
ipcMain.handle('users:add', (_e,{token,username,password,roleId}) => { guard(token,'users','can_add'); if(!username||!password||!roleId) return {ok:false,message:'بيانات المستخدم ناقصة'}; try{ run('INSERT INTO users(username,password_hash,role_id) VALUES (?,?,?)',[username,hashPassword(password),Number(roleId)]); return {ok:true}; } catch(err){ return {ok:false,message:err.message}; } });
ipcMain.handle('users:toggle', (_e,{token,id,active}) => { guard(token,'users','can_edit'); run('UPDATE users SET active=? WHERE id=?',[active?1:0,Number(id)]); return {ok:true}; });
ipcMain.handle('audit:list', (_e,p={}) => { guard(p.token,'audit','can_view'); return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500'); });
ipcMain.handle('settings:get', (_e,p={}) => { guard(p.token,'settings','can_view'); return Object.fromEntries(all('SELECT key,value FROM settings').map(x=>[x.key,x.value])); });
ipcMain.handle('settings:set', (_e,{token,key,value}) => { guard(token,'settings','can_edit'); run("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,String(value)]); return {ok:true}; });
ipcMain.handle('backup:create', async (_e,p={}) => { const session=guard(p.token,'backup','can_export'); const dir=path.join(app.getPath('documents'),'HR-PRO-Backups'); fs.mkdirSync(dir,{recursive:true}); const defaultPath=path.join(dir,`HRPRO-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`); const {filePath,canceled}=await dialog.showSaveDialog({defaultPath,filters:[{name:'SQLite Database',extensions:['sqlite']}]}); if(canceled||!filePath) return {ok:false}; const bytes=Buffer.from(db.export()); const tmp=filePath+'.tmp'; fs.writeFileSync(tmp,bytes); fs.renameSync(tmp,filePath); run('INSERT INTO audit_log(username,action,entity,new_value) VALUES (?,?,?,?,?)'.replace('?,?,?,?,?','?,?,?,?'),[session.username,'backup:create','database',filePath]); return {ok:true,filePath}; });

ipcMain.handle('backup:restore', async (_e,p={}) => {
  const session=guard(p.token,'backup','can_export');
  const picked=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'SQLite Database',extensions:['sqlite','db']} ]});
  if(picked.canceled||!picked.filePaths[0]) return {ok:false,canceled:true};
  const source=picked.filePaths[0];
  try {
    const candidate=new SQL.Database(fs.readFileSync(source));
    const required=['users','roles','permissions','employees','payroll_runs','payroll_items','audit_log'];
    const names=new Set(allFrom(candidate,"SELECT name FROM sqlite_master WHERE type='table'").map(x=>x.name));
    const missing=required.filter(x=>!names.has(x));
    if(missing.length) { candidate.close(); return {ok:false,message:'ملف النسخة غير صالح. الجداول المطلوبة مفقودة: '+missing.join(', ')}; }
    const safety=path.join(app.getPath('documents'),'HR-PRO-Backups',`HRPRO-PRE-RESTORE-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
    fs.mkdirSync(path.dirname(safety),{recursive:true}); fs.writeFileSync(safety,Buffer.from(db.export()));
    db.close(); db=candidate; saveDb();
    currentSessions.clear();
    return {ok:true,filePath:source,safetyBackup:safety,relogin:true,user:session.username};
  } catch(err) { return {ok:false,message:'تعذر استعادة النسخة: '+String(err.message||err)}; }
});

function allFrom(database,sql,params=[]) { const stmt=database.prepare(sql); stmt.bind(params); const out=[]; while(stmt.step()) out.push(stmt.getAsObject()); stmt.free(); return out; }

function crc32(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;} function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;}
function zipStore(files){const local=[],central=[];let offset=0;for(const f of files){const name=Buffer.from(f.name),data=Buffer.isBuffer(f.data)?f.data:Buffer.from(f.data);const crc=crc32(data);const h=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]);local.push(h,data);const ch=Buffer.concat([Buffer.from([0x50,0x4b,0x01,0x02]),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);central.push(ch);offset+=h.length+data.length;}const c=Buffer.concat(central);return Buffer.concat([...local,c,Buffer.from([0x50,0x4b,0x05,0x06]),u16(0),u16(0),u16(files.length),u16(files.length),u32(c.length),u32(offset),u16(0)]);}
function xmlEscape(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function makeXlsx(columns,rows){
  const cols=columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.min(40,Math.max(10,String(c.label||c.key).length+4))}"/>`).join('');
  const head=columns.map((c,i)=>`<c r="${String.fromCharCode(65+i)}1" t="inlineStr"><is><t>${xmlEscape(c.label||c.key)}</t></is></c>`).join('');
  const body=rows.map((r,ri)=>`<row r="${ri+2}">${columns.map((c,i)=>{const v=r[c.key];const col=String.fromCharCode(65+i);if(v!==null&&v!==undefined&&v!==''&&!Number.isNaN(Number(v))&&String(v).trim()!==''&&/^-?\d+(\.\d+)?$/.test(String(v).trim())) return `<c r="${col}${ri+2}"><v>${xmlEscape(v)}</v></c>`;return `<c r="${col}${ri+2}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`;}).join('')}</row>`).join('');
  const files=[
   {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`},
   {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
   {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="HR PRO Report" sheetId="1" r:id="rId1"/></sheets></workbook>`},
   {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`},
   {name:'xl/worksheets/sheet1.xml',data:`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData><row r="1">${head}</row>${body}</sheetData></worksheet>`}
  ];return zipStore(files);
}

ipcMain.handle('report:csv', async (_e,p={}) => {
  const session=guard(p.token,'reports','can_export'); const rows=Array.isArray(p.rows)?p.rows:[]; const columns=Array.isArray(p.columns)?p.columns:[];
  if(!columns.length) return {ok:false,message:'لا توجد أعمدة للتصدير'};
  const esc=v=>'\"'+String(v??'').replace(/\"/g,'\"\"')+'\"';
  const csv='\ufeff'+[columns.map(c=>esc(c.label||c.key)).join(','),...rows.map(r=>columns.map(c=>esc(r[c.key])).join(','))].join('\r\n');
  const {filePath,canceled}=await dialog.showSaveDialog({defaultPath:path.join(app.getPath('documents'),`HRPRO-Report-${Date.now()}.csv`),filters:[{name:'CSV UTF-8',extensions:['csv']}]});
  if(canceled||!filePath)return {ok:false,canceled:true}; fs.writeFileSync(filePath,csv,'utf8'); run('INSERT INTO audit_log(username,action,entity,new_value) VALUES (?,?,?,?)',[session.username,'report:csv','report',filePath]); return {ok:true,filePath};
});

ipcMain.handle('report:excel', async (_e,p={}) => {
  const session=guard(p.token,'reports','can_export');
  const rows=Array.isArray(p.rows)?p.rows:[]; const columns=Array.isArray(p.columns)?p.columns:[];
  if(!columns.length) return {ok:false,message:'لا توجد أعمدة للتصدير'};
  const {filePath,canceled}=await dialog.showSaveDialog({defaultPath:path.join(app.getPath('documents'),`HRPRO-Report-${Date.now()}.xlsx`),filters:[{name:'Excel Workbook (*.xlsx)',extensions:['xlsx']}]});
  if(canceled||!filePath)return {ok:false,canceled:true};
  const tmp=filePath+'.tmp'; fs.writeFileSync(tmp,makeXlsx(columns,rows)); fs.renameSync(tmp,filePath);
  audit(session.username,'EXPORT','report',filePath,{format:'xlsx',rows:rows.length,columns:columns.length});
  return {ok:true,filePath};
});
ipcMain.handle('report:pdf', async (_e,p={}) => {
  const session=guard(p.token,'reports','can_export'); if(!mainWindow) return {ok:false,message:'نافذة البرنامج غير جاهزة'};
  const pdf=await mainWindow.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,margins:{marginType:'default'}});
  const {filePath,canceled}=await dialog.showSaveDialog({defaultPath:path.join(app.getPath('documents'),`HRPRO-Report-${Date.now()}.pdf`),filters:[{name:'PDF',extensions:['pdf']}]});
  if(canceled||!filePath)return {ok:false,canceled:true}; const tmp=filePath+'.tmp'; fs.writeFileSync(tmp,pdf); fs.renameSync(tmp,filePath); run('INSERT INTO audit_log(username,action,entity,new_value) VALUES (?,?,?,?)',[session.username,'report:pdf','report',filePath]); return {ok:true,filePath};
});
ipcMain.handle('db:path',()=>dbPath);


ipcMain.handle('shifts:list', (_e,p={}) => { guard(p.token,'attendance','can_view'); return all('SELECT s.*,c.name company FROM shifts s LEFT JOIN companies c ON c.id=s.company_id WHERE s.active=1 ORDER BY s.name'); });
ipcMain.handle('shifts:add', (_e,p={}) => { const s=guard(p.token,'attendance','can_add'); if(!p.name||!p.start_time||!p.end_time) return {ok:false,message:'اسم الوردية ووقت البداية والنهاية مطلوبة'}; run('INSERT INTO shifts(company_id,name,start_time,end_time,grace_minutes,break_minutes,weekly_hours) VALUES (?,?,?,?,?,?,?)',[p.company_id||null,p.name,p.start_time,p.end_time,Number(p.grace_minutes)||0,Number(p.break_minutes)||0,Number(p.weekly_hours)||48]); return {ok:true}; });
ipcMain.handle('employeeShifts:list', (_e,{employeeId}) => all('SELECT es.*,s.name shift_name,s.start_time,s.end_time FROM employee_shifts es JOIN shifts s ON s.id=es.shift_id WHERE es.employee_id=? AND es.active=1 ORDER BY es.effective_from DESC',[Number(employeeId)]));
ipcMain.handle('employeeShifts:assign', (_e,p={}) => { const s=guard(p.token,'attendance','can_edit'); run('UPDATE employee_shifts SET active=0,effective_to=? WHERE employee_id=? AND active=1',[p.effective_from,p.employee_id]); run('INSERT INTO employee_shifts(employee_id,shift_id,effective_from) VALUES (?,?,?)',[p.employee_id,p.shift_id,p.effective_from]); audit(s.username,'ASSIGN','employee_shift',p.employee_id,p); return {ok:true}; });
ipcMain.handle('attendance:list', (_e,{from,to,employeeId,token}={}) => { guard(token,'attendance','can_view'); let sql="SELECT a.*,e.employee_no,e.full_name FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.work_date BETWEEN ? AND ?"; const params=[from||'1900-01-01',to||'2999-12-31']; if(employeeId){sql+=' AND a.employee_id=?';params.push(Number(employeeId));} return all(sql+' ORDER BY a.work_date DESC,a.check_in DESC',params); });
ipcMain.handle('attendance:upsert', (_e,p={}) => { const s=guard(p.token,'attendance',Number(p.id)?'can_edit':'can_add'); const id=Number(p.id)||0; if(id) run('UPDATE attendance SET employee_id=?,work_date=?,check_in=?,check_out=?,late_minutes=?,overtime_minutes=?,status=? WHERE id=?',[p.employee_id,p.work_date,p.check_in||'',p.check_out||'',Number(p.late_minutes)||0,Number(p.overtime_minutes)||0,p.status||'present',id]); else run('INSERT INTO attendance(employee_id,work_date,check_in,check_out,late_minutes,overtime_minutes,status) VALUES (?,?,?,?,?,?,?)',[p.employee_id,p.work_date,p.check_in||'',p.check_out||'',Number(p.late_minutes)||0,Number(p.overtime_minutes)||0,p.status||'present']); audit(s,id?'UPDATE':'CREATE','attendance',id||scalar('SELECT id FROM attendance ORDER BY id DESC LIMIT 1'),p); return {ok:true}; });
ipcMain.handle('attendance:delete', (_e,{id,token}={}) => { const s=guard(token,'attendance','can_delete'); run('DELETE FROM attendance WHERE id=?',[Number(id)]); audit(s.username,'DELETE','attendance',id,{}); return {ok:true}; });
ipcMain.handle('attendance:importCsv', async (_e,p={}) => { const s=guard(p.token,'attendance','can_add'); const r=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'CSV',extensions:['csv']}]}); if(r.canceled||!r.filePaths[0]) return {ok:false}; const text=fs.readFileSync(r.filePaths[0],'utf8').replace(/^\ufeff/,''); const lines=text.split(/\r?\n/).filter(Boolean); let imported=0,errors=0; const map=all('SELECT id,employee_no FROM employees'); const byNo=Object.fromEntries(map.map(x=>[x.employee_no,x.id])); for(let i=1;i<lines.length;i++){const cols=lines[i].split(',').map(x=>x.trim().replace(/^"|"$/g,'')); const [employee_no,work_date,check_in,check_out,status]=cols; const employee_id=byNo[employee_no]; if(!employee_id||!work_date){errors++;continue;} try{db.run('INSERT INTO attendance(employee_id,work_date,check_in,check_out,status) VALUES (?,?,?,?,?)',[employee_id,work_date,check_in||'',check_out||'',status||'present']);imported++;}catch{errors++;}} db.run('INSERT INTO attendance_imports(source_name,rows_count,imported_count,errors_count) VALUES (?,?,?,?)',[path.basename(r.filePaths[0]),Math.max(0,lines.length-1),imported,errors]); saveDb(); return {ok:true,source:r.filePaths[0],imported,errors}; });
ipcMain.handle('attendance:settings',(_e,p={})=>{ guard(p.token,'attendance','can_view'); return all('SELECT * FROM attendance_settings WHERE id=1')[0]||{}; });
ipcMain.handle('attendance:settingsSave',(_e,p={})=>{ const s=guard(p.token,'attendance','can_edit'); run('INSERT INTO attendance_settings(id,auto_checkout,allow_manual,allow_edit,overtime_after_minutes,late_after_minutes,timezone) VALUES (1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET auto_checkout=excluded.auto_checkout,allow_manual=excluded.allow_manual,allow_edit=excluded.allow_edit,overtime_after_minutes=excluded.overtime_after_minutes,late_after_minutes=excluded.late_after_minutes,timezone=excluded.timezone',[p.auto_checkout?1:0,p.allow_manual?1:0,p.allow_edit?1:0,Number(p.overtime_after_minutes)||0,Number(p.late_after_minutes)||0,p.timezone||'Asia/Amman']);return {ok:true};});
ipcMain.handle('fingerprint:list',(_e,p={})=>{ guard(p.token,'attendance','can_view'); return all('SELECT * FROM fingerprint_devices ORDER BY id DESC'); });
ipcMain.handle('fingerprint:add',(_e,p={})=>{ const s=guard(p.token,'attendance','can_add'); if(!p.name)return {ok:false,message:'اسم الجهاز مطلوب'};run('INSERT INTO fingerprint_devices(name,device_type,ip_address,port,serial_no,branch_id,active) VALUES (?,?,?,?,?,?,1)',[p.name,p.device_type||'ZKTeco',p.ip_address||'',Number(p.port)||4370,p.serial_no||'',p.branch_id||null]);return {ok:true};});
ipcMain.handle('fingerprint:test', async (_e,p={}) => { guard(p.token,'attendance','can_view');
  const host=String(p.ip_address||p.host||'').trim(); const port=Number(p.port)||4370;
  if(!host)return {ok:false,message:'عنوان IP جهاز البصمة مطلوب'};
  return await new Promise(resolve=>{const socket=new net.Socket();let done=false;const finish=(r)=>{if(done)return;done=true;socket.destroy();resolve(r);};socket.setTimeout(3000);socket.once('connect',()=>finish({ok:true,message:`تم الاتصال بالشبكة مع جهاز البصمة ${host}:${port}.` ,host,port}));socket.once('timeout',()=>finish({ok:false,message:`انتهت مهلة الاتصال بـ ${host}:${port}`}));socket.once('error',e=>finish({ok:false,message:`فشل اتصال TCP بـ ${host}:${port}: ${e.message}`}));socket.connect(port,host);});
});
ipcMain.handle('leaveTypes:list',(_e,p={})=>{ guard(p.token,'leaves','can_view'); return all('SELECT * FROM leave_types WHERE active=1 ORDER BY id'); });
ipcMain.handle('leaveTypes:add',(_e,p={})=>{ const s=guard(p.token,'leaves','can_add'); if(!p.name)return {ok:false,message:'اسم نوع الإجازة مطلوب'};run('INSERT INTO leave_types(company_id,code,name,unit,annual_entitlement,paid,requires_document,carry_forward,max_carry_forward) VALUES (?,?,?,?,?,?,?,?,?)',[p.company_id||null,p.code||'',p.name,p.unit||'day',Number(p.annual_entitlement)||0,p.paid?1:0,p.requires_document?1:0,p.carry_forward?1:0,Number(p.max_carry_forward)||0]);return {ok:true};});
ipcMain.handle('leaveBalances:list',(_e,{year,employeeId,token}={})=>{ guard(token,'leaves','can_view');let sql='SELECT b.*,e.employee_no,e.full_name,l.name leave_type,l.code FROM leave_balances_v2 b JOIN employees e ON e.id=b.employee_id JOIN leave_types l ON l.id=b.leave_type_id WHERE b.year=?';const params=[Number(year)||new Date().getFullYear()];if(employeeId){sql+=' AND b.employee_id=?';params.push(Number(employeeId));}return all(sql+' ORDER BY e.full_name,l.name',params);});
ipcMain.handle('leaveBalances:adjust',(_e,p={})=>{ const s=guard(p.token,'leaves','can_edit');run('INSERT INTO leave_balances_v2(employee_id,leave_type_id,year,opening,earned,carried,used,pending,balance) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(employee_id,leave_type_id,year) DO UPDATE SET opening=excluded.opening,earned=excluded.earned,carried=excluded.carried,used=excluded.used,pending=excluded.pending,balance=excluded.balance',[p.employee_id,p.leave_type_id,Number(p.year)||new Date().getFullYear(),Number(p.opening)||0,Number(p.earned)||0,Number(p.carried)||0,Number(p.used)||0,Number(p.pending)||0,Number(p.balance)||0]);return {ok:true};});
ipcMain.handle('leaveRequests:list',(_e,{status,token}={})=>{ guard(token,'leaves','can_view');let sql='SELECT r.*,e.employee_no,e.full_name,l.name leave_type FROM leave_requests_v2 r JOIN employees e ON e.id=r.employee_id JOIN leave_types l ON l.id=r.leave_type_id';const params=[];if(status){sql+=' WHERE r.status=?';params.push(status);}return all(sql+' ORDER BY r.id DESC',params);});
ipcMain.handle('leaveRequests:add',(_e,p={})=>{ const s=guard(p.token,'leaves','can_add');if(!p.employee_id||!p.leave_type_id||!p.start_date||!p.end_date||Number(p.days)<=0)return {ok:false,message:'بيانات طلب الإجازة غير مكتملة'};const bal=all('SELECT * FROM leave_balances_v2 WHERE employee_id=? AND leave_type_id=? AND year=?',[p.employee_id,p.leave_type_id,new Date(p.start_date).getFullYear()])[0];if(bal && bal.balance<Number(p.days))return {ok:false,message:'رصيد الإجازة غير كافٍ'};run('INSERT INTO leave_requests_v2(employee_id,leave_type_id,start_date,end_date,days,reason,attachment_name,status) VALUES (?,?,?,?,?,?,?,\'pending\')',[p.employee_id,p.leave_type_id,p.start_date,p.end_date,Number(p.days),p.reason||'',p.attachment_name||'']); if(bal) run('UPDATE leave_balances_v2 SET pending=pending+?,balance=balance-? WHERE id=?',[Number(p.days),Number(p.days),bal.id]); return {ok:true};});
ipcMain.handle('leaveRequests:approve',(_e,{id,userId,token}={})=>{ const s=guard(token,'leaves','can_approve');const r=all('SELECT * FROM leave_requests_v2 WHERE id=?',[Number(id)])[0];if(!r)return {ok:false,message:'الطلب غير موجود'};if(r.status!=='pending')return {ok:false,message:'الطلب تمت معالجته سابقًا'};run("UPDATE leave_requests_v2 SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=?",[s.id,Number(id)]);audit(s.username,'APPROVE','leave_request',id,{days:r.days});run('UPDATE leave_balances_v2 SET pending=CASE WHEN pending>=? THEN pending-? ELSE 0 END,used=used+? WHERE employee_id=? AND leave_type_id=? AND year=?',[r.days,r.days,r.days,r.employee_id,r.leave_type_id,new Date(r.start_date).getFullYear()]);return {ok:true};});
ipcMain.handle('leaveRequests:reject',(_e,{id,reason,token}={})=>{ const s=guard(token,'leaves','can_approve');const r=all('SELECT * FROM leave_requests_v2 WHERE id=?',[Number(id)])[0];if(!r)return {ok:false,message:'الطلب غير موجود'};if(r.status!=='pending')return {ok:false,message:'الطلب تمت معالجته سابقًا'};run("UPDATE leave_requests_v2 SET status='rejected',rejection_reason=? WHERE id=?",[reason||'',Number(id)]);run('UPDATE leave_balances_v2 SET pending=CASE WHEN pending>=? THEN pending-? ELSE 0 END,balance=balance+? WHERE employee_id=? AND leave_type_id=? AND year=?',[r.days,r.days,r.days,r.employee_id,r.leave_type_id,new Date(r.start_date).getFullYear()]);audit(s.username,'REJECT','leave_request',id,{reason:reason||''});return {ok:true};});



function monthPeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw new Error('الفترة يجب أن تكون بصيغة YYYY-MM');
  return period;
}
function monthlyTaxFromAnnual(taxable, settings) {
  let remaining = Math.max(0, taxable);
  const b1=Math.max(0, Number(settings.tax_band1)||10000), r1=Math.max(0, Number(settings.tax_rate1)||0.07);
  const b2=Math.max(0, Number(settings.tax_band2)||10000), r2=Math.max(0, Number(settings.tax_rate2)||0.14), r3=Math.max(0, Number(settings.tax_rate3)||0.20);
  const x1=Math.min(remaining,b1); remaining-=x1;
  const x2=Math.min(remaining,b2); remaining-=x2;
  return x1*r1+x2*r2+remaining*r3;
}
function payrollCalc(period, employeeId) {
  const settings=all('SELECT * FROM payroll_settings WHERE id=1')[0] || {};
  const [yy,mm]=period.split('-').map(Number);
  const start=`${period}-01`;
  const end=new Date(Date.UTC(yy,mm,0)).toISOString().slice(0,10);
  const emp=all('SELECT * FROM employees WHERE id=? AND status=\'active\'',[employeeId])[0];
  if(!emp) throw new Error('الموظف غير موجود أو غير نشط');
  const overtimeMinutes=Number(scalar('SELECT COALESCE(SUM(overtime_minutes),0) FROM attendance WHERE employee_id=? AND work_date BETWEEN ? AND ?',[employeeId,start,end]))||0;
  const absentDays=Number(scalar("SELECT COALESCE(SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END),0) FROM attendance WHERE employee_id=? AND work_date BETWEEN ? AND ?",[employeeId,start,end]))||0;
  const approvedLeaveDays=Number(scalar("SELECT COALESCE(SUM(days),0) FROM leave_requests_v2 WHERE employee_id=? AND status='approved' AND start_date<=? AND end_date>=?",[employeeId,end,start]))||0;
  const basic=Number(emp.basic_salary)||0;
  const fixedAllowances=(Number(emp.housing_allowance)||0)+(Number(emp.transport_allowance)||0)+(Number(emp.other_allowances)||0);
  const hourlyRate=Number(settings.working_hours_month)>0?basic/Number(settings.working_hours_month):basic/208;
  const overtime=(overtimeMinutes/60)*hourlyRate*(Number(settings.overtime_multiplier)||1.5);
  const absenceDeduction=Math.max(0,absentDays*(basic/(Number(settings.unpaid_day_divisor)||30)));
  const adjustments=all('SELECT pa.amount,pc.component_type,pc.code,pc.taxable,pc.social_security FROM payroll_adjustments pa JOIN payroll_components pc ON pc.id=pa.component_id WHERE pa.employee_id=? AND pa.period=?',[employeeId,period]);
  let bonuses=0, otherDeductions=0;
  for(const a of adjustments){ if(a.component_type==='earning') bonuses+=Number(a.amount)||0; else otherDeductions+=Number(a.amount)||0; }
  const gross=basic+fixedAllowances+overtime+bonuses;
  let ssBase=gross; const min=Number(settings.ss_min_wage)||0,max=Number(settings.ss_max_wage)||0; if(min>0)ssBase=Math.max(ssBase,min); if(max>0)ssBase=Math.min(ssBase,max);
  const employeeSS=ssBase*(Number(settings.employee_ss_rate)||0);
  const employerSS=ssBase*(Number(settings.employer_ss_rate)||0);
  const annualExempt=(Number(settings.personal_exemption)||9000)+(Number(settings.dependent_exemption)||9000)*(Number(emp.dependents)||0);
  const annualTaxable=Math.max(0,(gross-employeeSS)*12-annualExempt);
  const annualTax=monthlyTaxFromAnnual(annualTaxable,settings);
  const tax=annualTax/12;
  const deductions=absenceDeduction+otherDeductions+employeeSS;
  const net=gross-deductions-tax;
  return {employee_id:employeeId,employee_no:emp.employee_no,full_name:emp.full_name,basic,allowances:fixedAllowances,overtime,bonuses,absence_deduction:absenceDeduction,other_deductions:otherDeductions,employee_ss:employeeSS,employer_ss:employerSS,taxable_annual:annualTaxable,tax,net,overtime_minutes:overtimeMinutes,absent_days:absentDays,approved_leave_days:approvedLeaveDays,gross};
}
ipcMain.handle('payroll:settings',(_e,p={})=>{ guard(p.token,'payroll','can_view'); return all('SELECT * FROM payroll_settings WHERE id=1')[0]||{}; });
ipcMain.handle('payroll:settingsSave',(_e,p={})=>{ const s=guard(p.token,'payroll','can_edit'); run(`INSERT INTO payroll_settings(id,employee_ss_rate,employer_ss_rate,ss_min_wage,ss_max_wage,personal_exemption,dependent_exemption,tax_band1,tax_rate1,tax_band2,tax_rate2,tax_rate3,working_hours_month,overtime_multiplier,holiday_overtime_multiplier,unpaid_day_divisor) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET employee_ss_rate=excluded.employee_ss_rate,employer_ss_rate=excluded.employer_ss_rate,ss_min_wage=excluded.ss_min_wage,ss_max_wage=excluded.ss_max_wage,personal_exemption=excluded.personal_exemption,dependent_exemption=excluded.dependent_exemption,tax_band1=excluded.tax_band1,tax_rate1=excluded.tax_rate1,tax_band2=excluded.tax_band2,tax_rate2=excluded.tax_rate2,tax_rate3=excluded.tax_rate3,working_hours_month=excluded.working_hours_month,overtime_multiplier=excluded.overtime_multiplier,holiday_overtime_multiplier=excluded.holiday_overtime_multiplier,unpaid_day_divisor=excluded.unpaid_day_divisor`,[Number(p.employee_ss_rate)||0,Number(p.employer_ss_rate)||0,Number(p.ss_min_wage)||0,Number(p.ss_max_wage)||0,Number(p.personal_exemption)||0,Number(p.dependent_exemption)||0,Number(p.tax_band1)||0,Number(p.tax_rate1)||0,Number(p.tax_band2)||0,Number(p.tax_rate2)||0,Number(p.tax_rate3)||0,Number(p.working_hours_month)||208,Number(p.overtime_multiplier)||1.5,Number(p.holiday_overtime_multiplier)||2,Number(p.unpaid_day_divisor)||30]);saveDb();audit(s.username,'UPDATE','payroll_settings',1,p); return {ok:true};});
ipcMain.handle('payroll:components',(_e,p={})=>{ guard(p.token,'payroll','can_view'); return all('SELECT * FROM payroll_components WHERE active=1 ORDER BY id'); });
ipcMain.handle('payroll:adjustmentAdd',(_e,p={})=>{ const s=guard(p.token,'payroll','can_add'); if(!p.employee_id||!p.component_id||!p.period)return {ok:false,message:'بيانات التعديل غير مكتملة'};run('INSERT INTO payroll_adjustments(employee_id,component_id,amount,period,note) VALUES (?,?,?,?,?)',[p.employee_id,p.component_id,Number(p.amount)||0,p.period,p.note||'']);return {ok:true};});
ipcMain.handle('payroll:preview',(_e,{period,token}={})=>{ guard(token,'payroll','can_view');period=monthPeriod(period);return all("SELECT id FROM employees WHERE status='active' ORDER BY id").map(e=>{try{return payrollCalc(period,e.id)}catch(err){return {employee_id:e.id,error:err.message}}});});
ipcMain.handle('payroll:run',(_e,{period,username,token}={})=>{ const s=guard(token,'payroll','can_add'); username=s.username;period=monthPeriod(period);const existing=all('SELECT * FROM payroll_runs WHERE period=?',[period])[0];if(existing && existing.status==='locked')return {ok:false,message:'مسير الرواتب مقفل ولا يمكن إعادة تشغيله'};let runId=existing?existing.id:null;if(!runId){run('INSERT INTO payroll_runs(period,status) VALUES (?,\'draft\')',[period]);runId=scalar('SELECT id FROM payroll_runs WHERE period=?',[period]);}
  run('DELETE FROM payroll_items WHERE run_id=?',[runId]); const results=all("SELECT id FROM employees WHERE status='active' ORDER BY id").map(e=>payrollCalc(period,e.id)); let gross=0,ded=0,ess=0,tax=0,net=0;
  for(const r of results){gross+=r.gross;ded+=r.absence_deduction+r.other_deductions+r.employee_ss;ess+=r.employee_ss;tax+=r.tax;net+=r.net;run('INSERT INTO payroll_items(run_id,employee_id,basic,allowances,overtime,bonuses,deductions,employee_ss,tax,net) VALUES (?,?,?,?,?,?,?,?,?,?)',[runId,r.employee_id,r.basic,r.allowances,r.overtime,r.bonuses,r.absence_deduction+r.other_deductions,r.employee_ss,r.tax,r.net]);}
  run('UPDATE payroll_runs SET gross=?,deductions=?,employee_ss=?,tax=?,net=?,status=\'calculated\' WHERE id=?',[gross,ded,ess,tax,net,runId]);run('INSERT INTO payroll_audit(run_id,action,username,details) VALUES (?,?,?,?)',[runId,'RUN',username||'',JSON.stringify({employees:results.length,gross,ded,ess,tax,net})]);saveDb();return {ok:true,runId,summary:{gross,deductions:ded,employee_ss:ess,tax,net,employees:results.length},items:results};
});
ipcMain.handle('payroll:runs',(_e,p={})=>{ guard(p.token,'payroll','can_view'); return all('SELECT * FROM payroll_runs ORDER BY period DESC'); });
ipcMain.handle('payroll:items',(_e,{runId,token}={})=>{ guard(token,'payroll','can_view'); return all('SELECT pi.*,e.employee_no,e.full_name FROM payroll_items pi JOIN employees e ON e.id=pi.employee_id WHERE pi.run_id=? ORDER BY e.full_name',[Number(runId)]); });
ipcMain.handle('payroll:lock',(_e,{runId,username,token}={})=>{ const s=guard(token,'payroll','can_edit'); username=s.username;const r=all('SELECT * FROM payroll_runs WHERE id=?',[Number(runId)])[0];if(!r)return {ok:false,message:'المسير غير موجود'};if(r.status==='locked')return {ok:true};run("UPDATE payroll_runs SET status='locked' WHERE id=?",[Number(runId)]);run('INSERT INTO payroll_audit(run_id,action,username,details) VALUES (?,?,?,?)',[runId,'LOCK',username||'', 'Payroll locked']);saveDb();return {ok:true};});
ipcMain.handle('payroll:unlock',(_e,{runId,username,token}={})=>{ const s=guard(token,'payroll','can_edit'); username=s.username;const r=all('SELECT * FROM payroll_runs WHERE id=?',[Number(runId)])[0];if(!r)return {ok:false,message:'المسير غير موجود'};run("UPDATE payroll_runs SET status='calculated' WHERE id=?",[Number(runId)]);run('INSERT INTO payroll_audit(run_id,action,username,details) VALUES (?,?,?,?)',[runId,'UNLOCK',username||'', 'Payroll reopened']);saveDb();return {ok:true};});


function notifyUser(username,title,body,type='info') {
  if(!username) return;
  run('INSERT INTO notifications(username,title,body,type,is_read) VALUES (?,?,?,?,0)',[username,String(title||''),String(body||''),type]);
}
function notifyEmployee(employeeId,title,body,type='info') {
  const users=all('SELECT username FROM users WHERE employee_id=? AND active=1',[Number(employeeId)]);
  users.forEach(u=>notifyUser(u.username,title,body,type));
}
function currentUsernameFromToken(token){ try{return currentSessions.get(String(token||''))?.username||'';}catch{return '';} }

ipcMain.handle('notifications:create', (_e,p={})=>{
  const s=guard(p.token,'dashboard','can_add');
  const username=String(p.username||'');
  if(!username||!String(p.title||'').trim()) return {ok:false,message:'اسم المستخدم والعنوان مطلوبان'};
  run('INSERT INTO notifications(username,title,body,type,is_read) VALUES (?,?,?,?,0)',[username,String(p.title),String(p.body||''),String(p.type||'info')]);
  const id=scalar('SELECT id FROM notifications ORDER BY id DESC LIMIT 1');
  audit(s.username,'CREATE','notification',id,p);
  return {ok:true,id};
});
ipcMain.handle('notifications:delete', (_e,p={})=>{const s=guard(p.token,'dashboard','can_delete');run('DELETE FROM notifications WHERE id=?',[Number(p.id)]);audit(s.username,'DELETE','notification',p.id,p);return {ok:true};});
ipcMain.handle('notifications:unreadCount', (_e,p={})=>{requireSession(p.token);const u=currentUsernameFromToken(p.token);return {count:Number(scalar('SELECT COUNT(*) FROM notifications WHERE username=? AND is_read=0',[u]))||0};});

ipcMain.handle('discipline:list', (_e,p={})=>{guard(p.token,'discipline','can_view');return all('SELECT d.*,e.employee_no,e.full_name FROM discipline_cases d JOIN employees e ON e.id=d.employee_id ORDER BY d.id DESC');});
ipcMain.handle('discipline:add', (_e,p={})=>{const s=guard(p.token,'discipline','can_add');if(!p.employee_id||!p.case_type||!p.incident_date)return {ok:false,message:'بيانات المخالفة غير مكتملة'};run('INSERT INTO discipline_cases(employee_id,case_type,severity,incident_date,description,action_taken,status,created_by) VALUES (?,?,?,?,?,?,?,?)',[Number(p.employee_id),p.case_type,p.severity||'medium',p.incident_date,p.description||'',p.action_taken||'',p.status||'open',s.username]);const id=scalar('SELECT id FROM discipline_cases ORDER BY id DESC LIMIT 1');audit(s.username,'CREATE','discipline',id,p);notifyEmployee(p.employee_id,'إجراء انضباطي جديد',`تم تسجيل ${p.case_type} بتاريخ ${p.incident_date}`,'warning');return {ok:true,id};});
ipcMain.handle('discipline:update', (_e,p={})=>{const s=guard(p.token,'discipline','can_edit');run('UPDATE discipline_cases SET case_type=?,severity=?,incident_date=?,description=?,action_taken=?,status=? WHERE id=?',[p.case_type,p.severity,p.incident_date,p.description||'',p.action_taken||'',p.status||'open',Number(p.id)]);audit(s.username,'UPDATE','discipline',p.id,p);return {ok:true};});
ipcMain.handle('discipline:delete', (_e,p={})=>{const s=guard(p.token,'discipline','can_delete');run('DELETE FROM discipline_cases WHERE id=?',[Number(p.id)]);audit(s.username,'DELETE','discipline',p.id,p);return {ok:true};});
ipcMain.handle('performance:list', (_e,p={})=>{guard(p.token,'discipline','can_view');return all('SELECT pr.*,e.employee_no,e.full_name FROM performance_reviews pr JOIN employees e ON e.id=pr.employee_id ORDER BY pr.id DESC');});
ipcMain.handle('performance:save', (_e,p={})=>{const s=guard(p.token,'discipline','can_add');if(!p.employee_id||!p.period)return {ok:false,message:'الموظف والفترة مطلوبان'};if(p.id)run('UPDATE performance_reviews SET score=?,strengths=?,improvements=?,comments=?,reviewer=?,status=? WHERE id=?',[Number(p.score)||0,p.strengths||'',p.improvements||'',p.comments||'',s.username,p.status||'draft',Number(p.id)]);else run('INSERT INTO performance_reviews(employee_id,period,score,strengths,improvements,comments,reviewer,status) VALUES (?,?,?,?,?,?,?,?)',[Number(p.employee_id),p.period,Number(p.score)||0,p.strengths||'',p.improvements||'',p.comments||'',s.username,p.status||'draft']);const id=p.id||scalar('SELECT id FROM performance_reviews ORDER BY id DESC LIMIT 1');audit(s.username,p.id?'UPDATE':'CREATE','performance_review',id,p);return {ok:true,id};});

ipcMain.handle('orgUnits:list', (_e,p={})=>{requireSession(p.token);return all('SELECT * FROM org_units ORDER BY unit_type,name');});
ipcMain.handle('orgUnits:save', (_e,p={})=>{const s=guard(p.token,'org','can_add');if(!p.name||!p.unit_type)return {ok:false,message:'اسم الوحدة ونوعها مطلوبان'};if(p.id)run('UPDATE org_units SET unit_type=?,parent_id=?,name=?,code=?,active=? WHERE id=?',[p.unit_type,p.parent_id||null,p.name,p.code||'',p.active===false?0:1,Number(p.id)]);else run('INSERT INTO org_units(unit_type,parent_id,name,code,active) VALUES (?,?,?,?,?)',[p.unit_type,p.parent_id||null,p.name,p.code||'',1]);const id=p.id||scalar('SELECT id FROM org_units ORDER BY id DESC LIMIT 1');audit(s.username,p.id?'UPDATE':'CREATE','org_unit',id,p);return {ok:true,id};});
ipcMain.handle('orgUnits:delete', (_e,p={})=>{const s=guard(p.token,'org','can_delete');run('DELETE FROM org_units WHERE id=?',[Number(p.id)]);audit(s.username,'DELETE','org_unit',p.id,p);return {ok:true};});

ipcMain.handle('documents:delete', (_e,p={})=>{const s=guard(p.token,'documents','can_delete');run('DELETE FROM documents WHERE id=?',[Number(p.id)]);audit(s.username,'DELETE','document',p.id,p);return {ok:true};});
ipcMain.handle('loans:delete', (_e,p={})=>{const s=guard(p.token,'loans','can_delete');run('DELETE FROM loans WHERE id=?',[Number(p.id)]);audit(s.username,'DELETE','loan',p.id,p);return {ok:true};});
ipcMain.handle('deductions:delete', (_e,p={})=>{const s=guard(p.token,'loans','can_delete');run('DELETE FROM deductions WHERE id=?',[Number(p.id)]);audit(s.username,'DELETE','deduction',p.id,p);return {ok:true};});
ipcMain.handle('reportTemplates:list', (_e,p={})=>{guard(p.token,'reports','can_view');return all('SELECT * FROM report_templates ORDER BY id DESC');});
ipcMain.handle('reportTemplates:save', (_e,p={})=>{const s=guard(p.token,'reports','can_add');if(!p.name)return {ok:false,message:'اسم القالب مطلوب'};if(p.id)run('UPDATE report_templates SET name=?,header=?,footer=?,watermark=?,paper=?,orientation=?,show_logo=?,show_page_numbers=? WHERE id=?',[p.name,p.header||'',p.footer||'',p.watermark||'',p.paper||'A4',p.orientation||'portrait',p.show_logo?1:0,p.show_page_numbers?1:0,Number(p.id)]);else run('INSERT INTO report_templates(name,header,footer,watermark,paper,orientation,show_logo,show_page_numbers) VALUES (?,?,?,?,?,?,?,?)',[p.name,p.header||'',p.footer||'',p.watermark||'',p.paper||'A4',p.orientation||'portrait',p.show_logo?1:0,p.show_page_numbers?1:0]);const id=p.id||scalar('SELECT id FROM report_templates ORDER BY id DESC LIMIT 1');audit(s.username,p.id?'UPDATE':'CREATE','report_template',id,p);return {ok:true,id};});

function createWindow(){ const win=new BrowserWindow({width:1480,height:940,minWidth:1100,minHeight:720,backgroundColor:'#fbf9fa',show:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,devTools:false,webSecurity:true,allowRunningInsecureContent:false}}); mainWindow=win; win.on('closed',()=>{if(mainWindow===win)mainWindow=null;}); win.webContents.setWindowOpenHandler(()=>({action:'deny'})); win.webContents.on('will-navigate',(event,url)=>{ if(!String(url).startsWith('file://')) event.preventDefault(); }); win.once('ready-to-show',()=>win.show()); win.loadFile(path.join(__dirname,'src','index.html')); }


ipcMain.handle('hr:data:list', (_e, name, filter={}) => { requireSession(filter.token); if(!hrData) throw new Error('خدمة البيانات غير مهيأة'); return hrData.list(name, filter); });
ipcMain.handle('hr:data:create', () => { throw new Error('مسار JSON القديم متوقف في الإصدار التجاري؛ استخدم SQLite'); });
ipcMain.handle('hr:data:update', () => { throw new Error('مسار JSON القديم متوقف في الإصدار التجاري؛ استخدم SQLite'); });
ipcMain.handle('hr:data:remove', () => { throw new Error('الحذف المباشر معطل في الإصدار التجاري'); });
ipcMain.handle('hr:data:health', (_e,token) => { requireSession(token); if(!hrData) throw new Error('خدمة البيانات غير مهيأة'); return hrData.health(); });
ipcMain.handle('hr:data:backup', () => { throw new Error('استخدم نسخ SQLite الاحتياطي من المسار الرسمي'); });
app.whenReady().then(async()=>{
  try {
    hrData = new HRDataService(app.getPath('userData'));
    await initDatabase();
    createWindow();
    app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
  } catch (err) {
    console.error('HR PRO startup failed:', err);
    dialog.showErrorBox('HR PRO - Startup Error', String(err && err.stack ? err.stack : err));
    app.quit();
  }
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
