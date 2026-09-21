import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import jschardet from 'jschardet'
import iconv from 'iconv-lite'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
// 监听渲染进程发来的 'open-txt' 请求
ipcMain.handle('open-txt', async () => {
  // 1. 弹出文件选择框
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: '文本文件', extensions: ['txt'] }]
  })

  if (canceled || filePaths.length === 0) {
    return null // 用户取消了选择
  }

  const filePath = filePaths[0]

  // 2. 读取文件 Buffer
  const buffer = await fs.promises.readFile(filePath)

  // 3. 检测编码并解码（解决中文乱码）
  const detected = jschardet.detect(buffer)
  const encoding = detected.encoding || 'UTF-8'
  
  let content = ''
  try {
    content = iconv.decode(buffer, encoding)
  } catch (err) {
    content = buffer.toString('utf8') // 如果解码失败，降级用 utf8 试试
  }

  // 4. 提取书名（去掉路径和 .txt 后缀）
  const name = filePath.split(/[\\/]/).pop().replace('.txt', '')

  // 5. 返回数据给界面
  return { name, path: filePath, content }
})
// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
