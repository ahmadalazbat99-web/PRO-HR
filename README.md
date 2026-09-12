# HR PRO Jordan v1.1.0 — COMMERCIAL RELEASE CANDIDATE

هذه النسخة توحّد التشغيل الإنتاجي على SQLite/SQL.js، وتضيف جلسة دخول داخل العملية، حراسة الصلاحيات على مسارات الموظفين والنسخ الاحتياطي، وتعطيل الكتابة في مخزن JSON القديم، مع تشديد إعدادات نافذة Electron.

## التشغيل
```powershell
npm install
npm run qa
npm start
```

## بيانات الدخول الأولية (يجب تغييرها)
`admin / تُنشأ عند التهيئة الأولى`

## ملاحظات مهمة
- قاعدة البيانات الأساسية: SQLite/SQL.js في مجلد بيانات التطبيق.
- مخزن JSON القديم لا يُستخدم لكتابة بيانات الإنتاج.
- وضع الشبكة متعدد المستخدمين غير مُفعّل في هذه النسخة؛ النسخة مخصصة للتشغيل المحلي على جهاز واحد.
- قواعد الرواتب الأردنية قابلة للتهيئة ويجب اعتمادها ومراجعتها قانونيًا قبل الاستخدام الرسمي.
- توقيع الترخيص وتوقيع حزم التحديث يحتاجان مفاتيح إنتاج خاصة خارج التطبيق.


## v1.4.1 hardening
- Real SQLite backup restore path with schema validation and pre-restore safety backup.
- Real CSV export and Electron PDF export paths with server-side export permission checks.
- Server-side authorization added to user, permission, settings and audit handlers.
- Static QA/security checks updated for v1.4.1.

### Still required before claiming fully certified production
- Independent legal validation of Jordanian statutory payroll rules against current official sources.
- End-to-end settlement workflow.
- Signed license/update artifacts.
- Clean Windows install/upgrade/runtime/restore acceptance tests on a real host.
- Full immutable audit policy across every module.
- Native XLSX export and real fingerprint-device SDK integration if those features are sold as included.


## v1.4.1 REAL hardening
- Native XLSX workbook generation without a third-party runtime dependency.
- Employee CSV import with duplicate update handling and audit logging.
- Production license signature verification; private signing key is external and never packaged.
- Signed update manifest verification helper.
- Fingerprint device TCP connectivity test (ZKTeco/default port 4370 configurable).
- Demo export buttons wired to real export handlers.

### Vendor signing
Use `scripts/generate-license.js` with an external RSA private key to issue licenses. Never place the private key in the application directory or installer.


## v1.4.1 — Production permissions hardening
- Server-side permission enforcement added to organization/reference data, attendance, shifts, leave types/balances/requests, payroll settings/components/runs/items, and fingerprint operations.
- Renderer preload now retains the authenticated session token so screens that previously omitted tokens continue to work while still being protected server-side.
- Employee create/update validation and audit logging hardened.
- Employee "delete" is implemented as an auditable soft-delete/inactivation to preserve payroll/history integrity.
- Leave approval records the authenticated approver rather than trusting a client-supplied user ID.
- Payroll lock/unlock records the authenticated session user rather than a client-supplied username.
- Fixed notification unread-count session lookup.
- Report-template access now follows report permissions.
- Static syntax, QA, and security checks pass in the build environment.

### Acceptance before distribution
This package is source-ready for a Windows Electron build, but a genuine commercial deployment still requires a real Windows host acceptance test, installer build/signing, and confirmation of the Jordanian payroll/statutory rules by the responsible HR/payroll owner. No software build can honestly guarantee zero runtime defects without that environment test.
