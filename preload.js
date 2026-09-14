const { contextBridge, ipcRenderer } = require('electron');
let activeToken = '';
const tokenOf = (value) => typeof value === 'string' ? (value || activeToken) : (value && (value.token || activeToken));
const withToken = (value={}) => ({...(value||{}), token: tokenOf(value)});
contextBridge.exposeInMainWorld('hrpro', {
  info: () => ipcRenderer.invoke('app:info'),
  health: () => ipcRenderer.invoke('app:health'),
  license: { status: () => ipcRenderer.invoke('license:status'), install: (payload) => ipcRenderer.invoke('license:install', payload) },
  update: { verify: (payload) => ipcRenderer.invoke('update:verify', payload) },
  login: async (payload) => {
    const result = await ipcRenderer.invoke('auth:login', payload);
    if (result?.ok && result.token) activeToken = result.token;
    return result;
  },
  portalLogin: async (payload) => {
    const result = await ipcRenderer.invoke('portal:login', payload);
    if (result?.ok && result.token) activeToken = result.token;
    return result;
  },
  logout: async (token) => {
    const result = await ipcRenderer.invoke('auth:logout', token || activeToken);
    activeToken = '';
    return result;
  },
  session: (token) => ipcRenderer.invoke('auth:session', token),
  changePassword: (payload) => ipcRenderer.invoke('auth:changePassword', withToken(payload)),
  companies: { list: (token) => ipcRenderer.invoke('companies:list', {token: token || activeToken}) },
  branches: { list: (token) => ipcRenderer.invoke('branches:list', {token: token || activeToken}) },
  jobTitles: { list: (token) => ipcRenderer.invoke('jobTitles:list', {token: token || activeToken}) },
  employees: { list: (token) => ipcRenderer.invoke('employees:list', {token: token || activeToken}), get: (id,token) => ipcRenderer.invoke('employees:get', {id,token: token || activeToken}), add: (payload) => ipcRenderer.invoke('employees:add', withToken(payload)), update: (payload) => ipcRenderer.invoke('employees:update', withToken(payload)), delete: (payload) => ipcRenderer.invoke('employees:delete', withToken(payload)), importCsv: (token) => ipcRenderer.invoke('employees:importCsv', {token: token || activeToken}) },
  departments: { list: (token) => ipcRenderer.invoke('departments:list', {token: token || activeToken}) },
  roles: { list: (token) => ipcRenderer.invoke('roles:list', {token: token || activeToken}) },
  users: { list: (token) => ipcRenderer.invoke('users:list', {token: token || activeToken}), add: (payload) => ipcRenderer.invoke('users:add', withToken(payload)), toggle: (payload) => ipcRenderer.invoke('users:toggle', withToken(payload)) },
  permissions: { list: (roleId,token) => ipcRenderer.invoke('permissions:list', {roleId,token: token || activeToken}), save: (payload) => ipcRenderer.invoke('permissions:save', withToken(payload)) },
  audit: { list: (token) => ipcRenderer.invoke('audit:list', {token: token || activeToken}) },
  shifts: { list: (token) => ipcRenderer.invoke('shifts:list',{token:token||activeToken}), add: (payload) => ipcRenderer.invoke('shifts:add', withToken(payload)), del: (payload) => ipcRenderer.invoke('shifts:delete', withToken(payload)) },
  employeeShifts: { list: (employeeId,token) => ipcRenderer.invoke('employeeShifts:list', {employeeId,token:token||activeToken}), assign: (payload) => ipcRenderer.invoke('employeeShifts:assign', withToken(payload)) },
  attendance: { list: (payload) => ipcRenderer.invoke('attendance:list', withToken(payload)), upsert: (payload) => ipcRenderer.invoke('attendance:upsert', withToken(payload)), del: (id) => ipcRenderer.invoke('attendance:delete', {id,token:activeToken}), importCsv: () => ipcRenderer.invoke('attendance:importCsv', {token:activeToken}), settings: () => ipcRenderer.invoke('attendance:settings', {token:activeToken}), settingsSave: (payload) => ipcRenderer.invoke('attendance:settingsSave', withToken(payload)) },
  fingerprint: { list: (token) => ipcRenderer.invoke('fingerprint:list', {token: token || activeToken}), add: (payload) => ipcRenderer.invoke('fingerprint:add', withToken(payload)), test: (payload) => ipcRenderer.invoke('fingerprint:test', withToken(payload)), capability: () => ipcRenderer.invoke('fingerprint:capability'), sync: (payload) => ipcRenderer.invoke('fingerprint:sync', withToken(payload)), update: (payload) => ipcRenderer.invoke('fingerprint:update', withToken(payload)), del: (payload) => ipcRenderer.invoke('fingerprint:delete', withToken(payload)) },
  leaveTypes: { list: (token) => ipcRenderer.invoke('leaveTypes:list', {token: token || activeToken}), add: (payload) => ipcRenderer.invoke('leaveTypes:add', withToken(payload)) },
  leaveBalances: { list: (payload) => ipcRenderer.invoke('leaveBalances:list', withToken(payload)), adjust: (payload) => ipcRenderer.invoke('leaveBalances:adjust', withToken(payload)) },
  leaveRequests: { list: (payload) => ipcRenderer.invoke('leaveRequests:list', withToken(payload)), add: (payload) => ipcRenderer.invoke('leaveRequests:add', withToken(payload)), approve: (payload) => ipcRenderer.invoke('leaveRequests:approve', withToken(payload)), reject: (payload) => ipcRenderer.invoke('leaveRequests:reject', withToken(payload)), cancel: (payload) => ipcRenderer.invoke('leaveRequests:cancel', withToken(payload)) },
  portal: {
    me: (token) => ipcRenderer.invoke('portal:me', {token: token || activeToken}),
    payslips: (token) => ipcRenderer.invoke('portal:payslips', {token: token || activeToken}),
    leaveRequests: (token) => ipcRenderer.invoke('portal:leaveRequests', {token: token || activeToken}),
    attendance: (token) => ipcRenderer.invoke('portal:attendance', {token: token || activeToken}),
    documents: (token) => ipcRenderer.invoke('portal:documents', {token: token || activeToken}),
    loans: (token) => ipcRenderer.invoke('portal:loans', {token: token || activeToken}),
    submitLeave: (payload) => ipcRenderer.invoke('portal:submitLeave', withToken(payload)),
    changePassword: (payload) => ipcRenderer.invoke('portal:changePassword', withToken(payload)),
    notifications: (token) => ipcRenderer.invoke('portal:notifications', {token: token || activeToken})
  },
  payroll: { settings: (token) => ipcRenderer.invoke('payroll:settings',{token:token||activeToken}), settingsSave: (payload) => ipcRenderer.invoke('payroll:settingsSave', withToken(payload)), components: (token) => ipcRenderer.invoke('payroll:components',{token:token||activeToken}), adjustmentAdd: (payload) => ipcRenderer.invoke('payroll:adjustmentAdd', withToken(payload)), preview: (payload) => ipcRenderer.invoke('payroll:preview', withToken(payload)), run: (payload) => ipcRenderer.invoke('payroll:run', withToken(payload)), runs: (token) => ipcRenderer.invoke('payroll:runs',{token:token||activeToken}), items: (payload) => ipcRenderer.invoke('payroll:items', withToken(payload)), lock: (payload) => ipcRenderer.invoke('payroll:lock', withToken(payload)), unlock: (payload) => ipcRenderer.invoke('payroll:unlock', withToken(payload)) },
  settings: { get: (token) => ipcRenderer.invoke('settings:get', {token: token || activeToken}), set: (payload) => ipcRenderer.invoke('settings:set', withToken(payload)) },
  backup: { create: (token) => ipcRenderer.invoke('backup:create', {token: token || activeToken}), restore: (token) => ipcRenderer.invoke('backup:restore', {token: token || activeToken}), list: (token) => ipcRenderer.invoke('backup:list', {token: token || activeToken}), verify: (payload) => ipcRenderer.invoke('backup:verify', withToken(payload)) },
  reports: { csv: (payload) => ipcRenderer.invoke('report:csv', payload), pdf: (token) => ipcRenderer.invoke('report:pdf', {token}), excel: (payload) => ipcRenderer.invoke('report:excel', payload) },
  loans: { list:(token)=>ipcRenderer.invoke('loans:list',{token}), add:(p)=>ipcRenderer.invoke('loans:add',withToken(p)), pay:(p)=>ipcRenderer.invoke('loans:pay',withToken(p)) },
  deductions: { list:(token)=>ipcRenderer.invoke('deductions:list',{token: token || activeToken}), add:(p)=>ipcRenderer.invoke('deductions:add',withToken(p)) },
  settlements: { calculate:(p)=>ipcRenderer.invoke('settlements:calculate',withToken(p)), save:(p)=>ipcRenderer.invoke('settlements:save',withToken(p)), list:(token)=>ipcRenderer.invoke('settlements:list',{token: token || activeToken}), approve:(p)=>ipcRenderer.invoke('settlements:approve',withToken(p)) },
  documents: { list:(token)=>ipcRenderer.invoke('documents:list',{token: token || activeToken}), add:(p)=>ipcRenderer.invoke('documents:add',withToken(p)), expiryScan:(p)=>ipcRenderer.invoke('documents:expiryScan',withToken(p||{})) },
  payslip: { get: (payload) => ipcRenderer.invoke('payslip:get', withToken(payload)) },
  reportsData: (payload) => ipcRenderer.invoke('reports:data', withToken(payload)),
  workflow: { list:(token)=>ipcRenderer.invoke('workflow:list',{token: token || activeToken}), create:(p)=>ipcRenderer.invoke('workflow:create',withToken(p)), decide:(p)=>ipcRenderer.invoke('workflow:decide',withToken(p)) },
  notifications: { list:(token)=>ipcRenderer.invoke('notifications:list',{token: token || activeToken}), readAll:(token)=>ipcRenderer.invoke('notifications:readAll',{token: token || activeToken}), read:(p)=>ipcRenderer.invoke('notifications:read',withToken(p)), create:(p)=>ipcRenderer.invoke('notifications:create',withToken(p)), delete:(p)=>ipcRenderer.invoke('notifications:delete',withToken(p)), unreadCount:(token)=>ipcRenderer.invoke('notifications:unreadCount',{token: token || activeToken}) },
  discipline: { list:(token)=>ipcRenderer.invoke('discipline:list',{token: token || activeToken}), add:(p)=>ipcRenderer.invoke('discipline:add',withToken(p)), update:(p)=>ipcRenderer.invoke('discipline:update',withToken(p)), delete:(p)=>ipcRenderer.invoke('discipline:delete',withToken(p)) },
  performance: { list:(token)=>ipcRenderer.invoke('performance:list',{token: token || activeToken}), save:(p)=>ipcRenderer.invoke('performance:save',withToken(p)) },
  orgUnits: { list:(token)=>ipcRenderer.invoke('orgUnits:list',{token: token || activeToken}), save:(p)=>ipcRenderer.invoke('orgUnits:save',withToken(p)), delete:(p)=>ipcRenderer.invoke('orgUnits:delete',withToken(p)) },
  reportTemplates: { list:(token)=>ipcRenderer.invoke('reportTemplates:list',{token: token || activeToken}), save:(p)=>ipcRenderer.invoke('reportTemplates:save',withToken(p)) },
  documentAdmin: { delete:(p)=>ipcRenderer.invoke('documents:delete',withToken(p)) },
  loanAdmin: { delete:(p)=>ipcRenderer.invoke('loans:delete',withToken(p)) },
  deductionAdmin: { delete:(p)=>ipcRenderer.invoke('deductions:delete',withToken(p)) },
  dbPath: () => ipcRenderer.invoke('db:path'),

  data: {
    list: (name, filter={}) => ipcRenderer.invoke('hr:data:list', name, filter),
    create: (name, data, actor='system') => ipcRenderer.invoke('hr:data:create', name, data, actor),
    update: (name, id, patch, actor='system') => ipcRenderer.invoke('hr:data:update', name, id, patch, actor),
    remove: (name, id, actor='system') => ipcRenderer.invoke('hr:data:remove', name, id, actor),
    health: (token) => ipcRenderer.invoke('hr:data:health', token),
    backup: (actor='system') => ipcRenderer.invoke('hr:data:backup', actor)
  },
});
