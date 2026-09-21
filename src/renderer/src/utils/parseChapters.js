// 自动将长文本按章节拆分成数组 [{ title, content }]
export function parseChapters(text) {
  if (!text) return []

  // 匹配 "第X章"、"第X节"、"第X回"、"第X卷" 等标题的正则
  const chapterRegex = /(第[\d一二三四五六七八九十百千万]+[章节回卷][^\n]*)/g

  // 用正则把文本切开
  const parts = text.split(chapterRegex).filter(Boolean)

  const chapters = []
  let currentTitle = '前言'
  let currentContent = ''

  // 如果第一段不是章节标题，就当“前言”
  if (!parts[0].match(/^第[\d一二三四五六七八九十百千万]+[章节回卷]/)) {
    currentContent = parts[0]
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    // 如果这一段是章节标题
    if (part.match(/^第[\d一二三四五六七八九十百千万]+[章节回卷]/)) {
      if (currentContent.trim()) {
        chapters.push({ title: currentTitle, content: currentContent.trim() })
      }
      currentTitle = part.trim()
      currentContent = ''
    } else {
      currentContent += part
    }
  }

  // 把最后一章塞进去
  if (currentContent.trim()) {
    chapters.push({ title: currentTitle, content: currentContent.trim() })
  }

  // 如果完全没有匹配到章节，就每 3000 字切一章
  if (chapters.length === 0) {
    const chunkSize = 3000
    for (let i = 0; i < text.length; i += chunkSize) {
      chapters.push({
        title: `第 ${Math.floor(i / chunkSize) + 1} 部分`,
        content: text.slice(i, i + chunkSize)
      })
    }
  }

  return chapters
}