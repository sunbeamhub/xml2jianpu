/**
 * 递归收集 assets 下全部 .musicxml，支持两种路径：
 * - 歌曲.musicxml
 * - 专辑/歌曲.musicxml
 */

const musicxmlModules = import.meta.glob('../assets/**/*.musicxml', {
  eager: true,
  query: '?url',
  import: 'default',
})
export const examples = Object.entries(musicxmlModules).map(([key, url]) => {
  const relativePath = key.replace(/^\.\.\/assets\//, '')
  const id = relativePath.replace(/\.musicxml$/i, '')
  const parts = id.split('/')
  const name = parts[parts.length - 1]
  const album = parts.length > 1 ? parts.slice(0, -1).join('/') : null
  return { id, name, album, url }
})

const byZh = (a, b) => a.name.localeCompare(b.name, 'zh-CN')

/** 根目录曲谱（无专辑） */
export const rootExamples = examples.filter((e) => !e.album).sort(byZh)

/** 按专辑分组；专辑本身不可选，仅作树形分组 */
export const albumGroups = (() => {
  const map = new Map()
  for (const item of examples) {
    if (!item.album) continue
    if (!map.has(item.album)) map.set(item.album, [])
    map.get(item.album).push(item)
  }
  return [...map.entries()]
    .map(([name, songs]) => ({ name, songs: songs.sort(byZh) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
})()

export const defaultExampleId =
  rootExamples[0]?.id || albumGroups[0]?.songs[0]?.id || ''
