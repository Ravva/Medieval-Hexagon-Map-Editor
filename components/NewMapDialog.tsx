'use client'

import type React from 'react'
import { useState } from 'react'
import { FileX } from 'lucide-react'
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
  onConfirm: (mapSize: MapSize, fillMap: boolean) => void
}

export function NewMapDialog({
  open,
  onOpenChange,
  onConfirm
}: NewMapDialogProps) {
  const [selectedSize, setSelectedSize] = useState<MapSize>('tiny')
  const [fillMap, setFillMap] = useState(false)

  const handleConfirm = () => {
    onConfirm(selectedSize, fillMap)
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
              <Label className="text-sm font-medium">Base Tile Template</Label>
              <div className="text-xs text-muted-foreground mb-2">
                Select a base tile from the preview panel on the left to use as template for filling the map.
              </div>
              <div className="p-3 bg-muted/30 border border-dashed border-muted-foreground/30 rounded-lg text-center">
                <div className="text-sm text-muted-foreground">
                  Current selection will be used for filling
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Choose a tile from the left panel before creating the map
                </div>
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

        <div className="text-xs text-muted-foreground text-center border-t pt-3">
          Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl+Enter</kbd> to create quickly
        </div>
      </DialogContent>
    </Dialog>
  )
}
