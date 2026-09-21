import { useState, useRef, useEffect, useMemo, useLayoutEffect, useCallback } from 'react'
import './App.css'
import { parseChapters } from './utils/parseChapters'

// 阅读设置的默认值
const DEFAULT_SETTINGS = {
  fontSize: 'medium', // small | medium | large | xlarge
  lineHeight: 1.8,
  theme: 'light' // light | green | dark
}

const FONT_SIZES = {
  small: '15px',
  medium: '18px',
  large: '22px',
  xlarge: '26px'
}

const FONT_SIZE_LABELS = { small: '小', medium: '中', large: '大', xlarge: '特大' }
const THEME_LABELS = { light: '默认', green: '护眼', dark: '夜间' }

// 预设封面：几款 CSS 渐变配色
const COVER_PRESETS = {
  'cover-0': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'cover-1': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'cover-2': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'cover-3': 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'cover-4': 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'cover-5': 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'cover-6': 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'cover-7': 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)'
}
const COVER_KEYS = Object.keys(COVER_PRESETS)

// 随机取一个预设封面
function randomCover() {
  return COVER_KEYS[Math.floor(Math.random() * COVER_KEYS.length)]
}

// 把字符串简单哈希成数字，用于给没有封面字段的旧书兜底一个稳定封面
function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

// 根据书的封面字段生成背景样式：自定义图片 / 预设渐变 / 兜底
function getCoverStyle(cover, bookId) {
  if (cover && cover.startsWith('data:')) {
    return { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  if (cover && COVER_PRESETS[cover]) {
    return { background: COVER_PRESETS[cover] }
  }
  // 旧书没有 cover 字段时，按 id 稳定兜底一个预设，避免每次都随机跳动
  const idx = hashString(bookId) % COVER_KEYS.length
  return { background: COVER_PRESETS[COVER_KEYS[idx]] }
}

// 稳定的空章节数组：避免 currentBook 为空时每帧生成新数组导致 useMemo 失效
const EMPTY_CHAPTERS = []

function App() {
  const [page, setPage] = useState('bookshelf')
  const [books, setBooks] = useState([])
  const [currentBook, setCurrentBook] = useState(null)
  const [currentChapter, setCurrentChapter] = useState(0)
  const [showToc, setShowToc] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [coverPickerId, setCoverPickerId] = useState(null) // 正在换封面的书的 id（null = 关闭）

  // 章节内分页的状态：pages 是「每页的段落数组」，pageIndex 是当前第几页
  const [pages, setPages] = useState([[]])
  const [pageIndex, setPageIndex] = useState(0) // 当前第几页
  const pageRef = useRef(null) // 可见正文区，读取它的可视高度
  const measureRef = useRef(null) // 隐藏测量区，量每个段落的实际高度
  const booksRef = useRef(books) // 始终保存最新书架，供保存进度时读取，避免闭包过期
  const [resizeTick, setResizeTick] = useState(0) // 窗口尺寸变化时 +1，触发重新分页

  // 阅读设置：初始化时同步从 localStorage 读取，避免闪烁
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('reader-settings')
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS
    } catch {
      return DEFAULT_SETTINGS
    }
  })

  // 设置变化时持久化
  useEffect(() => {
    localStorage.setItem('reader-settings', JSON.stringify(settings))
  }, [settings])

  // 当前书的章节列表（引用稳定：保存进度时只改 lastChapter/lastPage，不会换 chapters 引用）
  const chapters = currentBook?.chapters || EMPTY_CHAPTERS

  // 当前章节的段落列表（按换行拆分、去掉空行）
  const paragraphs = useMemo(() => {
    const content = chapters[currentChapter]?.content
    if (!content) return []
    return content.split('\n').map((p) => p.trim()).filter(Boolean)
  }, [chapters, currentChapter])

  // 窗口大小变化时重新分页（拖动窗口会改变每页能放多少内容）
  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 精确分页：测量每个段落的实际高度，按每页可视高度切成若干页。
  // 必须在浏览器绘制前同步算好并更新，否则会闪一下上一章/旧字号的内容，所以用 useLayoutEffect。
  useLayoutEffect(() => {
    if (page !== 'reader') return
    const pageEl = pageRef.current
    const measureEl = measureRef.current
    if (!pageEl || !measureEl) return

    const pageStyle = getComputedStyle(pageEl)
    const padTop = parseFloat(pageStyle.paddingTop) || 0
    const padBottom = parseFloat(pageStyle.paddingBottom) || 0
    const usableHeight = pageEl.clientHeight - padTop - padBottom // 每页内容可用高度
    if (usableHeight <= 0) return

    const ps = Array.from(measureEl.children)
    const result = []
    let current = []
    let used = 0
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      const style = getComputedStyle(p)
      // 每段占用的高度 = 自身高度 + 上下外边距（段落之间用 margin 分隔）
      const block =
        p.offsetHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)
      if (current.length > 0 && used + block > usableHeight) {
        result.push(current)
        current = []
        used = 0
      }
      current.push(paragraphs[i])
      used += block
    }
    if (current.length) result.push(current)

    setPages(result.length ? result : [[]])
  }, [page, paragraphs, settings.fontSize, settings.lineHeight, resizeTick])

  // 应用启动时从主进程加载已保存的书架
  useEffect(() => {
    const loadBooks = async () => {
      if (window.api?.getBooks) {
        try {
          const saved = await window.api.getBooks()
          if (Array.isArray(saved)) {
            booksRef.current = saved
            setBooks(saved)
          }
        } catch (err) {
          console.error('加载书架失败', err)
        }
      }
    }
    loadBooks()
  }, [])

  // 保存当前书的阅读进度（第几章、第几页），并同步书架列表 + 持久化
  const saveProgress = useCallback(
    (chapterIndex, pageIdx) => {
      if (!currentBook) return
      const bookId = currentBook.id
      const nextBooks = booksRef.current.map((b) =>
        b.id === bookId ? { ...b, lastChapter: chapterIndex, lastPage: pageIdx } : b
      )
      booksRef.current = nextBooks
      setBooks(nextBooks)
      setCurrentBook((prev) => ({ ...prev, lastChapter: chapterIndex, lastPage: pageIdx }))
      if (window.api?.saveBooks) {
        window.api.saveBooks(nextBooks).catch((err) => console.error('保存阅读进度失败', err))
      }
    },
    [currentBook]
  )

  // 当前章节总页数，以及「安全页码」：防止保存的页码超出当前章节实际页数
  const totalPages = pages.length
  const safePageIndex = Math.max(0, Math.min(pageIndex, totalPages - 1))

  // 章节内翻页：只能通过翻页键前进/后退，页内不可滚动
  const turnPage = useCallback(
    (direction) => {
      const next = Math.max(0, Math.min(safePageIndex + direction, totalPages - 1))
      setPageIndex(next)
      saveProgress(currentChapter, next)
    },
    [safePageIndex, totalPages, currentChapter, saveProgress]
  )

  // 导入 txt
  const handleImportTxt = async () => {
    if (!window.api || !window.api.openTxt) {
      alert('window.api 不存在，请检查 preload 配置')
      return
    }
    const bookData = await window.api.openTxt()
    if (bookData) {
      const chapters = parseChapters(bookData.content)
      const newBook = {
        id: Date.now().toString(),
        name: bookData.name,
        path: bookData.path,
        chapters: chapters,
        lastChapter: 0,
        lastPage: 0,
        cover: randomCover() // 随机分配一个预设封面
      }
      const newBooks = [...books, newBook]
      booksRef.current = newBooks
      setBooks(newBooks)

      // 导入后立即持久化到本地，避免重启丢失
      if (window.api?.saveBooks) {
        try {
          await window.api.saveBooks(newBooks)
        } catch (err) {
          console.error('保存书架失败', err)
          alert('书籍已导入，但保存到本地失败，请检查磁盘权限')
        }
      }

      alert(`成功导入《${bookData.name}》，共 ${chapters.length} 章`)
    }
  }

  const openBook = (book) => {
    setCurrentBook(book)
    // 恢复到上次阅读的章节和页码
    setCurrentChapter(book.lastChapter ?? 0)
    setPageIndex(book.lastPage ?? 0)
    setShowToc(false)
    setPage('reader')
  }

  // 返回书架前保存一次进度
  const goBack = () => {
    saveProgress(currentChapter, safePageIndex)
    setPage('bookshelf')
  }

  // 删除书架上的书
  const deleteBook = async (bookId) => {
    if (!window.confirm('确定要删除这本书吗？')) return
    const nextBooks = booksRef.current.filter((b) => b.id !== bookId)
    booksRef.current = nextBooks
    setBooks(nextBooks)
    if (window.api?.saveBooks) {
      window.api.saveBooks(nextBooks).catch((err) => console.error('删除书籍失败', err))
    }
  }

  // 应用新封面并持久化（cover 为预设 key 或自定义图片 data URL）
  const applyCover = (bookId, cover) => {
    const nextBooks = booksRef.current.map((b) => (b.id === bookId ? { ...b, cover } : b))
    booksRef.current = nextBooks
    setBooks(nextBooks)
    if (window.api?.saveBooks) {
      window.api.saveBooks(nextBooks).catch((err) => console.error('保存封面失败', err))
    }
    setCoverPickerId(null)
  }

  // 上传自定义图片作为封面
  const handleUploadCover = async () => {
    if (!coverPickerId) return
    if (!window.api?.openImage) return
    const dataUrl = await window.api.openImage()
    if (dataUrl) {
      applyCover(coverPickerId, dataUrl)
    }
  }

  // 切换章节：页码归零，进度记录到新章节
  const changeChapter = useCallback(
    (index) => {
      if (index >= 0 && index < currentBook.chapters.length) {
        setCurrentChapter(index)
        setPageIndex(0)
        setShowToc(false)
        saveProgress(index, 0)
      }
    },
    [currentBook, saveProgress]
  )

  // 更新设置（持久化由上面的 useEffect 统一处理）
  const updateSettings = (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  // 阅读页键盘快捷键：←/→ 上一页/下一页，空格 下一页，PageUp/PageDown 上一章/下一章，Home 回到本章第一页
  useEffect(() => {
    const onKeyDown = (e) => {
      if (page !== 'reader') return

      // 焦点在输入控件（如设置里的行距滑杆）上时，不拦截按键，交给控件处理
      const target = e.target
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          turnPage(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          turnPage(1)
          break
        case ' ':
          e.preventDefault()
          // 焦点若在按钮上先失焦，避免空格既触发快捷键又触发按钮点击、一次翻两页
          if (document.activeElement?.tagName === 'BUTTON') {
            document.activeElement.blur()
          }
          turnPage(1)
          break
        case 'PageUp':
          e.preventDefault()
          changeChapter(currentChapter - 1)
          break
        case 'PageDown':
          e.preventDefault()
          changeChapter(currentChapter + 1)
          break
        case 'Home':
          e.preventDefault()
          changeChapter(currentChapter)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page, turnPage, changeChapter, currentChapter])

  // 正在换封面的那本书（coverPickerId 匹配不到时为空）
  const coverPickerBook = books.find((b) => b.id === coverPickerId) || null

  return (
    <div className="app-container">
      {page === 'bookshelf' ? (
        // ================= 书架页 =================
        <div className="bookshelf-page">
          <h1>我的书架</h1>
          <button className="import-btn" onClick={handleImportTxt}>导入小说</button>
          <div className="book-list">
            {books.length === 0 ? (
              <p style={{ color: '#999', marginTop: '20px' }}>书架空空如也，点击上方按钮导入吧！</p>
            ) : (
              books.map((book) => (
                <div className="book-item" key={book.id} onClick={() => openBook(book)}>
                  <button className="book-delete" onClick={(e) => { e.stopPropagation(); deleteBook(book.id) }}>✕</button>
                  <div className="book-cover" style={getCoverStyle(book.cover, book.id)}>
                    <button className="book-cover-edit" onClick={(e) => { e.stopPropagation(); setCoverPickerId(book.id) }}>换封面</button>
                  </div>
                  <div className="book-info">
                    <h3>{book.name}</h3>
                    <p>共 {book.chapters.length} 章</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 换封面弹窗 */}
          {coverPickerId && coverPickerBook && (
            <div className="cover-picker-overlay" onClick={() => setCoverPickerId(null)}>
              <div className="cover-picker" onClick={(e) => e.stopPropagation()}>
                <div className="cover-picker-header">
                  <h3>更换封面</h3>
                  <button className="close-toc" onClick={() => setCoverPickerId(null)}>✕</button>
                </div>
                <div className="cover-picker-grid">
                  {COVER_KEYS.map((key) => (
                    <div
                      key={key}
                      className={`cover-picker-item ${coverPickerBook.cover === key ? 'active' : ''}`}
                      style={{ background: COVER_PRESETS[key] }}
                      onClick={() => applyCover(coverPickerId, key)}
                    />
                  ))}
                </div>
                <button className="cover-upload-btn" onClick={handleUploadCover}>上传自定义图片</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // ================= 阅读页 =================
        <div className={`reader-page theme-${settings.theme}`}>
          <div className="reader-header">
            <button className="back-btn" onClick={goBack}>返回</button>
            <h2>{currentBook?.chapters[currentChapter]?.title}</h2>
            <div className="header-actions">
              <button className="toc-btn" onClick={() => { setShowToc(!showToc); setShowSettings(false) }}>目录</button>
              <button className="toc-btn" onClick={() => { setShowSettings(!showSettings); setShowToc(false) }}>设置</button>
            </div>
          </div>

          {/* 隐藏的测量容器：渲染全部段落用于量高度，不参与显示 */}
          <div
            className="reader-content measure-container"
            ref={measureRef}
            aria-hidden="true"
            style={{ fontSize: FONT_SIZES[settings.fontSize], lineHeight: settings.lineHeight }}
          >
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          {/* 正文：只渲染当前页的段落，页内禁止滚动 */}
          <div
            className="reader-content"
            ref={pageRef}
            style={{ fontSize: FONT_SIZES[settings.fontSize], lineHeight: settings.lineHeight }}
          >
            {(pages[safePageIndex] || []).length > 0 ? (
              pages[safePageIndex].map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))
            ) : (
              <p>没有内容</p>
            )}
          </div>

          {/* 底部翻页栏 */}
          <div className="reader-footer">
            <button className="nav-btn" onClick={() => changeChapter(currentChapter - 1)} disabled={currentChapter === 0}>上一章</button>
            <button className="nav-btn" onClick={() => turnPage(-1)} disabled={safePageIndex === 0}>上一页</button>
            <span className="page-indicator">{safePageIndex + 1} / {totalPages}</span>
            <button className="nav-btn" onClick={() => turnPage(1)} disabled={safePageIndex >= totalPages - 1}>下一页</button>
            <button className="nav-btn" onClick={() => changeChapter(currentChapter + 1)} disabled={!currentBook || currentChapter >= currentBook.chapters.length - 1}>下一章</button>
          </div>

          {/* 目录侧边栏 */}
          {showToc && (
            <div className="toc-sidebar">
              <div className="toc-header">
                <h3>目录</h3>
                <button className="close-toc" onClick={() => setShowToc(false)}>✕</button>
              </div>
              <div className="toc-list">
                {currentBook?.chapters.map((chapter, index) => (
                  <div key={index} className={`toc-item ${index === currentChapter ? 'active' : ''}`} onClick={() => changeChapter(index)}>
                    {chapter.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 设置侧边栏 */}
          {showSettings && (
            <div className="settings-sidebar">
              <div className="settings-header">
                <h3>阅读设置</h3>
                <button className="close-toc" onClick={() => setShowSettings(false)}>✕</button>
              </div>
              <div className="settings-body">
                <div className="setting-group">
                  <label>字号</label>
                  <div className="setting-options">
                    {Object.keys(FONT_SIZES).map((size) => (
                      <button
                        key={size}
                        className={`setting-btn ${settings.fontSize === size ? 'active' : ''}`}
                        onClick={() => updateSettings({ fontSize: size })}
                      >
                        {FONT_SIZE_LABELS[size]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-group">
                  <label>行距（{settings.lineHeight.toFixed(1)}）</label>
                  <input
                    type="range"
                    min="1.2"
                    max="3"
                    step="0.1"
                    value={settings.lineHeight}
                    onChange={(e) => updateSettings({ lineHeight: Number(e.target.value) })}
                  />
                </div>

                <div className="setting-group">
                  <label>背景主题</label>
                  <div className="setting-options">
                    {Object.keys(THEME_LABELS).map((t) => (
                      <button
                        key={t}
                        className={`setting-btn ${settings.theme === t ? 'active' : ''}`}
                        onClick={() => updateSettings({ theme: t })}
                      >
                        {THEME_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
