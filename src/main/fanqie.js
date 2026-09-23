// 番茄小说网页端抓取：搜索 + 详情页目录 + 逐章正文 + 私有字体解码。
// 正文抓取只用普通 HTTP（无需签名），搜索借助隐藏 BrowserWindow 渲染客户端页面。
// 参考: https://github.com/blackzhanzhan/novel_agent (tomato_search.py)

import { BrowserWindow, nativeImage } from 'electron'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { CHARSET_GROUPS } from './fanqie-charset.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const BOOK_PAGE_URL = 'https://fanqienovel.com/page/{bookId}'
const READER_URL = 'https://fanqienovel.com/reader/{chapterId}'
const SEARCH_URL = 'https://fanqienovel.com/search/{query}'

// 每章抓取并发数 + 批间间隔，避免被限流
const CONCURRENCY = 4
const CHAPTER_DELAY_MS = 150

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 生成随机 novel_web_id cookie（18-19 位数字）
function makeWebId() {
  return String(Math.floor(Math.random() * 9e17) + 1e18)
}

// 普通 GET，带 UA + cookie，15s 超时
async function fanqieFetch(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Cookie: `novel_web_id=${makeWebId()}`,
        Referer: 'https://fanqienovel.com/'
      },
      signal: controller.signal
    })
    if (!resp.ok) throw new Error(`请求失败 HTTP ${resp.status}`)
    return await resp.text()
  } finally {
    clearTimeout(timer)
  }
}

// 从 HTML 里提取 window.__INITIAL_STATE__ 并解析为对象（按花括号深度配对，比正则更稳）
function extractInitialState(html) {
  const m = /window\.__INITIAL_STATE__\s*=\s*/.exec(html)
  if (!m) throw new Error('页面里找不到 __INITIAL_STATE__')
  let start = m.index + m[0].length
  while (start < html.length && /\s/.test(html[start])) start++
  if (html[start] !== '{') throw new Error('__INITIAL_STATE__ 后不是 JSON 对象')

  let depth = 0
  let end = start
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }

  const raw = html
    .slice(start, end)
    .replace(/:undefined/g, ':null')
    .replace(/,undefined/g, ',null')
  return JSON.parse(raw)
}

// 用指定映射组把私有区码点还原。番茄的私有字体有两套（码点区间重叠、偏移 1），需按「组」来还原
function decodeWithGroup(text, group) {
  const base = group === 1 ? 58345 : 58344
  const end = group === 1 ? 58716 : 58715
  const table = CHARSET_GROUPS[group]
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    let decoded = ch
    if (cp >= base && cp < end) {
      const v = table[cp - base]
      if (v && v !== '?') decoded = v
    }
    out += decoded
  }
  return out
}

// 统计一段文本里的「汉字/中文标点」数量，用于判断用哪个映射组解码更对
function countCjk(text) {
  let n = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0xff00 && cp <= 0xffef)
    ) {
      n++
    }
  }
  return n
}

// 判断文本该用哪个映射组：两组都解一遍，汉字更多的那组更可能是对的
function bestGroup(text) {
  if (!text) return 0
  return countCjk(decodeWithGroup(text, 1)) > countCjk(decodeWithGroup(text, 0)) ? 1 : 0
}

// 自动选择映射组，把私有区码点还原成真实汉字（正文、书名、作者、简介通用）
function decodeFontText(text) {
  if (!text) return ''
  return decodeWithGroup(text, bestGroup(text))
}

// 正文解码：去 HTML 标签、反转义实体、再把私有区码点还原
function decodeContent(html) {
  let text = html.replace(/<\/p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return decodeFontText(text)
}

// 把接口返回的书对象统一成渲染层需要的字段（书名/作者/简介同样要做字体解码）
function mapSearchBook(b) {
  const name = b.book_name || b.bookName || ''
  const author = b.author || ''
  const abstract = b.book_abstract || b.abstract || ''
  // 用最长的文本（通常是简介）判断映射组，再统一解码，避免书名这类短文本判错
  const group = bestGroup(abstract || author || name)
  return {
    bookId: String(b.book_id || ''),
    name: decodeWithGroup(name, group),
    author: decodeWithGroup(author, group),
    wordCount: b.word_number || b.word_count || 0,
    chapterCount: b.chapter_count || 0,
    coverUrl: b.thumb_url || b.thumbUrl || '',
    abstract: decodeWithGroup(abstract, group)
  }
}

// 搜索窗口的 preload 脚本：在页面脚本运行前劫持 fetch / XHR，把搜索接口响应存到 window.__fanqieSearchResp。
// 搜索接口带 a_bogus 签名，只有真实浏览器能拿到有效响应，而 CDP 的 getResponseBody 对这类请求会报
// 「No resource」，Node 重放签名 URL 又拿不到体，所以改在页面内拦截最稳。
const SEARCH_PRELOAD_PATH = join(os.tmpdir(), 'novel-reader-fanqie-search-preload.js')

function ensureSearchPreload() {
  try {
    if (!fs.existsSync(SEARCH_PRELOAD_PATH)) {
      const code = `
;(function () {
  function isSearchApi(u) { return typeof u === 'string' && u.indexOf('/api/author/search/search_book/v1') !== -1 }
  function store(text) { try { if (text) window.__fanqieSearchResp = text } catch (e) {} }
  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch.bind(window)
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url)
      var p = origFetch(input, init)
      if (isSearchApi(url)) { p.then(function (resp) { try { resp.clone().text().then(store) } catch (e) {} }) }
      return p
    }
  }
  var origOpen = XMLHttpRequest.prototype.open
  var origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) { this.__fqUrl = url; return origOpen.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function () {
    var xhr = this
    if (isSearchApi(xhr.__fqUrl)) { xhr.addEventListener('load', function () { store(xhr.responseText) }) }
    return origSend.apply(this, arguments)
  }
})();
`
      fs.writeFileSync(SEARCH_PRELOAD_PATH, code, 'utf8')
    }
    return SEARCH_PRELOAD_PATH
  } catch {
    return null // 临时目录不可写时退回无 preload，搜索走超时兜底
  }
}

// 搜索番茄小说。返回 [{ bookId, name, author, wordCount, chapterCount, coverUrl, abstract }]
export async function searchFanqie(query) {
  const url = SEARCH_URL.replace('{query}', encodeURIComponent(query))

  return new Promise((resolve, reject) => {
    let settled = false
    let win = null
    let timer = null

    const finish = (fn, val) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (win && !win.isDestroyed()) win.destroy()
      fn(val)
    }

    // 解析搜索接口响应体，提取书籍列表
    const parseBody = (body) => {
      try {
        const json = JSON.parse(body)
        const data = json.data || json
        const list = data.search_book_data_list || data.searchBookList || []
        const books = Array.isArray(list) ? list.filter((b) => b && (b.book_id || b.book_name)) : []
        if (books.length) finish(resolve, books.map(mapSearchBook))
      } catch {
        // 响应不是 JSON 或结构不符，忽略，继续等
      }
    }

    win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        preload: ensureSearchPreload() || undefined,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: false // 与页面共享 window，才能劫持页面的 fetch/XHR
      }
    })

    win.webContents.on('did-fail-load', (_e, code, desc) => {
      // -3 是「加载被中断」（如重定向/abort），忽略；其余视为失败
      if (code !== -3) finish(reject, new Error(`搜索页加载失败：${desc}`))
    })

    win.webContents.on('did-finish-load', async () => {
      // 轮询 preload 拦截到的响应（搜索接口在页面加载后异步触发）
      for (let i = 0; i < 60; i++) {
        if (settled) return
        try {
          const body = await win.webContents.executeJavaScript('window.__fanqieSearchResp || null')
          if (body && typeof body === 'string') {
            parseBody(body)
            return
          }
        } catch {
          // 忽略单次读取失败，继续轮询
        }
        await sleep(400)
      }
      finish(reject, new Error('搜索无结果，可能是番茄改版、或该关键词没有匹配书目'))
    })

    win.loadURL(url).catch((err) => finish(reject, err))

    // 超时兜底：搜索接口没被触发（改版/限流/网络问题）时给出明确提示
    timer = setTimeout(
      () => finish(reject, new Error('搜索超时，可能是番茄限流或网络异常，请稍后重试')),
      30000
    )
  })
}

// 抓取整本书。onProgress(done, total, title) 用于回传进度。
// 返回 { name, author, cover, chapters: [{ title, content }] }
export async function importFanqieBook(bookId, onProgress) {
  const html = await fanqieFetch(BOOK_PAGE_URL.replace('{bookId}', bookId))
  const state = extractInitialState(html)
  const pageData = state.page || {}

  const name = decodeFontText(pageData.bookName || '未命名')
  const author = decodeFontText(pageData.author || '')

  // 目录：优先 chapterListWithVolume（含标题与锁定状态），回退 itemIds
  let chaptersMeta = []
  const volumes = pageData.chapterListWithVolume
  if (Array.isArray(volumes) && volumes.length) {
    for (const vol of volumes) {
      for (const ch of vol) {
        chaptersMeta.push({
          itemId: String(ch.itemId),
          title: ch.title || '',
          locked: !!ch.isChapterLock
        })
      }
    }
  }
  if (!chaptersMeta.length) {
    const ids = pageData.itemIds || (state.tocItem && state.tocItem.itemIds) || []
    chaptersMeta = ids.map((id) => ({ itemId: String(id), title: '', locked: false }))
  }
  if (!chaptersMeta.length) throw new Error('未获取到章节目录')

  // 封面尽力下载（失败则留空，由渲染层随机兜底）
  const cover = await fetchCoverDataUrl(pageData.thumbUri || pageData.thumbUrl)

  // 逐章抓正文（并发 + 限速）
  const total = chaptersMeta.length
  const chapters = new Array(total)
  let cursor = 0
  let done = 0

  const worker = async () => {
    while (cursor < total) {
      const idx = cursor++
      const meta = chaptersMeta[idx]
      if (meta.locked) {
        chapters[idx] = { title: meta.title || `第${idx + 1}章`, content: '' }
      } else {
        chapters[idx] = await fetchChapter(meta, idx)
      }
      done++
      if (onProgress) onProgress(done, total, chapters[idx].title)
      if (done < total) await sleep(CHAPTER_DELAY_MS)
    }
  }

  const workers = []
  for (let i = 0; i < Math.min(CONCURRENCY, total); i++) workers.push(worker())
  await Promise.all(workers)

  return { name, author, cover, chapters }
}

// 抓单章正文，失败重试一次，仍失败返回空内容（不中断整本导入）
async function fetchChapter(meta, idx) {
  const fallbackTitle = meta.title || `第${idx + 1}章`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const html = await fanqieFetch(READER_URL.replace('{chapterId}', meta.itemId))
      const state = extractInitialState(html)
      const cd = state.reader && state.reader.chapterData
      if (!cd) throw new Error('无 chapterData')
      const content = decodeContent(cd.content || '').trim()
      if (content.length < 10) throw new Error('正文为空')
      return { title: decodeFontText(cd.title || fallbackTitle), content }
    } catch {
      if (attempt === 1) return { title: fallbackTitle, content: '' }
      await sleep(300)
    }
  }
  return { title: fallbackTitle, content: '' }
}

// 下载封面图并缩到宽 300 转 data URL（复用 nativeImage，和「换封面」同一套做法）
async function fetchCoverDataUrl(thumbUri) {
  if (!thumbUri) return null
  try {
    const url = thumbUri.startsWith('//') ? 'https:' + thumbUri : thumbUri
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://fanqienovel.com/' }
    })
    if (!resp.ok) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return null
    return img.resize({ width: 300 }).toDataURL()
  } catch {
    return null
  }
}
