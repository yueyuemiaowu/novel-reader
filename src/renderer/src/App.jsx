import { useState, useRef, useEffect } from 'react'
import './App.css'
import { parseChapters } from './utils/parseChapters'

function App() {
  const [page, setPage] = useState('bookshelf')
  const [books, setBooks] = useState([])
  const [currentBook, setCurrentBook] = useState(null)
  const [currentChapter, setCurrentChapter] = useState(0)
  const [showToc, setShowToc] = useState(false)
  
  // 新增：控制章节内翻页的状态
  const [pageIndex, setPageIndex] = useState(0)   // 当前第几页
  const [totalPages, setTotalPages] = useState(1) // 这一章总共有几页
  const readerRef = useRef(null) // 指向阅读区DOM

  // 计算当前章节总页数的函数
  const recalcPages = () => {
    const el = readerRef.current
    if (el) {
      // 总宽度 / 可视宽度 = 页数
      const total = Math.ceil(el.scrollWidth / el.clientWidth)
      setTotalPages(total || 1)
    }
  }

  // 监听窗口大小变化（拖动窗口会重新排版，必须重新算页数）
  useEffect(() => {
    window.addEventListener('resize', recalcPages)
    return () => window.removeEventListener('resize', recalcPages)
  }, [])

  // 每次切换章节时，重置页码，并重新算页数
  useEffect(() => {
    if (page === 'reader') {
      setPageIndex(0)
      // 稍微延迟一下，等DOM渲染完再算
      setTimeout(recalcPages, 100)
    }
  }, [currentChapter, page])

  // 章节内翻页的核心函数
  const turnPage = (direction) => {
    const el = readerRef.current
    if (!el) return

    let newPageIndex = pageIndex + direction
    
    // 边界控制
    if (newPageIndex < 0) newPageIndex = 0
    if (newPageIndex >= totalPages) newPageIndex = totalPages - 1

    setPageIndex(newPageIndex)
    // 让阅读区平滑滚动到那一页的位置
    el.scrollTo({
      left: newPageIndex * el.clientWidth,
      behavior: 'smooth'
    })
  }

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
      }
      setBooks([...books, newBook])
      alert(`成功导入《${bookData.name}》，共 ${chapters.length} 章`)
    }
  }

  const openBook = (book) => {
    setCurrentBook(book)
    setCurrentChapter(0)
    setShowToc(false)
    setPage('reader')
  }

  // 切换章节
  const changeChapter = (index) => {
    if (index >= 0 && index < currentBook.chapters.length) {
      setCurrentChapter(index)
      setShowToc(false)
    }
  }

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
                  <div className="book-cover"></div>
                  <div className="book-info">
                    <h3>{book.name}</h3>
                    <p>共 {book.chapters.length} 章</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        // ================= 阅读页 =================
        <div className="reader-page">
          <div className="reader-header">
            <button className="back-btn" onClick={() => setPage('bookshelf')}>返回</button>
            <h2>{currentBook?.chapters[currentChapter]?.title}</h2>
            <button className="toc-btn" onClick={() => setShowToc(!showToc)}>目录</button>
          </div>

          {/* 正文区，加入 ref */}
          <div className="reader-content" ref={readerRef}>
            {currentBook?.chapters[currentChapter]?.content ? (
              currentBook.chapters[currentChapter].content.split('\n').map((paragraph, index) => (
                paragraph.trim() && <p key={index}>{paragraph}</p>
              ))
            ) : (
              <p>没有内容</p>
            )}
          </div>

          {/* 底部翻页栏（改为：上一章 / 上一页 / 页码 / 下一页 / 下一章） */}
          <div className="reader-footer">
            <button className="nav-btn" onClick={() => changeChapter(currentChapter - 1)} disabled={currentChapter === 0}>上一章</button>
            <button className="nav-btn" onClick={() => turnPage(-1)} disabled={pageIndex === 0}>上一页</button>
            <span className="page-indicator">{pageIndex + 1} / {totalPages}</span>
            <button className="nav-btn" onClick={() => turnPage(1)} disabled={pageIndex >= totalPages - 1}>下一页</button>
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
        </div>
      )}
    </div>
  )
}

export default App