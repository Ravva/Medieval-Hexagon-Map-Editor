'use client'

import type React from 'react'
import { useState, useMemo, useEffect } from 'react'
import { FileX } from 'lucide-react'
import { getAssetPath } from '@/lib/utils/paths'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { TilePreview } from '@/components/TilePreview'
import { cn } from '@/lib/utils'
import { tileRegistry } from '@/lib/llm/tile-registry'

type MapSize = 'tiny' | 'small' | 'medium' | 'large' | 'very-large'

const MAP_SIZES: Record<MapSize, { label: string; width: number; height: number }> = {
  'tiny': { label: 'Tiny (10×10)', width: 10, height: 10 },
  'small': { label: 'Small (25×25)', width: 25, height: 25 },
  'medium': { label: 'Medium (50×50)', width: 50, height: 50 },
  'large': { label: 'Large (75×75)', width: 75, height: 75 },
  'very-large': { label: 'Very Large (100×100)', width: 100, height: 100 },
}

interface NewMapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (mapSize: MapSize, fillMap: boolean, selectedTile?: BaseTile) => void
}

interface BaseTile {
  tile_id: string
  name: string
  obj_path: string
  mtl_path: string
}

export function NewMapDialog({
  open,
  onOpenChange,
  onConfirm
}: NewMapDialogProps) {
  const [selectedSize, setSelectedSize] = useState<MapSize>('tiny')
  const [fillMap, setFillMap] = useState(false)
  const [selectedTile, setSelectedTile] = useState<BaseTile | null>(null)

  const [baseTiles, setBaseTiles] = useState<BaseTile[]>([])

  // Load base tiles asynchronously like in MapEditor
  useEffect(() => {
    const loadBaseTiles = async () => {
      try {
        // Try multiple approaches to load tile registry (same as MapEditor)
        let tiles: any[] = []

        // Approach 1: Try static import
        try {
          console.log('NewMapDialog: Trying static import...')
          const staticRegistry = tileRegistry
          tiles = staticRegistry?.tiles || staticRegistry || []
          console.log('NewMapDialog: Static import tiles:', tiles.length)
        } catch (error) {
          console.error('NewMapDialog: Static import failed:', error)
        }

        // Approach 2: If static import failed, try fetch
        if (tiles.length === 0) {
          try {
            console.log('NewMapDialog: Trying fetch approach...')
            const response = await fetch('/Medieval-Hexagon-Map-Editor/lib/llm/tile-registry.json')
            if (response.ok) {
              const fetchedRegistry = await response.json()
              tiles = fetchedRegistry?.tiles || fetchedRegistry || []
              console.log('NewMapDialog: Fetch tiles:', tiles.length)
            } else {
              console.error('NewMapDialog: Fetch failed with status:', response.status)
            }
          } catch (error) {
            console.error('NewMapDialog: Fetch approach failed:', error)
          }
        }

        console.log('NewMapDialog: Final loaded tiles:', tiles.length)

        const filteredTiles = tiles.filter(
          (tile: any) => tile.category === 'tiles' && tile.subcategory === 'base'
        ) as BaseTile[]

        console.log('NewMapDialog: Base tiles found:', filteredTiles.length)
        setBaseTiles(filteredTiles)
      } catch (error) {
        console.error('NewMapDialog: Failed to load base tiles:', error)
      }
    }

    loadBaseTiles()
  }, [])

  // Автоматически выбираем первый тайл при включении fillMap
  useEffect(() => {
    if (fillMap && baseTiles.length > 0 && !selectedTile) {
      setSelectedTile(baseTiles[0])
    }
  }, [fillMap, baseTiles, selectedTile])

  // Сбрасываем выбранный тайл при закрытии диалога
  useEffect(() => {
    if (!open) {
      setSelectedTile(null)
    }
  }, [open])

  const handleConfirm = () => {
    if (fillMap && !selectedTile) {
      // Не позволяем создать карту без выбранного тайла
      return
    }
    onConfirm(selectedSize, fillMap, selectedTile || undefined)
    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleConfirm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileX size={20} className="text-primary" />
            New Map
          </DialogTitle>
          <DialogDescription>
            Create a new map. Choose the size for your new map.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="map-size">Map Size</Label>
            <Select value={selectedSize} onValueChange={(value: MapSize) => setSelectedSize(value)}>
              <SelectTrigger id="map-size">
                <SelectValue placeholder="Select map size" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MAP_SIZES).map(([key, size]) => (
                  <SelectItem key={key} value={key}>
                    {size.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="fill-map"
              checked={fillMap}
              onCheckedChange={(checked) => setFillMap(checked as boolean)}
            />
            <Label htmlFor="fill-map" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Fill map with base tiles
            </Label>
          </div>

          {fillMap && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Select Base Tile Template</Label>
              <div className="text-xs text-muted-foreground mb-2">
                Choose a tile to fill the map with. The bottom level (level 0) will be filled with the selected tile.
              </div>
              <div className="grid grid-cols-3 gap-2 p-3 bg-muted/30 border border-dashed border-muted-foreground/30 rounded-lg">
                {baseTiles.map((tile) => (
                  <div
                    key={tile.tile_id}
                    onClick={() => setSelectedTile(tile)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-1 rounded-xl border-2 transition-all cursor-pointer group hover:bg-muted/30",
                      selectedTile?.tile_id === tile.tile_id
                        ? "border-primary bg-primary/5"
                        : "border-transparent bg-muted/10"
                    )}
                  >
                    <div className="w-20 h-20">
                      <TilePreview obj={getAssetPath(tile.obj_path)} mtl={getAssetPath(tile.mtl_path)} />
                    </div>
                    <div className="text-xs text-muted-foreground text-center line-clamp-2 px-1">
                      {tile.name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} className="font-bold">
            <FileX size={16} className="mr-2" />
            Create New Map
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
