// 自动将长文本按章节拆分成数组 [{ title, content }]

// 章节标题匹配规则（按行判断）：
// - 第X章/节/回/卷/集/部/篇/卦（X 可为阿拉伯数字或中文数字，允许「第 一 卦」这类带空格的写法）
// - 允许行首带一个可选的《…》前缀，如「《易經﹒繫辭上傳》 第一章」
// - 楔子/序章/序言/前言/引言/引子/自序/代序/尾声/后记/番外/外传/终章/结语
// - Chapter N（英文）
const HEADING_PATTERNS = [
  /^(?:《[^》]*》\s*)?第\s*[0-9〇零一二三四五六七八九十百千万两]+\s*[章回节卷集部篇卦][^\n]*/,
  /^(楔子|序章|序言|前言|引言|引子|自序|代序|尾声|后记|番外|外传|终章|结语)[^\n]*/,
  /^chapter\s+[0-9]+[^\n]*/i
]

function isHeading(line) {
  const t = line.trim()
  if (!t) return false
  return HEADING_PATTERNS.some((re) => re.test(t))
}

// 把标题里的「第 一 卦」整理成「第一卦」（只去掉数字与单位之间的空格，保留标题正文）
function normalizeTitle(title) {
  return title.replace(
    /第\s*([0-9〇零一二三四五六七八九十百千万两]+)\s*([章回节卷集部篇卦])/g,
    '第$1$2'
  )
}

// 去掉 Project Gutenberg 的英文版权头/尾，只保留正文
function stripGutenberg(text) {
  const startMarker = '*** START OF THE PROJECT GUTENBERG EBOOK'
  const endMarker = '*** END OF THE PROJECT GUTENBERG EBOOK'
  const s = text.indexOf(startMarker)
  const e = text.indexOf(endMarker)
  let start = 0
  let end = text.length
  if (s !== -1) start = text.indexOf('\n', s) + 1
  if (e !== -1) end = e
  return text.slice(start, end)
}

export function parseChapters(text) {
  if (!text) return []

  text = stripGutenberg(text)

  const lines = text.split('\n')
  const chapters = []
  let currentTitle = '前言'
  let currentContent = []
  let matchedHeading = false

  for (const line of lines) {
    if (isHeading(line)) {
      matchedHeading = true
      const content = currentContent.join('\n').trim()
      if (content) chapters.push({ title: currentTitle, content })
      currentTitle = normalizeTitle(line.trim())
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  const last = currentContent.join('\n').trim()
  if (last) chapters.push({ title: currentTitle, content: last })

  // 一个章节标题都没识别出来 → 退回到按字数切块，避免整本书变成一个巨大的「前言」
  if (!matchedHeading) {
    return chunkBySize(text)
  }

  return chapters
}

function chunkBySize(text) {
  const chunkSize = 3000
  const result = []
  for (let i = 0; i < text.length; i += chunkSize) {
    result.push({
      title: `第 ${Math.floor(i / chunkSize) + 1} 部分`,
      content: text.slice(i, i + chunkSize)
    })
  }
  return result
}
