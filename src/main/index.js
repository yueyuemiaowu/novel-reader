import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
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
  } catch {
    content = buffer.toString('utf8') // 如果解码失败，降级用 utf8 试试
  }

  // 4. 提取书名（去掉路径和 .txt 后缀）
  const name = filePath.split(/[\\/]/).pop().replace('.txt', '')

  // 5. 返回数据给界面
  return { name, path: filePath, content }
})

// 打开图片文件作为自定义封面，压缩成宽 300 的缩略图后返回 data URL
ipcMain.handle('open-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
  })

  if (canceled || filePaths.length === 0) {
    return null // 用户取消了选择
  }

  const image = nativeImage.createFromPath(filePaths[0])
  if (image.isEmpty()) {
    return null // 文件不是有效图片
  }

  // 只保留宽 300 的缩略图（长宽比不变），避免把整张大图塞进书架 JSON
  return image.resize({ width: 300 }).toDataURL()
})

// 书架数据文件的完整路径（放在 userData 目录下，随系统账号隔离）
function getBookshelfPath() {
  return join(app.getPath('userData'), 'bookshelf.json')
}

// 读取书架（返回数组；文件不存在或损坏时返回空书架）
ipcMain.handle('get-books', async () => {
  try {
    const data = await fs.promises.readFile(getBookshelfPath(), 'utf8')
    const parsed = JSON.parse(data)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [] // 首次启动还没有文件，属于正常情况
  }
})

// 保存书架（整体覆盖写入）
ipcMain.handle('save-books', async (_event, books) => {
  if (!Array.isArray(books)) {
    throw new Error('save-books 需要传入数组')
  }
  // 确保 userData 目录存在（正常情况下 Electron 已创建，这里兜底）
  await fs.promises.mkdir(app.getPath('userData'), { recursive: true })
  await fs.promises.writeFile(getBookshelfPath(), JSON.stringify(books, null, 2), 'utf8')
  return true
})
// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
