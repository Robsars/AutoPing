// Preload script for Electron
// This runs in a sandboxed environment before the renderer process

const { contextBridge } = require('electron');

// Expose protected methods that allow the renderer process to use
// a limited subset of Node.js and Electron APIs
contextBridge.exposeInMainWorld('electronAPI', {
    // Add any APIs you want to expose to the renderer here
    isElectron: true,
    platform: process.platform
});
