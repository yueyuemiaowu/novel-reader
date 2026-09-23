import { contextBridge, ipcRenderer } from 'electron'

// 定义允许界面调用的 API 列表
const api = {
  openTxt: () => ipcRenderer.invoke('open-txt'),
  getBooks: () => ipcRenderer.invoke('get-books'),
  saveBooks: (books) => ipcRenderer.invoke('save-books', books),
  openImage: () => ipcRenderer.invoke('open-image'),
  fanqieSearch: (query) => ipcRenderer.invoke('fanqie-search', query),
  fanqieImport: (bookId) => ipcRenderer.invoke('fanqie-import', bookId),
  // 订阅番茄导入进度，返回取消订阅函数
  onFanqieImportProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('fanqie-import-progress', handler)
    return () => ipcRenderer.removeListener('fanqie-import-progress', handler)
  }
}

if (process.contextIsolated) {
  try {
    // 把 api 挂载到 window.api 上，这样 React 界面就能用了
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
