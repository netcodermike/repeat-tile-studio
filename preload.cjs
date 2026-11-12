const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  save: (name, bytes) => ipcRenderer.invoke('save-artwork', name, bytes),
  copyColor: color => ipcRenderer.invoke('copy-color', color),
})
