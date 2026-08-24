// The only bridge between renderer and main. No nodeIntegration: the renderer
// gets this fixed surface and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('pentool', {
  getQueue:      () => ipcRenderer.invoke('queue:get'),
  snapshotStatus:() => ipcRenderer.invoke('snapshot:status'),
  backupStatus:  () => ipcRenderer.invoke('backup:status'),
  getBridge:     () => ipcRenderer.invoke('bridge:get'),
  copyToken:     () => ipcRenderer.invoke('bridge:copyToken'),
  openSection:   (dir, file) => ipcRenderer.invoke('section:open', dir, file),
  reorder:       (pageFile, from, to) => ipcRenderer.invoke('section:reorder', { pageFile, from, to }),
  setBuildMode:  (dirRel, mode) => ipcRenderer.invoke('section:setBuild', { dirRel, mode }),

  listProjects:  () => ipcRenderer.invoke('projects:list'),
  activate:      (root) => ipcRenderer.invoke('projects:activate', root),
  forget:        (root) => ipcRenderer.invoke('projects:forget', root),
  rename:        (root, name) => ipcRenderer.invoke('projects:rename', { root, name }),
  pickFolder:    () => ipcRenderer.invoke('projects:pickFolder'),
  openProject:   (root) => ipcRenderer.invoke('projects:open', root),
  createProject: (opts) => ipcRenderer.invoke('projects:create', opts),

  mcpStatus:     () => ipcRenderer.invoke('mcp:status'),
  copyMcpAdd:    () => ipcRenderer.invoke('mcp:copyAdd'),

  getSettings:   () => ipcRenderer.invoke('settings:get'),
  setToken:      (token, siteId) => ipcRenderer.invoke('settings:setToken', { token, siteId }),
  verifyToken:   (t) => ipcRenderer.invoke('webflow:verify', t),
  refreshWebflow:() => ipcRenderer.invoke('webflow:refresh'),

  unbuildSection: (o) => ipcRenderer.invoke('section:unbuild', o),
  attachSection: (step) => ipcRenderer.invoke('section:attach', step),
  removeSection: (o) => ipcRenderer.invoke('section:remove', o),
  startBuild:    (page) => ipcRenderer.invoke('build:start', page),
  stopBuild:     () => ipcRenderer.invoke('build:stop'),

  agentMode:     () => ipcRenderer.invoke('agent:mode'),
  setAgentMode:  (m) => ipcRenderer.invoke('agent:setMode', m),
  say:           (t) => ipcRenderer.invoke('agent:say', t),

  ptyWrite:      (d) => ipcRenderer.send('pty:write', d),
  ptyResize:     (cols, rows) => ipcRenderer.send('pty:resize', { cols, rows }),
  ptyRestart:    () => ipcRenderer.send('pty:restart'),

  appVersion:    () => ipcRenderer.invoke('app:version'),
  checkUpdate:   () => ipcRenderer.invoke('update:check'),
  dismissUpdate: (v) => ipcRenderer.invoke('update:dismiss', v),
  openUpdate:    (u) => ipcRenderer.invoke('update:open', u),

  onUpdate:      on('update'),
  onAttention:   on('attention'),
  onQueue:       on('queue'),
  onProject:     on('project'),
  onProjects:    on('projects'),
  onBridge:      on('bridge'),
  onBridgeWrite: on('bridge-write'),
  onPtyData:     on('pty-data'),
  onAgentEvent:  on('agent-event'),
  onAgentReset:  on('agent-reset'),
  onPtyStatus:   on('pty-status')
});
