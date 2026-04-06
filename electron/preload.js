const { ipcRenderer } = require('electron');

window.electron = {
  minimize: () => ipcRenderer.send('minimize-window'),
  close: () => ipcRenderer.send('close-window'),
};
