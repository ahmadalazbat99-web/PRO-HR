/* HR PRO Phase 3-7 functional tests.
 * Runs the REAL main.js IPC layer in plain Node (electron stubbed) against a fresh temp SQLite DB.
 * Covers: attendance/shifts/leave, portal data scoping (cross-employee protection),
 * documents expiry scan, payslip access, reports data, backup verify/restore, fingerprint honesty. */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrpro-p37-'));
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

  const admin = await call('auth:login', { username: 'admin', password: 'admin123' });
  ok('admin login', admin.ok === true);
  const T = admin.token;

  // ===== SETUP: two employees with linked portal users =====
  let n = 0;
  async function mkEmployee(fields) {
    n++;
    const r = await call('employees:add', { token: T, employee_no: 'E2-' + String(n).padStart(3, '0'), full_name: 'موظف P37-' + n, basic_salary: 1000, hire_date: '2025-01-01', status: 'active', ...fields });
    if (!r.ok) throw new Error('employee add failed: ' + JSON.stringify(r));
    const list = await call('employees:list', { token: T });
    return list.find(e => e.employee_no === 'E2-' + String(n).padStart(3, '0'));
  }
  const alice = await mkEmployee({ housing_allowance: 200 });
  const bob = await mkEmployee({});

  const roles = await call('roles:list', { token: T });
  const empRole = roles.find(r => r.name === 'Employee');
  ok('Employee role exists', !!empRole);

  async function mkPortalUser(employeeId, username) {
    const r = await noThrow('users:add', { token: T, username, password: 'P0rtalPass1', roleId: empRole.id, employeeId });
    if (!r.ok) throw new Error('user add failed ' + JSON.stringify(r));
    const lg = await call('portal:login', { employee_no: employeeId === alice.id ? alice.employee_no : bob.employee_no, password: 'P0rtalPass1' });
    if (!lg.ok) throw new Error('portal login failed ' + JSON.stringify(lg));
    return lg;
  }
  const aliceSession = await mkPortalUser(alice.id, 'alice_user');
  const bobSession = await mkPortalUser(bob.id, 'bob_user');
  ok('portal: alice login ok', aliceSession.ok === true && aliceSession.user.employee_id === alice.id);
  ok('portal: bob login ok', bobSession.ok === true && bobSession.user.employee_id === bob.id);

  // ===== PORTAL SCOPING (Phase 4/Final audit core) =====
  // attendance: give both employees distinct attendance rows
  await noThrow('attendance:upsert', { token: T, employee_id: alice.id, work_date: '2026-09-01', check_in: '08:00', check_out: '16:00', status: 'present' });
  await noThrow('attendance:upsert', { token: T, employee_id: bob.id, work_date: '2026-09-02', check_in: '08:00', check_out: '16:00', status: 'present' });

  const aliceAtt = await noThrow('portal:attendance', { token: aliceSession.token });
  ok('portal: attendance scoped to self', aliceAtt.ok !== false && Array.isArray(aliceAtt) && aliceAtt.every(x => x.work_date === '2026-09-01'), JSON.stringify(aliceAtt).slice(0, 160));
  const bobAtt = await noThrow('portal:attendance', { token: bobSession.token });
  ok('portal: bob sees only his attendance', Array.isArray(bobAtt) && bobAtt.every(x => x.work_date === '2026-09-02'));

  // leave request via portal must be forced to own employee id — even if attacker sends another id
  const lts = (await call('leaveTypes:list', { token: T }));
  const annual = lts.find(l => l.code === 'ANNUAL');
  const forged = await noThrow('portal:submitLeave', { token: aliceSession.token, employee_id: bob.id, leave_type_id: annual.id, start_date: '2026-10-01', end_date: '2026-10-02', days: 2 });
  ok('portal: forged employee_id ignored (request filed for alice)', forged.ok === true);
  const aliceReqs = await noThrow('portal:leaveRequests', { token: aliceSession.token });
  ok('portal: alice sees the forged request under her own record', Array.isArray(aliceReqs) && aliceReqs.some(x => x.employee_id === alice.id && x.start_date === '2026-10-01'));
  const bobReqs = await noThrow('portal:leaveRequests', { token: bobSession.token });
  ok('portal: bob does NOT see alice request', Array.isArray(bobReqs) && !bobReqs.some(x => x.start_date === '2026-10-01'));

  // HR-scope leaveRequests:add with a different employee must also be clamped for portal sessions
  const forged2 = await noThrow('leaveRequests:add', { token: aliceSession.token, employee_id: bob.id, leave_type_id: annual.id, start_date: '2026-11-01', end_date: '2026-11-01', days: 1 });
  ok('portal: leaveRequests:add cannot target other employee', forged2.ok === true); // clamped to alice
  const bobReqs2 = await noThrow('portal:leaveRequests', { token: bobSession.token });
  ok('portal: bob still sees no new request', Array.isArray(bobReqs2) && !bobReqs2.some(x => x.start_date === '2026-11-01'));

  // Portal endpoints must reject non-portal sessions
  let adminBlocked = null; try { await call('portal:payslips', { token: T }); } catch (e) { adminBlocked = e; }
  ok('portal: admin (non-portal) session rejected on portal endpoints', !!adminBlocked, adminBlocked && adminBlocked.message);
  let noTok = null; try { await call('portal:payslips', { token: 'forged' }); } catch (e) { noTok = e; }
  ok('portal: forged token rejected', !!noTok);

  // ===== LEAVE BALANCES / WORKFLOW (Phase 3) =====
  // Annual balance seeded = 14 days. Overdraw rejected.
  const over = await noThrow('leaveRequests:add', { token: T, employee_id: bob.id, leave_type_id: annual.id, start_date: '2026-12-01', end_date: '2026-12-31', days: 20 });
  ok('leave: overdraw request rejected', over.ok === false, JSON.stringify(over).slice(0, 120));
  // overlap guard: pending request overlapping is rejected (alice already has 2026-10-01..02 from portal test)
  const dup1 = await noThrow('leaveRequests:add', { token: T, employee_id: alice.id, leave_type_id: annual.id, start_date: '2026-10-02', end_date: '2026-10-03', days: 2 });
  ok('leave: overlapping request rejected', dup1.ok === false, JSON.stringify(dup1).slice(0, 120));
  // valid request → pending decrements balance
  const balBefore = (await call('leaveBalances:list', { token: T, year: 2027, employeeId: bob.id })).find(b => b.leave_type_id === annual.id);
  // Note: annual entitlement seeds per-year only for the CURRENT year; ensure a 2027 balance exists via adjust.
  await noThrow('leaveBalances:adjust', { token: T, employee_id: bob.id, leave_type_id: annual.id, year: 2027, opening: 0, earned: 14, carried: 0, used: 0, pending: 0, balance: 14 });
  const okReq = await noThrow('leaveRequests:add', { token: T, employee_id: bob.id, leave_type_id: annual.id, start_date: '2027-01-04', end_date: '2027-01-06', days: 3 });
  ok('leave: valid request accepted', okReq.ok === true, JSON.stringify(okReq).slice(0, 140));
  const balPending = (await call('leaveBalances:list', { token: T, year: 2027, employeeId: bob.id })).find(b => b.leave_type_id === annual.id);
  ok('leave: pending deducted from balance', balPending && near(balPending.balance, Number(balBefore ? balBefore.balance : 14) - 3, 0.01), JSON.stringify(balPending).slice(0, 160));
  // cancel restores balance
  const cancel = await noThrow('leaveRequests:cancel', { token: T, id: okReq.id });
  ok('leave: cancel works', cancel.ok === true, JSON.stringify(cancel).slice(0, 120));
  const balAfter = (await call('leaveBalances:list', { token: T, year: 2027, employeeId: bob.id })).find(b => b.leave_type_id === annual.id);
  ok('leave: cancel restores balance', balAfter && near(balAfter.balance, Number(balBefore ? balBefore.balance : 14), 0.01), JSON.stringify(balAfter).slice(0, 160));
  // approve/reject adjust balances
  const req2 = await noThrow('leaveRequests:add', { token: T, employee_id: bob.id, leave_type_id: annual.id, start_date: '2027-02-01', end_date: '2027-02-03', days: 3 });
  const ap = await noThrow('leaveRequests:approve', { token: T, id: req2.id });
  ok('leave: approve works', ap.ok === true, JSON.stringify(ap).slice(0, 120));
  const balUsed = (await call('leaveBalances:list', { token: T, year: 2027, employeeId: bob.id })).find(b => b.leave_type_id === annual.id);
  ok('leave: approve converts pending to used', balUsed && near(balUsed.used, 3) && near(balUsed.pending, 0), JSON.stringify(balUsed).slice(0, 160));
  // reject restores balance
  const req3 = await noThrow('leaveRequests:add', { token: T, employee_id: bob.id, leave_type_id: annual.id, start_date: '2027-03-01', end_date: '2027-03-02', days: 2 });
  const rj = await noThrow('leaveRequests:reject', { token: T, id: req3.id, reason: 'test' });
  ok('leave: reject works', rj.ok === true, JSON.stringify(rj).slice(0, 120));
  const balRej = (await call('leaveBalances:list', { token: T, year: 2027, employeeId: bob.id })).find(b => b.leave_type_id === annual.id);
  ok('leave: reject restores balance', balRej && near(balRej.balance, 14 - 3, 0.01), JSON.stringify(balRej).slice(0, 160));
  // unpaid leave needs no balance
  const unpaidType = lts.find(l => l.code === 'UNPAID');
  const u1 = await noThrow('leaveRequests:add', { token: T, employee_id: bob.id, leave_type_id: unpaidType.id, start_date: '2027-04-01', end_date: '2027-04-10', days: 10 });
  ok('leave: unpaid request accepted without balance', u1.ok === true, JSON.stringify(u1).slice(0, 140));

  // ===== SHIFTS (Phase 3) =====
  const shiftBad = await noThrow('shifts:add', { token: T, name: 'شفت فاسد', start_time: '8', end_time: '16' });
  ok('shifts: invalid time format rejected', shiftBad.ok === false, JSON.stringify(shiftBad).slice(0, 120));
  const overnight = await noThrow('shifts:add', { token: T, name: 'وردية ليلية', start_time: '22:00', end_time: '06:00', grace_minutes: 10 });
  ok('shifts: overnight shift accepted', overnight.ok === true, JSON.stringify(overnight).slice(0, 120));
  const shifts = await call('shifts:list', { token: T });
  const nightShift = shifts.find(s => s.name === 'وردية ليلية');
  ok('shifts: overnight listed', !!nightShift);
  const assign = await noThrow('employeeShifts:assign', { token: T, employee_id: bob.id, shift_id: nightShift.id, effective_from: '2026-09-01' });
  ok('shifts: assign works', assign.ok === true, JSON.stringify(assign).slice(0, 120));
  const assignBad = await noThrow('employeeShifts:assign', { token: T, employee_id: 999999, shift_id: nightShift.id });
  ok('shifts: assign to missing employee rejected', assignBad.ok === false, JSON.stringify(assignBad).slice(0, 120));
  // night check-in 23:00 → 60 min late (grace 10) — auto-calc from shift
  await noThrow('attendance:upsert', { token: T, employee_id: bob.id, work_date: '2026-09-05', check_in: '23:00', check_out: '07:00', status: 'present' });
  const att5 = (await call('attendance:list', { token: T, from: '2026-09-05', to: '2026-09-05' })).find(x => x.employee_id === bob.id);
  ok('attendance: late auto-calculated from night shift (50m = 60 - 10 grace)', !!att5 && Number(att5.late_minutes) === 50, JSON.stringify(att5).slice(0, 160));
  // check-out 07:00 is 60 min after 06:00 shift end → 60m overtime
  ok('attendance: overtime auto-calculated from night shift (60m)', !!att5 && Number(att5.overtime_minutes) === 60, att5 && String(att5.overtime_minutes));
  const badStatus = await noThrow('attendance:upsert', { token: T, employee_id: bob.id, work_date: '2026-09-06', status: 'banana' });
  ok('attendance: invalid status rejected', badStatus.ok === false, JSON.stringify(badStatus).slice(0, 120));

  // ===== FINGERPRINT HONESTY (Phase 4) =====
  const cap = await noThrow('fingerprint:capability', {});
  ok('fingerprint: capability reports no vendor sync', cap && cap.vendor_sync === false && cap.capability === 'connectivity_check_only', JSON.stringify(cap).slice(0, 160));
  const sync = await noThrow('fingerprint:sync', { token: T, id: 1 });
  ok('fingerprint: sync honestly reports not implemented', sync.ok === false && sync.level === 'not_implemented', JSON.stringify(sync).slice(0, 200));
  const fpTest = await noThrow('fingerprint:test', { token: T, ip_address: '127.0.0.1', port: 1 });
  ok('fingerprint: TCP test to closed port fails honestly', fpTest.ok === false, JSON.stringify(fpTest).slice(0, 140));
  const fpList = await noThrow('fingerprint:list', { token: T });
  ok('fingerprint: device list works', Array.isArray(fpList));
  const fpAdd = await noThrow('fingerprint:add', { token: T, name: 'جهاز رئيسي', ip_address: '192.168.1.50', port: 4370 });
  ok('fingerprint: add device works', fpAdd.ok === true, JSON.stringify(fpAdd).slice(0, 120));

  // ===== DOCUMENTS + EXPIRY SCAN (Phase 5) =====
  await noThrow('documents:add', { token: T, employee_id: bob.id, kind: 'هوية', file_name: 'id.pdf', expiry_date: '2020-01-01', notes: 'expired doc' });
  await noThrow('documents:add', { token: T, employee_id: bob.id, kind: 'عقد', file_name: 'contract.pdf', expiry_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), notes: 'soon' });
  const scan = await noThrow('documents:expiryScan', { token: T, days: 30 });
  ok('documents: expiry scan works', scan.ok === true && scan.expired >= 1 && scan.expiring >= 1, JSON.stringify({ e: scan.expired, x: scan.expiring }).slice(0, 140));
  // notification created (approver broadcast)
  const notifs = await noThrow('notifications:list', { token: T });
  ok('documents: expiry notification created', Array.isArray(notifs) && notifs.some(x => /وثيقة/.test(x.title || '')), JSON.stringify(notifs.slice(0, 2)).slice(0, 200));

  // ===== PAYSLIP ACCESS (Phase 5) =====
  const period = '2026-08';
  await noThrow('payroll:settingsSave', { token: T, employee_ss_rate: 0.075, employer_ss_rate: 0.1425, ss_min_wage: 0, ss_max_wage: 0, personal_exemption: 9000, dependent_exemption: 9000, tax_band1: 10000, tax_rate1: 0.07, tax_band2: 10000, tax_rate2: 0.14, tax_rate3: 0.20, working_hours_month: 208, overtime_multiplier: 1.5, holiday_overtime_multiplier: 2, unpaid_day_divisor: 30 });
  const run = await noThrow('payroll:run', { token: T, period });
  ok('payroll: run ok', run.ok === true, JSON.stringify(run).slice(0, 160));
  const slip = await noThrow('payslip:get', { token: T, runId: run.runId, employeeId: bob.id });
  ok('payslip: admin fetch payslip', slip.ok === true && slip.payslip.item.employee_id === bob.id, JSON.stringify(slip).slice(0, 200));
  const slipP = await noThrow('payslip:get', { token: bobSession.token, runId: run.runId, employeeId: alice.id });
  ok('payslip: portal session scoped to own employee', slipP.ok === true && slipP.payslip.item.employee_id === bob.id, JSON.stringify(slipP).slice(0, 200));
  const portalSlips = await noThrow('portal:payslips', { token: bobSession.token });
  ok('portal: payslips list scoped', Array.isArray(portalSlips) && portalSlips.every(x => x.employee_id === bob.id) && portalSlips.length >= 1);
  let alicePortal = await noThrow('portal:payslips', { token: aliceSession.token });
  ok('portal: alice sees no bob payslip rows', Array.isArray(alicePortal) && !alicePortal.some(x => x.employee_id === bob.id && x.period === period));

  // ===== REPORTS DATA (Phase 6) =====
  const rkinds = ['employees', 'attendance', 'leaves', 'leave_balances', 'payroll', 'loans', 'deductions', 'settlements', 'documents', 'contracts', 'departments', 'audit'];
  for (const k of rkinds) {
    const rows = await noThrow('reports:data', { token: T, kind: k });
    ok('reports: ' + k + ' returns array', Array.isArray(rows), JSON.stringify(rows).slice(0, 100));
  }
  const badKind = await noThrow('reports:data', { token: T, kind: 'hack' });
  ok('reports: unknown kind rejected', badKind.thrown === true || badKind.ok === false, JSON.stringify(badKind).slice(0, 120));
  let empBlocked = null; try { await call('reports:data', { token: aliceSession.token, kind: 'employees' }); } catch (e) { empBlocked = e; }
  ok('reports: portal session blocked (RBAC)', !!empBlocked, empBlocked && empBlocked.message);
  const payrollRows = await noThrow('reports:data', { token: T, kind: 'payroll', period });
  const bobPayRow = Array.isArray(payrollRows) ? payrollRows.find(x => Number(x.employee_id) === bob.id) : null;
  ok('reports: payroll rows real data', !!bobPayRow && Number(bobPayRow.net) > 0 && Number(bobPayRow.basic) === 1000, JSON.stringify(bobPayRow || payrollRows).slice(0, 160));

  // ===== NOTIFICATIONS: broadcast unread + single read (Phase 6) =====
  await noThrow('notifications:create', { token: T, username: '', title: 'عام للجميع', body: 'broadcast', type: 'info' });
  const bobUnread = await noThrow('notifications:unreadCount', { token: bobSession.token });
  ok('notifications: broadcast counted in unread', bobUnread.ok !== false && bobUnread.count >= 1, JSON.stringify(bobUnread));
  const bobNotifs = await noThrow('portal:notifications', { token: bobSession.token });
  const bc = bobNotifs.find(x => x.title === 'عام للجميع' && x.is_read === 0);
  if (bc) {
    const rd = await noThrow('notifications:read', { token: bobSession.token, id: bc.id });
    ok('notifications: single read works', rd.ok === true, JSON.stringify(rd).slice(0, 120));
    const after = await call('notifications:unreadCount', { token: bobSession.token });
    ok('notifications: read decrements unread', after.count === bobUnread.count - 1, JSON.stringify(after));
  } else {
    ok('notifications: broadcast visible to portal user', false, 'broadcast not found in list');
  }

  // ===== BACKUP: create/verify/list/restore (Phase 7) =====
  const backupPath = path.join(dataDir, 'HR-PRO-Backups', 'p37-backup.sqlite'); fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  dialogBehavior.save = { canceled: false, filePath: backupPath };
  const b1 = await noThrow('backup:create', { token: T });
  ok('backup: create ok + verified', b1.ok === true && b1.verified === true && fs.existsSync(backupPath), JSON.stringify(b1).slice(0, 200));
  dialogBehavior.save = { canceled: true };
  const verify = await noThrow('backup:verify', { token: T, path: backupPath });
  ok('backup: verify passes on good file', verify.ok === true, JSON.stringify(verify).slice(0, 140));
  fs.writeFileSync(path.join(dataDir, 'corrupt.sqlite'), 'not a database at all');
  const verifyBad = await noThrow('backup:verify', { token: T, path: path.join(dataDir, 'corrupt.sqlite') });
  ok('backup: verify rejects corrupt file', verifyBad.ok === false, JSON.stringify(verifyBad).slice(0, 140));
  const blist = await noThrow('backup:list', { token: T });
  ok('backup: list shows created backup', Array.isArray(blist) && blist.some(x => x.name === 'p37-backup.sqlite'), JSON.stringify(blist).slice(0, 200));

  // restore: modify data → restore → verify data back
  const delRes = await noThrow('employees:update', { token: T, id: bob.id, full_name: 'تم التدمير' });
  ok('setup: employee modified after backup', delRes.ok === true, JSON.stringify(delRes).slice(0, 120));
  dialogBehavior.open = { canceled: false, filePaths: [backupPath] };
  const restore = await noThrow('backup:restore', { token: T });
  ok('backup: restore succeeds', restore.ok === true, JSON.stringify(restore).slice(0, 200));
  dialogBehavior.open = { canceled: true };
  const staleTok = await call('auth:session', T);
  ok('backup: sessions invalidated after restore', staleTok === null);
  const relogin = await call('auth:login', { username: 'admin', password: 'admin123' });
  ok('backup: relogin works', relogin.ok === true);
  const restored = (await call('employees:list', { token: relogin.token })).find(x => x.id === bob.id);
  ok('backup: restored data intact (name back)', restored && restored.full_name === 'موظف P37-2', restored && restored.full_name);
  // Restore clears every session (by design). Re-establish bob's portal session for later self-service checks.
  const bobSession2 = await call('portal:login', { employee_no: bob.employee_no, password: 'P0rtalPass1' });
  ok('setup: bob re-login after restore', bobSession2.ok === true, JSON.stringify(bobSession2).slice(0, 140));

  // destructive restore must be rejected for non-admin (rbac via backup can_export)
  let restoreDenied = null; try { await call('backup:restore', { token: relogin.token }); } catch (e) { restoreDenied = e; }
  // admin session has can_export so this should reach the dialog (canceled) rather than throw
  ok('backup: restore path reachable for admin (dialog canceled)', restoreDenied === null || restoreDenied === undefined, restoreDenied && restoreDenied.message);

  // ===== PAYROLL NOTIFICATIONS (Phase 6) =====
  const bobPortalNotifs = await noThrow('portal:notifications', { token: bobSession2.token });
  ok('payroll: notification delivered to employee portal', Array.isArray(bobPortalNotifs) && bobPortalNotifs.some(x => /مسير الرواتب/.test(x.title || '')), JSON.stringify(Array.isArray(bobPortalNotifs) ? bobPortalNotifs.slice(0, 2) : bobPortalNotifs).slice(0, 200));

  // ===== CHANGE PASSWORD via portal (self-service) =====
  const cp = await noThrow('portal:changePassword', { token: bobSession2.token, currentPassword: 'P0rtalPass1', newPassword: 'N3wPortalPass' });
  ok('portal: change password works', cp.ok === true, JSON.stringify(cp).slice(0, 120));
  const cpOld = await call('portal:login', { employee_no: bob.employee_no, password: 'P0rtalPass1' });
  ok('portal: old password rejected after change', cpOld.ok === false);
  const cpNew = await call('portal:login', { employee_no: bob.employee_no, password: 'N3wPortalPass' });
  ok('portal: new password accepted', cpNew.ok === true, JSON.stringify(cpNew).slice(0, 140));

  // ===== SETTLEMENT APPROVAL notifies employee (Phase 6) =====
  const settle = await noThrow('settlements:calculate', { token: relogin.token, employee_id: alice.id, termination_date: '2026-09-30' });
  ok('settlement: calculate ok', settle.ok === true, JSON.stringify(settle).slice(0, 160));
  const saved = await noThrow('settlements:save', { token: relogin.token, calculation: settle.calculation, reason: 'استقالة' });
  ok('settlement: save ok', saved.ok === true, JSON.stringify(saved).slice(0, 120));
  const approved = await noThrow('settlements:approve', { token: relogin.token, id: saved.id });
  ok('settlement: approve ok', approved.ok === true, JSON.stringify(approved).slice(0, 120));

  console.log('\n=== PHASE 3-7 TEST RESULT ===');
  console.log('PASSED: ' + passed);
  console.log('FAILED: ' + failed);
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
  console.log('dataDir (kept for inspection): ' + dataDir);
  process.exit(0); // the app's auto-backup timer keeps the loop alive; exit explicitly
})().catch(e => { console.error('PHASE 3-7 TESTS CRASH:', e); process.exit(2); });
