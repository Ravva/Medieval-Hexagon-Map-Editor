'use client'

import { useState, useEffect } from 'react'
import { Sparkle, Gear } from '@phosphor-icons/react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MAP_SIZES, type MapSize } from '@/components/types'
import { SystemPromptDialog } from '@/components/SystemPromptDialog'
import { getGeminiApiKey, saveGeminiApiKey, getGenerationSettings, saveGenerationSettings } from '@/lib/utils/localStorage'

export interface GenerateMapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (params: {
    prompt: string
    size: MapSize
    biome: 'plains' | 'water' | 'forest' | 'mountain'
    geminiApiKey?: string
    useLocalModel?: boolean
    localModelUrl?: string
    selectedLocalModel?: string
  }) => Promise<void>
  isGenerating?: boolean
  onError?: (message: string) => void
}

export function GenerateMapDialog({
  open,
  onOpenChange,
  onGenerate,
  isGenerating = false,
  onError
}: GenerateMapDialogProps) {
  const [generateMapSize, setGenerateMapSize] = useState<MapSize>('tiny')
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generateBiome, setGenerateBiome] = useState<'plains' | 'water' | 'forest' | 'mountain'>('plains')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [useLocalModel, setUseLocalModel] = useState(false)
  const [localModelUrl, setLocalModelUrl] = useState('http://localhost:1234')
  const [localModels, setLocalModels] = useState<Array<{ id: string; object: string; owned_by: string }>>([])
  const [selectedLocalModel, setSelectedLocalModel] = useState<string>('')
  const [loadingLocalModels, setLoadingLocalModels] = useState(false)
  const [systemPromptDialogOpen, setSystemPromptDialogOpen] = useState(false)

  // Загружаем настройки из localStorage при открытии диалога
  useEffect(() => {
    if (open) {
      const savedGeminiKey = getGeminiApiKey()
      const savedSettings = getGenerationSettings()

      if (savedGeminiKey) {
        setGeminiApiKey(savedGeminiKey)
      }

      if (savedSettings.lastPrompt) {
        setGeneratePrompt(savedSettings.lastPrompt)
      }

      if (savedSettings.lastBiome) {
        setGenerateBiome(savedSettings.lastBiome)
      }

      if (savedSettings.lastMapSize) {
        setGenerateMapSize(savedSettings.lastMapSize as MapSize)
      }

      if (savedSettings.useLocalModel !== undefined) {
        setUseLocalModel(savedSettings.useLocalModel)
      }

      if (savedSettings.localModelUrl) {
        setLocalModelUrl(savedSettings.localModelUrl)
      }

      if (savedSettings.selectedLocalModel) {
        setSelectedLocalModel(savedSettings.selectedLocalModel)
      }
    }
  }, [open])

  // Сохраняем ключ Gemini при изменении (только если не используется локальная модель)
  useEffect(() => {
    if (geminiApiKey && !useLocalModel) {
      saveGeminiApiKey(geminiApiKey)
    }
  }, [geminiApiKey, useLocalModel])

  // Сохраняем настройки генерации при изменении
  useEffect(() => {
    // Сохраняем только если есть хотя бы промпт (чтобы не перезаписывать сохраненные значения пустыми)
    if (generatePrompt) {
      saveGenerationSettings({
        prompt: generatePrompt,
        biome: generateBiome,
        mapSize: generateMapSize,
        useLocalModel,
        localModelUrl,
        selectedLocalModel
      })
    }
  }, [generatePrompt, generateBiome, generateMapSize, useLocalModel, localModelUrl, selectedLocalModel])

  const loadLocalModels = async () => {
    setLoadingLocalModels(true)
    try {
      const url = `${localModelUrl}/v1/models`

      // Use AbortController for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

      try {
        const response = await fetch(url, {
          signal: controller.signal
        })
        clearTimeout(timeoutId)

        const text = await response.text()
        let data: any

        try {
          data = JSON.parse(text)
        } catch {
          data = { raw: text }
        }

        if (!response.ok) {
          throw new Error(data.error || data.message || `Failed to load models: HTTP ${response.status}`)
        }

        const models = data.data || data.models || []
        setLocalModels(models)

        if (models.length > 0 && !selectedLocalModel) {
          setSelectedLocalModel(models[0].id)
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          throw new Error('Connection timeout: Local server did not respond within 10 seconds. Please check if the server is running.')
        }
        throw fetchError
      }
    } catch (err: any) {
      // Handle network errors more gracefully
      let errorMessage = 'Local server is unavailable. Please check if the server is running and the URL is correct.'

      if (err instanceof Error) {
        const errorMsg = err.message.toLowerCase()

        // Check for specific network errors
        if (errorMsg.includes('failed to fetch') ||
            errorMsg.includes('networkerror') ||
            errorMsg.includes('connection refused') ||
            errorMsg.includes('err_connection_refused') ||
            errorMsg.includes('net::err_connection_refused')) {
          errorMessage = `Cannot connect to local server at ${localModelUrl}. Please ensure:\n\n1. The local LLM server is running\n2. The URL is correct (${localModelUrl})\n3. The server is accessible from your browser`
        } else if (errorMsg.includes('timeout') || errorMsg.includes('aborted')) {
          errorMessage = 'Connection timeout: The local server did not respond. Please check if the server is running and try again.'
        } else if (errorMsg.includes('cors')) {
          errorMessage = 'CORS error: The local server may not allow requests from this origin. Please check server CORS settings.'
        } else {
          // Use the original error message if it's informative
          errorMessage = err.message
        }
      }

      // Show error via callback if provided
      if (onError) {
        onError(errorMessage)
      }

      // Log to console with more context (but don't show raw error to user)
      console.warn('Failed to load local models:', {
        url: `${localModelUrl}/v1/models`,
        error: err instanceof Error ? err.message : String(err),
        suggestion: 'Make sure your local LLM server (e.g., Ollama, LM Studio) is running and accessible'
      })

      // Clear models on error
      setLocalModels([])
      setSelectedLocalModel('')
    } finally {
      setLoadingLocalModels(false)
    }
  }

  const handleGenerate = async () => {
    try {
      await onGenerate({
        prompt: generatePrompt.trim(),
        size: generateMapSize,
        biome: generateBiome,
        geminiApiKey: useLocalModel ? undefined : geminiApiKey.trim(),
        useLocalModel: useLocalModel || undefined,
        localModelUrl: useLocalModel ? localModelUrl : undefined,
        selectedLocalModel: useLocalModel ? selectedLocalModel : undefined
      })
      // Reset form on success
      setGeneratePrompt('')
    } catch (error) {
      // Error handling is done in parent component
      throw error
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkle size={20} className="text-cyan-400" />
            Generate Map (AI)
          </DialogTitle>
          <DialogDescription>
            Describe the map you want to generate
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {/* Переключатель между Gemini и локальными моделями */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>LLM Provider</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSystemPromptDialogOpen(true)}
                className="h-8 px-2"
                title="Edit System Prompt"
              >
                <Gear size={16} className="mr-1" />
                <span className="text-xs">System Prompt</span>
              </Button>
            </div>
            <Tabs value={useLocalModel ? 'local' : 'gemini'} onValueChange={(v) => setUseLocalModel(v === 'local')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="gemini">Gemini API</TabsTrigger>
                <TabsTrigger value="local">Local Server</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Gemini API settings */}
          {!useLocalModel && (
            <div className="space-y-3 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="gemini-api-key">Gemini API Key</Label>
                <Input
                  id="gemini-api-key"
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="font-mono text-sm"
                />
                <p className="text-xs text-cyan-400">
                  Get your API key from{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-cyan-300"
                  >
                    Google AI Studio
                  </a>
                </p>
              </div>
            </div>
          )}

          {/* Local server settings */}
          {useLocalModel && (
            <div className="space-y-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="local-model-url">Local Server URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="local-model-url"
                    value={localModelUrl}
                    onChange={(e) => setLocalModelUrl(e.target.value)}
                    placeholder="http://localhost:1234"
                    className="flex-1"
                  />
                  <Button
                    onClick={loadLocalModels}
                    disabled={loadingLocalModels || isGenerating}
                    variant="outline"
                    size="sm"
                  >
                    {loadingLocalModels ? '...' : 'Load'}
                  </Button>
                </div>
              </div>

              {localModels.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="local-model-select">Model</Label>
                  <Select value={selectedLocalModel} onValueChange={setSelectedLocalModel}>
                    <SelectTrigger id="local-model-select">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {localModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {localModels.length === 0 && !loadingLocalModels && (
                <p className="text-xs text-purple-400">
                  Click "Load" to fetch available models
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="generate-prompt">Description</Label>
            <Textarea
              id="generate-prompt"
              value={generatePrompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGeneratePrompt(e.target.value)}
              placeholder="e.g., A peaceful village with a river flowing through it, surrounded by forests"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="generate-size">Map Size</Label>
            <Select value={generateMapSize} onValueChange={(value) => setGenerateMapSize(value as MapSize)}>
              <SelectTrigger id="generate-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MAP_SIZES).map(([key, { label, width, height }]) => (
                  <SelectItem key={key} value={key}>
                    {label} ({width}×{height})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="generate-biome">Primary Biome</Label>
            <Select value={generateBiome} onValueChange={(value) => setGenerateBiome(value as typeof generateBiome)}>
              <SelectTrigger id="generate-biome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plains">Plains</SelectItem>
                <SelectItem value="forest">Forest</SelectItem>
                <SelectItem value="mountain">Mountain</SelectItem>
                <SelectItem value="water">Water</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isGenerating && (
            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
              <p className="font-semibold mb-1">Note:</p>
              {useLocalModel ? (
                <p>Local models may take up to 10 minutes to generate a map depending on size. The current map will be replaced.</p>
              ) : (
                <p>Generation may take up to 5 minutes. The current map will be replaced.</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={
              isGenerating ||
              !generatePrompt.trim() ||
              (!useLocalModel && !geminiApiKey.trim()) ||
              (useLocalModel && (!selectedLocalModel && localModels.length > 0))
            }
          >
            {isGenerating ? (
              <>
                <Loader2 className="animate-spin" />
                Generating...
              </>
            ) : (
              'Generate'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* System Prompt Dialog */}
      <SystemPromptDialog
        open={systemPromptDialogOpen}
        onOpenChange={setSystemPromptDialogOpen}
      />
    </Dialog>
  )
}

