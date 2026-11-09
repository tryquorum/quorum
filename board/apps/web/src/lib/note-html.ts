// Keep attributes only where the installed Tiptap extensions actually parse them.
export function supportedAttribute(tag: string, name: string, value: string): boolean {
  if (tag === 'A') return ['href', 'target', 'rel'].includes(name)
  if (tag === 'IMG') return ['src', 'alt', 'title'].includes(name)
  if (tag === 'OL' && name === 'start') return /^[1-9]\d*$/.test(value)
  if (tag === 'UL' && name === 'data-type') return value === 'taskList'
  if (tag === 'LI' && name === 'data-type') return value === 'taskItem'
  if (tag === 'LI' && name === 'data-checked') return value === 'true' || value === 'false'
  if (tag === 'INPUT' && name === 'type') return value === 'checkbox'
  if (tag === 'INPUT' && name === 'checked') return true
  return false
}

export function supportedHtml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const allowed = new Set(['P','BR','H1','H2','H3','H4','H5','H6','UL','OL','LI','STRONG','B','EM','I','S','DEL','STRIKE','CODE','PRE','BLOCKQUOTE','A','IMG','HR'])
  return Array.from(doc.body.querySelectorAll('*')).every((node) => {
    const task = node.closest('li[data-type="taskItem"]')
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || ''
      // Restrict to link forms accepted by Tiptap; rejected links would lose their mark.
      if (!/^(?:https?:\/\/|mailto:|tel:|\/|#|\.\/|\.\.\/)/i.test(href) || /[\u0000-\u0020]/.test(href)) return false // oxlint-disable-line no-control-regex -- 링크 href 안의 제어 문자(U+0000–U+001F)와 공백을 거부한다
    }
    if (node.tagName === 'IMG' && (!node.hasAttribute('src') || /^data:/i.test(node.getAttribute('src') || ''))) return false
    if (node.tagName === 'LI' && node.getAttribute('data-type') === 'taskItem') {
      if (node.parentElement?.tagName !== 'UL' || node.parentElement.getAttribute('data-type') !== 'taskList') return false
      const divs = Array.from(node.children).filter((child) => child.tagName === 'DIV')
      // TaskItem's parser selects the first descendant div, even if it belongs to a nested item.
      if (!divs.length && node.querySelector('div')) return false
      if (divs.length && (divs.length !== 1 || Array.from(node.children).some((child) => child.tagName !== 'DIV' && child.tagName !== 'LABEL') || Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim()))) return false
    }
    if (node.tagName === 'INPUT' && task && node.hasAttribute('checked') !== (task.getAttribute('data-checked') === 'true')) return false
    const wrapper = (node.tagName === 'DIV' && node.parentElement === task) ||
      (node.tagName === 'LABEL' && node.parentElement === task && !node.textContent && Array.from(node.children).every((child) => child.tagName === 'INPUT' || (child.tagName === 'SPAN' && !child.textContent))) ||
      (node.tagName === 'INPUT' && node.parentElement?.tagName === 'LABEL' && node.parentElement.parentElement === task && node.getAttribute('type') === 'checkbox') ||
      (node.tagName === 'SPAN' && node.parentElement?.tagName === 'LABEL' && node.parentElement.parentElement === task && !node.textContent && !node.children.length)
    if (!allowed.has(node.tagName) && !wrapper) return false
    if (node.hasAttribute('data-checked') && node.getAttribute('data-type') !== 'taskItem') return false
    return Array.from(node.attributes).every(({name, value}) => supportedAttribute(node.tagName, name, value))
  })
}
