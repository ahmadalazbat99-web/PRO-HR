# HR PRO v1.4.1 — Commercial Production Hardening Checklist

## Security implemented
- [x] Password hashing for seeded admin account
- [x] Session token after login
- [x] Session validation on protected employee and backup paths
- [x] Electron contextIsolation + no Node integration
- [x] Electron sandbox + no navigation/external window opening
- [x] Atomic SQLite database writes
- [x] Legacy JSON write/delete paths disabled
- [x] Server-side audit logging on production CRUD/export/security actions
- [ ] Full immutable audit policy across every module
- [x] Production license verification with asymmetric signature; private signing key kept outside application
- [x] Signed update manifest verification implemented; release signing still performed by vendor pipeline

## HR/Payroll
- [x] Employee create/update/list foundation
- [x] Attendance foundation
- [x] Leave balance/request foundation
- [x] Payroll engine foundation
- [x] Loans/deductions tables
- [x] Settlements calculate/save/list/approve end-to-end
- [x] CSV/PDF/XLSX export IPC paths implemented and wired to UI
- [ ] Full Jordanian statutory validation by current official sources (requires legal/payroll owner sign-off)

## Deployment
- [x] Windows NSIS installer configuration
- [x] Desktop and Start Menu shortcuts
- [ ] Clean install smoke test on Windows host (requires Windows host)
- [ ] Upgrade migration test
- [x] Backup restore path implemented; clean-host acceptance test still required
- [ ] Signed release artifact (requires vendor certificate)

## Scope
- [x] Local/single-PC commercial scope is explicit
- [ ] Multi-user network/server edition
- [ ] Remote employee portal deployment

## QA
- [x] Static syntax check
- [x] QA regression script
- [x] Static/runtime-independent regression checks; full Electron runtime test still requires Windows host
