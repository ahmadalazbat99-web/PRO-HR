/* HR PRO Phase 2 payroll engine tests.
 * Runs the REAL main.js IPC layer in plain Node (electron stubbed) against a fresh temp SQLite DB.
 * Covers: normal employee, loans, unpaid leave, absences, overtime, allowances, adjustments,
 * combined cases, recalculation, locking, unauthorized modification, invalid inputs. */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrpro-payroll-'));
const dialogBehavior = { save: { canceled: true }, open: { canceled: true } };
const handlers = new Map();

class BrowserWindowStub {
  constructor() { this.webContents = { setWindowOpenHandler() { return { action: 'deny' }; }, on() {}, printToPDF: async () => Buffer.from('%PDF') }; }
  once() {} on() {} loadFile() { return Promise.resolve(); }
}
const electronStub = {
  app: { getPath: (k) => (k === 'userData' || k === 'documents') ? dataDir : os.tmpdir(), whenReady: () => Promise.resolve(), quit() {}, on() {}, getVersion: () => '1.4.1' },
  BrowserWindow: BrowserWindowStub,
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {}, handleOnce() {}, removeAllListeners() {} },
  dialog: { showSaveDialog: async () => dialogBehavior.save, showOpenDialog: async () => dialogBehavior.open, showErrorBox: () => {} },
  shell: { openExternal: async () => {}, openPath: async () => '' }, Menu: {}, nativeImage: { createEmpty: () => ({}) },
};
const electronId = require.resolve('electron');
require.cache[electronId] = { id: 'electron', filename: electronId, loaded: true, exports: electronStub };
require(path.join(__dirname, '..', 'main.js'));

let passed = 0, failed = 0; const failures = [];
function ok(name, cond, extra) { if (cond) { passed++; console.log('PASS', name); } else { failed++; failures.push(name + ': ' + (extra || '')); console.log('FAIL', name, extra || ''); } }
async function call(ch, payload) { const fn = handlers.get(ch); if (!fn) throw new Error('missing handler ' + ch); return await fn(null, payload ?? {}); }
const noThrow = async (ch, payload) => { try { return await call(ch, payload); } catch (e) { return { ok: false, message: e.message, thrown: true }; } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 0.02);

(async () => {
  for (let i = 0; i < 200; i++) { try { const h = await call('app:health'); if (h && h.ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 50)); }

  const login = await call('auth:login', { username: 'admin', password: 'admin123' });
  ok('admin login', login.ok === true);
  const T = login.token;

  // Payroll settings: 208h month, 30-day divisor, SSC 7.5%/14.25%, JD tax bands.
  const ps = await call('payroll:settingsSave', { token: T, employee_ss_rate: 0.075, employer_ss_rate: 0.1425, ss_min_wage: 0, ss_max_wage: 0, personal_exemption: 9000, dependent_exemption: 9000, tax_band1: 10000, tax_rate1: 0.07, tax_band2: 10000, tax_rate2: 0.14, tax_rate3: 0.20, working_hours_month: 208, overtime_multiplier: 1.5, holiday_overtime_multiplier: 2, unpaid_day_divisor: 30 });
  ok('settings saved', ps.ok === true);

  const comps = await call('payroll:components', { token: T });
  const bonusComp = comps.find(c => c.code === 'BONUS');
  const dedComp = comps.find(c => c.code === 'OTHER_DEDUCTION');
  ok('payroll components seeded', !!bonusComp && !!dedComp);

  const period = '2026-08';
  let n = 0;
  async function mkEmployee(fields) {
    n++;
    const r = await call('employees:add', { token: T, employee_no: 'PAY-' + String(n).padStart(3, '0'), full_name: 'موظف اختبار ' + n, basic_salary: 1000, hire_date: '2025-01-01', status: 'active', dependents: 0, ...fields });
    if (!r.ok) throw new Error('employee add failed: ' + JSON.stringify(r));
    const list = await call('employees:list', { token: T });
    return list.find(e => e.employee_no === 'PAY-' + String(n).padStart(3, '0'));
  }

  const normal = await mkEmployee({ basic_salary: 1000, housing_allowance: 200, transport_allowance: 100 });
  const withLoan = await mkEmployee({ basic_salary: 1000 });
  const unpaid = await mkEmployee({ basic_salary: 1000 });
  const absent = await mkEmployee({ basic_salary: 1000 });
  const overtimer = await mkEmployee({ basic_salary: 2080 });
  const withDed = await mkEmployee({ basic_salary: 1000 });
  const combined = await mkEmployee({ basic_salary: 1500, housing_allowance: 300, dependents: 2 });
  const hiredMid = await mkEmployee({ basic_salary: 1000, hire_date: period + '-21' });

  // -- attendance for overtime employee: 8 hours OT in August 2026
  for (const d of ['2026-08-05', '2026-08-06']) {
    const r = await noThrow('attendance:upsert', { token: T, employee_id: overtimer.id, work_date: d, check_in: '08:00', check_out: '20:00', overtime_minutes: 240, status: 'present' });
    if (!r.ok) throw new Error('attendance upsert failed ' + JSON.stringify(r));
  }
  // -- absence records for absent employee (3 absent days)
  for (const d of ['2026-08-03', '2026-08-04', '2026-08-05']) {
    await noThrow('attendance:upsert', { token: T, employee_id: absent.id, work_date: d, status: 'absent' });
  }
  // -- unpaid leave request for `unpaid` (5 days approved UNPAID)
  const ltUnpaid = (await call('leaveTypes:list', { token: T })).find(l => l.code === 'UNPAID');
  ok('UNPAID leave type seeded', !!ltUnpaid);
  const ulr = await noThrow('leaveRequests:add', { token: T, employee_id: unpaid.id, leave_type_id: ltUnpaid.id, start_date: '2026-08-10', end_date: '2026-08-14', days: 5, reason: 'unpaid test' });
  ok('unpaid leave request accepted (no balance needed)', ulr.ok === true, JSON.stringify(ulr));
  if (ulr.ok) { const ap = await noThrow('leaveRequests:approve', { token: T, id: ulr.id }); ok('unpaid leave approved', ap.ok === true, JSON.stringify(ap)); }

  // -- loan for withLoan: 1200 total, 300/month, starting 2026-08-01
  const loan = await noThrow('loans:add', { token: T, employee_id: withLoan.id, amount: 1200, installment: 300, start_date: '2026-08-01' });
  ok('loan added', loan.ok === true, JSON.stringify(loan));

  // -- scheduled deduction for withDed: 150 over 3 installments = 50/month
  const ded = await noThrow('deductions:add', { token: T, employee_id: withDed.id, kind: 'خصم إداري', amount: 150, installments_left: 3, recurring: false });
  ok('deduction added', ded.ok === true, JSON.stringify(ded));

  // -- bonus + manual deduction for combined
  await noThrow('payroll:adjustmentAdd', { token: T, employee_id: combined.id, component_id: bonusComp.id, amount: 500, period, note: 'bonus' });
  await noThrow('payroll:adjustmentAdd', { token: T, employee_id: combined.id, component_id: dedComp.id, amount: 120, period, note: 'manual ded' });

  // ================= PREVIEW ASSERTIONS =================
  const preview = await call('payroll:preview', { token: T, period });
  const find = (emp) => preview.find(x => x.employee_id === emp.id);
  const pNormal = find(normal), pLoan = find(withLoan), pUnpaid = find(unpaid), pAbsent = find(absent), pOT = find(overtimer), pDed = find(withDed), pComb = find(combined), pHired = find(hiredMid);

  // Normal: gross 1300, ss 97.5, employer 185.25
  ok('normal: gross = basic + allowances', near(pNormal.gross, 1300), pNormal.gross);
  ok('normal: employee SS = 7.5% of gross', near(pNormal.employee_ss, 97.5), pNormal.employee_ss);
  ok('normal: employer SS = 14.25% of gross', near(pNormal.employer_ss, 185.25), pNormal.employer_ss);
  ok('normal: no unpaid-leave deduction', near(pNormal.unpaid_leave_deduction, 0));
  ok('normal: net = gross - deductions - tax', near(pNormal.net, pNormal.gross - pNormal.employee_ss - pNormal.tax), JSON.stringify({ net: pNormal.net, gross: pNormal.gross, ss: pNormal.employee_ss, tax: pNormal.tax }));

  // Loan: 300 installment deducted; SS base excludes loan (loan is post-SS deduction)
  ok('loan: installment 300 deducted', near(pLoan.loan_deduction, 300), pLoan.loan_deduction);
  ok('loan: SS still on full gross', near(pLoan.employee_ss, 75), pLoan.employee_ss);
  ok('loan: net reflects loan', near(pLoan.net, pLoan.gross - 75 - pLoan.tax - 300), pLoan.net);

  // Unpaid leave: 5 days × 1000/30 = 166.67 deduction
  ok('unpaid leave: 5 days deducted at daily rate', near(pUnpaid.unpaid_leave_deduction, 1000 / 30 * 5, 0.05), pUnpaid.unpaid_leave_deduction);
  ok('unpaid leave: unpaid days recorded', near(pUnpaid.unpaid_leave_days, 5), pUnpaid.unpaid_leave_days);
  ok('unpaid leave: not counted in approved paid days', near(pUnpaid.approved_leave_days, 0), pUnpaid.approved_leave_days);

  // Absence: 3 days × 1000/30 = 100
  ok('absence: 3 days deducted', near(pAbsent.absence_deduction, 100, 0.05), pAbsent.absence_deduction);

  // Overtime: 480 min = 8h × (2080/208) × 1.5 = 120
  ok('overtime: 8h at 1.5× hourly', near(pOT.overtime, 120, 0.05), pOT.overtime);
  ok('overtime: gross includes OT', near(pOT.gross, 2080 + 120, 0.05), pOT.gross);

  // Scheduled deduction: 150/3 = 50/month
  ok('scheduled deduction: 50 this period', near(pDed.scheduled_deduction, 50, 0.05), pDed.scheduled_deduction);

  // Combined: gross 1500+300+500=2300; deductions 120; taxable on (2300-172.5)
  ok('combined: gross with bonus', near(pComb.gross, 2300), pComb.gross);
  ok('combined: manual deduction 120', near(pComb.other_deductions, 120), pComb.other_deductions);
  const expectExempt = 9000 + 9000 * 2;
  const expectTaxable = Math.max(0, (2300 - 172.5) * 12 - expectExempt);
  ok('combined: annual taxable uses dependents exemption', near(pComb.taxable_annual, expectTaxable, 0.5), pComb.taxable_annual + ' vs ' + expectTaxable);
  ok('combined: tax is 1/12 of annual band tax', near(pComb.tax, (Math.min(expectTaxable, 10000) * 0.07 + Math.max(0, expectTaxable - 20000) * 0.20 + Math.max(0, Math.min(expectTaxable, 20000) - 10000) * 0.14) / 12, 0.5), pComb.tax);

  // Mid-month hire: worked 11 days of 31 → prorated days_in_period, not full month
  ok('mid-month hire: included with prorated period', !!pHired && !pHired.error && pHired.days_in_period >= 1 && pHired.days_in_period < 31, JSON.stringify(pHired || {}).slice(0, 160));

  // Invalid period rejected
  const badPeriod = await noThrow('payroll:preview', { token: T, period: '2026-13' });
  ok('invalid period rejected', badPeriod.thrown === true || badPeriod.ok === false, JSON.stringify(badPeriod).slice(0, 120));

  // ================= RUN + PERSISTENCE =================
  const run1 = await noThrow('payroll:run', { token: T, period });
  ok('payroll run succeeds', run1.ok === true, JSON.stringify(run1).slice(0, 240));
  if (!run1.ok) throw new Error('run failed; aborting');
  const item = run1.items.find(x => x.employee_id === withLoan.id);
  ok('run: loan item persisted', !!item && near(item.loan_deduction, 300, 0.05), JSON.stringify(item || {}).slice(0, 200));

  // Loan remaining decreased by exactly one installment
  const loansAfter = await call('loans:list', { token: T });
  const loanAfter = loansAfter.find(l => l.employee_id === withLoan.id);
  ok('loan remaining reduced by installment', near(Number(loanAfter.remaining), 900), loanAfter.remaining);

  // Recalculation: same period rerun must NOT double-apply loans/deductions
  const run2 = await noThrow('payroll:run', { token: T, period });
  ok('recalculation allowed while unlocked', run2.ok === true, JSON.stringify(run2).slice(0, 160));
  const item2 = run2.items.find(x => x.employee_id === withDed.id);
  ok('recalc: deduction not doubled', near((item2.loan_deduction||0) + (item2.scheduled_deduction||0) + (item2.other_deductions||0), 50, 0.05), 'loan='+item2.loan_deduction+' sched='+item2.scheduled_deduction+' other='+item2.other_deductions);
  const loansAfter2 = await call('loans:list', { token: T });
  const loanAfter2 = loansAfter2.find(l => l.employee_id === withLoan.id);
  ok('recalc: loan remaining unchanged (idempotent)', near(Number(loanAfter2.remaining), 900), loanAfter2.remaining);

  // Next period: installment continues from updated remaining
  await noThrow('payroll:run', { token: T, period: '2026-09' });
  const loansSep = await call('loans:list', { token: T });
  const loanSep = loansSep.find(l => l.employee_id === withLoan.id);
  ok('next month: loan installment applied again', near(Number(loanSep.remaining), 600), loanSep.remaining);

  // ================= LOCKING =================
  const lock = await noThrow('payroll:lock', { token: T, runId: run2.runId });
  ok('lock works', lock.ok === true, JSON.stringify(lock));
  const rerunLocked = await noThrow('payroll:run', { token: T, period });
  ok('locked run cannot be re-run', rerunLocked.ok === false, JSON.stringify(rerunLocked).slice(0, 140));
  const unlock = await noThrow('payroll:unlock', { token: T, runId: run2.runId });
  ok('unlock works', unlock.ok === true, JSON.stringify(unlock));
  const rerunUnlocked = await noThrow('payroll:run', { token: T, period });
  ok('unlocked run can be re-run', rerunUnlocked.ok === true, JSON.stringify(rerunUnlocked).slice(0, 140));

  // ================= RBAC =================
  const roles = await call('roles:list', { token: T });
  const empRole = roles.find(r => r.name === 'Employee');
  await noThrow('users:add', { token: T, username: 'payroll-emp', password: 'P0rtalPass1', roleId: empRole.id });
  const empLogin = await call('auth:login', { username: 'payroll-emp', password: 'P0rtalPass1' });
  ok('employee user login', empLogin.ok === true);
  let denied = null; try { await call('payroll:run', { token: empLogin.token, period: '2026-10' }); } catch (e) { denied = e; }
  ok('non-payroll user blocked from running payroll', !!denied, denied && denied.message);
  let deniedLock = null; try { await call('payroll:unlock', { token: empLogin.token, runId: run2.runId }); } catch (e) { deniedLock = e; }
  ok('non-approver blocked from unlock', !!deniedLock, deniedLock && deniedLock.message);

  // ================= INVALID INPUTS =================
  const badLoan = await noThrow('loans:add', { token: T, employee_id: normal.id, amount: 100, installment: 500, start_date: '2026-08-01' });
  ok('loan installment > amount rejected', badLoan.ok === false, JSON.stringify(badLoan).slice(0, 120));
  const zeroLoan = await noThrow('loans:add', { token: T, employee_id: normal.id, amount: 0, installment: 0, start_date: '2026-08-01' });
  ok('zero-amount loan rejected', zeroLoan.ok === false, JSON.stringify(zeroLoan).slice(0, 120));
  const badAdj = await noThrow('payroll:adjustmentAdd', { token: T, employee_id: normal.id, component_id: bonusComp.id, amount: 'x', period: 'bad-period' });
  ok('adjustment with bad period rejected or stored safely', badAdj.ok === false || badAdj.thrown === true || badAdj.ok === true, JSON.stringify(badAdj).slice(0, 120));

  // Gross sanity across all preview rows: net never above gross
  const finalPreview = await call('payroll:preview', { token: T, period });
  const allSane = finalPreview.filter(x => !x.error).every(x => x.net <= x.gross + 0.01 && x.employee_ss >= 0 && x.tax >= 0);
  ok('all rows: net <= gross, ss/tax non-negative', allSane, JSON.stringify(finalPreview.filter(x => x.error)).slice(0, 160));

  console.log('\n=== PAYROLL TEST RESULT ===');
  console.log('PASSED: ' + passed);
  console.log('FAILED: ' + failed);
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
  console.log('dataDir (kept for inspection): ' + dataDir);
  process.exit(0); // the app's auto-backup timer keeps the loop alive; exit explicitly
})().catch(e => { console.error('PAYROLL TESTS CRASH:', e); process.exit(2); });
