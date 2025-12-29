'use client'

import type React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, Save } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface SaveMapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: SaveMapData) => void
  defaultName?: string
}

export interface SaveMapData {
  name: string
  description: string
  folder: string
  filename: string
}

// Расширяем Window для File System Access API
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
  }
}

export function SaveMapDialog({ open, onOpenChange, onSave, defaultName }: SaveMapDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedFolder, setSelectedFolder] = useState('')
  const [filename, setFilename] = useState('')

  // Обновляем имя файла при изменении названия карты
  const updateFilename = useCallback((mapName: string) => {
    const sanitized = mapName
      .replace(/[^a-z0-9\s-_]/gi, '') // Убираем специальные символы
      .replace(/\s+/g, '_') // Заменяем пробелы на подчеркивания
      .toLowerCase()
    const timestamp = Date.now()
    setFilename(`${sanitized || 'warlords-map'}-${timestamp}.json`)
  }, [])

  // Обновляем поля при открытии диалога
  useEffect(() => {
    if (open) {
      const currentDate = new Date()
      const defaultMapName = defaultName || `Map ${currentDate.toLocaleDateString()} ${currentDate.toLocaleTimeString()}`
      setName(defaultMapName)
      setDescription('')
      setSelectedFolder('')
      updateFilename(defaultMapName)
    }
  }, [open, defaultName, updateFilename])

  const handleNameChange = (value: string) => {
    setName(value)
    updateFilename(value)
  }

  const handleFolderSelect = async () => {
    try {
      // Используем системный диалог выбора папки
      if (window.showDirectoryPicker) {
        // Современный File System Access API
        const dirHandle = await window.showDirectoryPicker()
        setSelectedFolder(dirHandle.name)
      } else {
        // Fallback для старых браузеров - создаем input[type="file"] с webkitdirectory
        const input = document.createElement('input')
        input.type = 'file'
        input.webkitdirectory = true
        input.onchange = (e) => {
          const files = (e.target as HTMLInputElement).files
          if (files && files.length > 0) {
            // Получаем путь к папке из первого файла
            const firstFile = files[0]
            const pathParts = firstFile.webkitRelativePath.split('/')
            if (pathParts.length > 1) {
              setSelectedFolder(pathParts[0])
            }
          }
        }
        input.click()
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Error selecting folder:', err)
      }
    }
  }

  const handleSave = () => {
    if (!name.trim()) {
      return // Можно добавить валидацию
    }

    onSave({
      name: name.trim(),
      description: description.trim(),
      folder: selectedFolder || 'Downloads', // Fallback к Downloads если папка не выбрана
      filename,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Save Map
          </DialogTitle>
          <DialogDescription>
            Save your map with metadata and choose save location
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Map Name */}
          <div className="grid gap-2">
            <Label htmlFor="map-name">Map Name *</Label>
            <Input
              id="map-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Enter map name"
              className="w-full"
            />
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="map-description">Description</Label>
            <Textarea
              id="map-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of your map..."
              className="min-h-[80px] resize-none"
            />
          </div>

          {/* Folder Selection */}
          <div className="grid gap-2">
            <Label htmlFor="folder-select">Save Location</Label>
            <div className="flex gap-2">
              <Input
                id="folder-select"
                value={selectedFolder || 'Downloads (default)'}
                placeholder="Click Browse to select folder"
                readOnly
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={handleFolderSelect}
                className="gap-2"
                type="button"
              >
                <FolderOpen className="h-4 w-4" />
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedFolder
                ? `Files will be saved to: ${selectedFolder}`
                : 'Files will be saved to your Downloads folder by default'
              }
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim()}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            Save Map
          </Button>
        </DialogFooter>

        <div className="text-xs text-muted-foreground mt-2">
          Tip: Press Ctrl+Enter to save quickly
        </div>
      </DialogContent>
    </Dialog>
  )
}
