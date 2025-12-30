'use client'

import { useState, useEffect } from 'react'
import { Gear } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

export interface SystemPromptConfig {
  version: string
  lastUpdated: string
  systemMessage: string
  userPromptTemplate: string
}

interface SystemPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SystemPromptDialog({ open, onOpenChange }: SystemPromptDialogProps) {
  const [config, setConfig] = useState<SystemPromptConfig>({
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    systemMessage: '',
    userPromptTemplate: ''
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      loadConfig()
    }
  }, [open])

  const loadConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/llm/system-prompt')
      if (!response.ok) {
        throw new Error('Failed to load system prompt configuration')
      }
      const data = await response.json()
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration')
      console.error('Failed to load system prompt:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/llm/system-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save system prompt configuration')
      }

      // Reload to get updated lastUpdated timestamp
      await loadConfig()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration')
      console.error('Failed to save system prompt:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gear size={20} className="text-primary" />
            Edit System Prompt for AI Map Generation
          </DialogTitle>
          <DialogDescription>
            Configure the system prompt and user prompt template used for AI map generation.
            Use {'{'}variable{'}'} syntax for template variables (e.g., {'{'}width{'}'}, {'{'}height{'}'}, {'{'}prompt{'}'}, {'{'}biome{'}'}).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading configuration...</div>
          ) : error ? (
            <div className="p-4 bg-destructive/10 border border-destructive/50 rounded-lg text-destructive">
              <p className="font-semibold mb-1">Error:</p>
              <p className="text-sm">{error}</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  value={config.version}
                  onChange={(e) => setConfig({ ...config, version: e.target.value })}
                  disabled
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastUpdated">Last Updated</Label>
                <Input
                  id="lastUpdated"
                  value={new Date(config.lastUpdated).toLocaleString()}
                  disabled
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="systemMessage">
                  System Message
                  <span className="text-xs text-muted-foreground ml-2">(Instructions for the AI)</span>
                </Label>
                <Textarea
                  id="systemMessage"
                  value={config.systemMessage}
                  onChange={(e) => setConfig({ ...config, systemMessage: e.target.value })}
                  placeholder="Enter system message..."
                  rows={20}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  This message defines the AI's role and instructions for generating maps.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="userPromptTemplate">
                  User Prompt Template
                  <span className="text-xs text-muted-foreground ml-2">(Template for user requests)</span>
                </Label>
                <Textarea
                  id="userPromptTemplate"
                  value={config.userPromptTemplate}
                  onChange={(e) => setConfig({ ...config, userPromptTemplate: e.target.value })}
                  placeholder="Enter user prompt template..."
                  rows={8}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Template for constructing user prompts. Available variables: {'{'}prompt{'}'}, {'{'}biome{'}'}, {'{'}width{'}'}, {'{'}height{'}'}, {'{'}totalHexes{'}'}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || !config.systemMessage || !config.userPromptTemplate}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

