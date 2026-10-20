const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shopApi', {
  list: () => ipcRenderer.invoke('shops:list'),
  add: (data) => ipcRenderer.invoke('shops:add', data),
  login: (id) => ipcRenderer.invoke('shops:login', id),
  check: (id) => ipcRenderer.invoke('shops:check', id),
  yesterdayMetrics: (id) => ipcRenderer.invoke('shops:yesterdayMetrics', id),
  dateMetrics: (id, date) => ipcRenderer.invoke('shops:dateMetrics', { id, date }),
  remove: (id) => ipcRenderer.invoke('shops:remove', id),
  dataPath: () => ipcRenderer.invoke('shops:dataPath'),
  platforms: () => ipcRenderer.invoke('platforms:list'),
  platformDetails: () => ipcRenderer.invoke('platforms:details'),
  addPlatform: (data) => ipcRenderer.invoke('platforms:add', data)
  ,reports: (filter) => ipcRenderer.invoke('reports:list', filter)
  ,deleteReports: (ids) => ipcRenderer.invoke('reports:delete', ids)
  ,batchReports: (data) => ipcRenderer.invoke('reports:batch', data)
  ,exportReports: (rows) => ipcRenderer.invoke('reports:csv', rows)
  ,agentAsk: (query) => ipcRenderer.invoke('agent:ask', query)
  ,onShopStatusChanged: (callback) => ipcRenderer.on('shop:status-changed', (_, shop) => callback(shop))
});
