/**
 * PromptManager - Manages system prompts for LLM map generation
 *
 * Provides unified prompt loading and template substitution for both
 * Gemini API and local models
 */

import fs from 'fs'
import path from 'path'

export interface SystemPromptConfig {
  version: string
  lastUpdated: string
  systemMessage: string
  userPromptTemplate: string
}

export interface PromptParams {
  width: number
  height: number
  prompt: string
  biome: string
  totalHexes?: number
}

export class PromptManager {
  private static instance: PromptManager | null = null
  private config: SystemPromptConfig | null = null
  private readonly configPath: string

  private constructor() {
    this.configPath = path.join(process.cwd(), 'lib', 'llm', 'system_prompt.json')
  }

  static getInstance(): PromptManager {
    if (!PromptManager.instance) {
      PromptManager.instance = new PromptManager()
    }
    return PromptManager.instance
  }

  /**
   * Load system prompt configuration from JSON file
   */
  loadConfig(): SystemPromptConfig {
    if (this.config) {
      return this.config
    }

    try {
      const configData = fs.readFileSync(this.configPath, 'utf-8')
      this.config = JSON.parse(configData)
      return this.config!
    } catch (error) {
      console.error('Failed to load system prompt config:', error)
      // Fallback to default config
      this.config = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        systemMessage: 'You are an expert game designer. Generate hex maps in JSON format.',
        userPromptTemplate: 'Create a {width}x{height} hex map: "{prompt}". Biome: {biome}.'
      }
      return this.config
    }
  }

  /**
   * Save system prompt configuration to JSON file
   */
  saveConfig(config: SystemPromptConfig): void {
    try {
      config.lastUpdated = new Date().toISOString()
      const configData = JSON.stringify(config, null, 2)
      fs.writeFileSync(this.configPath, configData, 'utf-8')
      this.config = config // Update cached config
    } catch (error) {
      console.error('Failed to save system prompt config:', error)
      throw error
    }
  }

  /**
   * Get system message with parameter substitution
   */
  getSystemMessage(params: PromptParams): string {
    const config = this.loadConfig()
    return this.substituteParams(config.systemMessage, params)
  }

  /**
   * Get user prompt with parameter substitution
   */
  getUserPrompt(params: PromptParams): string {
    const config = this.loadConfig()
    return this.substituteParams(config.userPromptTemplate, params)
  }

  /**
   * Get both system and user prompts
   */
  getPrompts(params: PromptParams): { systemMessage: string; userPrompt: string } {
    const totalHexes = params.totalHexes || (params.width * params.height)
    const fullParams = { ...params, totalHexes }

    return {
      systemMessage: this.getSystemMessage(fullParams),
      userPrompt: this.getUserPrompt(fullParams)
    }
  }

  /**
   * Substitute template parameters in a string
   */
  private substituteParams(template: string, params: PromptParams): string {
    const totalHexes = params.totalHexes || (params.width * params.height)
    const fullParams = { ...params, totalHexes }

    let result = template

    // Replace all parameter placeholders
    for (const [key, value] of Object.entries(fullParams)) {
      const placeholder = `{${key}}`
      const placeholderWithMinus = `{${key}-1}` // For width-1, height-1

      result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), String(value))
      result = result.replace(new RegExp(placeholderWithMinus.replace(/[{}]/g, '\\$&'), 'g'), String(Number(value) - 1))
    }

    return result
  }

  /**
   * Get raw config for editing
   */
  getRawConfig(): SystemPromptConfig {
    return this.loadConfig()
  }

  /**
   * Reload config from file (useful after external edits)
   */
  reloadConfig(): SystemPromptConfig {
    this.config = null
    return this.loadConfig()
  }
}

// Export singleton instance
export const promptManager = PromptManager.getInstance()
