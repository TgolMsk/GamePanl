import { useState } from 'react'
import type { LibraryTab } from '@renderer/app/nav'
import './library.css'
import { ImagesTab, type ImageFilter, type ImageView } from './ImagesTab'
import { PromptsTab, type PromptFilter } from './PromptsTab'
import { StylesTab } from './StylesTab'

/** 全局库：图片素材 / 提示词 / 风格（tab 由侧栏切换，三个 tab 共用这一个实例） */
export default function LibraryScreen({ tab }: { tab: LibraryTab }): React.JSX.Element {
  // 分类和显示方式在切 tab 时保留；搜索只属于当前 tab，换 tab 就清空
  const [imageCat, setImageCat] = useState<ImageFilter>('all')
  const [promptCat, setPromptCat] = useState<PromptFilter>('all')
  const [view, setView] = useState<ImageView>('grid')
  const [search, setSearch] = useState<{ tab: LibraryTab; q: string }>({ tab, q: '' })
  const q = search.tab === tab ? search.q : ''
  const setQ = (next: string): void => setSearch({ tab, q: next })

  switch (tab) {
    case 'images':
      return <ImagesTab q={q} onQ={setQ} cat={imageCat} onCat={setImageCat} view={view} onView={setView} />
    case 'prompts':
      return <PromptsTab q={q} onQ={setQ} cat={promptCat} onCat={setPromptCat} />
    case 'styles':
      return <StylesTab q={q} onQ={setQ} />
  }
}
