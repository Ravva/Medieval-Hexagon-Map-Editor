'use client'

import { useState, useEffect } from 'react'
import { Sparkle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModelPreview } from '@/components/ModelPreview'
import { type AssetCategory, type AssetModel } from '@/components/types'
import { cn } from '@/lib/utils'

export interface AssetPanelProps {
  selectedModel: { obj: string; mtl: string; name: string } | null
  onSelectModel: (model: { obj: string; mtl: string; name: string }) => void
  onDragStart: (model: { obj: string; mtl: string; name: string }) => void
  onGenerateMap: () => void
  isGenerating: boolean
}

export function AssetPanel({
  selectedModel,
  onSelectModel,
  onDragStart,
  onGenerateMap,
  isGenerating
}: AssetPanelProps) {
  const [assetCategories, setAssetCategories] = useState<AssetCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedFolder, setSelectedFolder] = useState<string>('')

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const response = await fetch('/api/assets')
        const data = await response.json()
        setAssetCategories(data.categories)
        if (data.categories.length > 0) {
          const tiles = data.categories.find((c: any) => c.name === 'tiles')
          if (tiles) {
            setSelectedCategory('tiles')
            if (tiles.folders.length > 0) setSelectedFolder(tiles.folders[0].name)
          } else {
            setSelectedCategory(data.categories[0].name)
            setSelectedFolder(data.categories[0].folders[0].name)
          }
        }
      } catch (error) {
        console.error('Failed to fetch assets:', error)
      }
    }
    fetchAssets()
  }, [])

  const currentCategory = assetCategories.find(c => c.name === selectedCategory)
  const currentFolder = currentCategory?.folders.find(f => f.name === selectedFolder)
  const availableModels = currentFolder?.models || []

  return (
    <aside className="w-80 border-r border-border bg-card/50 backdrop-blur-md flex flex-col z-20">
      <div className="p-6 border-b border-border bg-card/80">
        <h1 className="text-xl font-bold tracking-tight flex flex-col items-center justify-center gap-2">
          <div className="flex items-center justify-center gap-3">
            <div className="w-6 h-6 overflow-visible flex items-center justify-center">
              <div style={{ transform: 'scale(4)' }}>
                <ModelPreview obj="/assets/terrain/buildings/blue/building_home_B_blue.obj" mtl="/assets/terrain/buildings/blue/building_home_B_blue.mtl" />
              </div>
            </div>
            <div className="flex flex-col items-start ml-[20px]">
              <span>Medieval Hexagon Map</span>
              <span>Editor</span>
            </div>
          </div>
        </h1>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col h-full gap-6 min-h-0">
          <section className="space-y-4">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assets</Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {assetCategories.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedFolder} onValueChange={setSelectedFolder}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currentCategory?.folders.map(f => <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2 h-full content-start">
              {availableModels.map((m, i) => (
                <div
                  key={i}
                  draggable={true}
                  onDragStart={() => {
                    onDragStart(m)
                    onSelectModel(m)
                  }}
                  onClick={() => onSelectModel(m)}
                  className={cn("p-1 rounded-xl border-2 transition-all cursor-pointer group hover:bg-muted/30", selectedModel?.name === m.name ? "border-primary bg-primary/5" : "border-transparent bg-muted/10")}
                >
                  <div className="aspect-square w-full">
                    <ModelPreview obj={m.obj} mtl={m.mtl} />
                  </div>
                  <p className="text-[11px] font-bold text-center mt-1 truncate px-1 py-1 uppercase tracking-tight">{m.name}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>
      <div className="p-4 border-t border-border flex flex-col gap-2">
        <Button
          className="w-full font-bold shadow-lg shadow-primary/20 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
          onClick={onGenerateMap}
          disabled={isGenerating}
        >
          <Sparkle size={16} className="mr-2" />
          {isGenerating ? 'Generating...' : 'Generate Map (AI)'}
        </Button>
      </div>
    </aside>
  )
}

