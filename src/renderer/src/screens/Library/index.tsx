import { useState } from 'react'
import type { LibraryTab } from '@renderer/app/nav'
import './library.css'
import { ImagesTab, type ImageFilter, type ImageView } from './ImagesTab'
import { ModelsTab, type ModelFilter } from './ModelsTab'
import { Assets2DTab, type Asset2DFilter } from './Assets2DTab'
import { PromptsTab, type PromptFilter } from './PromptsTab'
import { LibrarySpritesScreen } from '../ProjectSprites'
import { StylesTab } from './StylesTab'

/** 全局库：图片素材 / 3D 模型 / 2D 资产 / 序列帧 / 提示词 / 风格（tab 由侧栏切换，几个 tab 共用这一个实例） */
export default function LibraryScreen({ tab }: { tab: LibraryTab }): React.JSX.Element {
  // 分类和显示方式在切 tab 时保留；搜索只属于当前 tab，换 tab 就清空
  const [imageCat, setImageCat] = useState<ImageFilter>('all')
  const [promptCat, setPromptCat] = useState<PromptFilter>('all')
  const [modelCat, setModelCat] = useState<ModelFilter>('all')
  const [asset2dCat, setAsset2dCat] = useState<Asset2DFilter>('all')
  const [view, setView] = useState<ImageView>('grid')
  const [search, setSearch] = useState<{ tab: LibraryTab; q: string }>({ tab, q: '' })
  const q = search.tab === tab ? search.q : ''
  const setQ = (next: string): void => setSearch({ tab, q: next })

  switch (tab) {
    case 'images':
      return <ImagesTab q={q} onQ={setQ} cat={imageCat} onCat={setImageCat} view={view} onView={setView} />
    case 'models':
      return <ModelsTab q={q} onQ={setQ} cat={modelCat} onCat={setModelCat} />
    case 'assets2d':
      return <Assets2DTab q={q} onQ={setQ} cat={asset2dCat} onCat={setAsset2dCat} />
    case 'sprites':
      return <LibrarySpritesScreen />
    case 'prompts':
      return <PromptsTab q={q} onQ={setQ} cat={promptCat} onCat={setPromptCat} />
    case 'styles':
      return <StylesTab q={q} onQ={setQ} />
  }
}
