const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Keep a global reference of the window object
let mainWindow;

// Determine if we're in development or production
const isDev = !app.isPackaged;

// Get the user data path for storing the database and logs
const userDataPath = app.getPath('userData');

// Set up logging
const logFile = path.join(userDataPath, 'autoping-log.txt');
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (e) {
    // Ignore logging errors
  }
}

log('=== AutoPing Starting ===');
log(`App packaged: ${app.isPackaged}`);
log(`User data path: ${userDataPath}`);
log(`__dirname: ${__dirname}`);

// Set environment variable for the database path before requiring server
process.env.DB_PATH = path.join(userDataPath, 'autoping.db');
log(`Database path: ${process.env.DB_PATH}`);

// Handle uncaught exceptions - log silently, no popups
process.on('uncaughtException', (error) => {
  log(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`UNHANDLED REJECTION: ${reason}`);
});

// Server reference
let server;

function startServer() {
  try {
    log('Starting server...');

    // In production, serve static files from the built client
    if (!isDev) {
      process.env.SERVE_STATIC = path.join(__dirname, 'client', 'dist');
      log(`Static files path: ${process.env.SERVE_STATIC}`);
    }

    // Import and start the Express server
    log('Requiring server module...');
    const startExpressServer = require('./server/server.js');
    log('Starting Express server...');
    server = startExpressServer();
    log('Server started successfully');

    return new Promise((resolve) => {
      // Give the server a moment to start
      setTimeout(resolve, 1000);
    });
  } catch (error) {
    log(`SERVER ERROR: ${error.message}\n${error.stack}`);
    throw error;
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'AutoPing',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    show: false // Don't show until ready
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built static files
    mainWindow.loadFile(path.join(__dirname, 'client', 'dist', 'index.html'));
  }

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    // On macOS, re-create a window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, keep the app running unless explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app quit
app.on('before-quit', () => {
  // Clean up server if needed
  if (server && server.close) {
    server.close();
  }
});
