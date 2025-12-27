/**
 * LLMClient - Client for Google Gemini API
 *
 * Handles:
 * - API calls to Gemini 2.5 Flash
 * - JSON Schema support for structured output
 * - Error handling and retry logic
 * - Rate limiting
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

export interface LLMResponse<T = any> {
  content: T
  rawText: string
}

export interface LLMRequestOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  responseSchema?: object // JSON Schema
}

export class LLMClient {
  private apiKey: string
  private genAI: GoogleGenerativeAI
  private modelName: string
  private defaultTemperature: number

  constructor(apiKey?: string, modelName: string = 'gemini-2.5-flash') {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || ''
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required')
    }

    this.genAI = new GoogleGenerativeAI(this.apiKey)
    this.modelName = modelName
    this.defaultTemperature = 0.7
  }

  /**
   * Generate content with optional JSON Schema
   */
  async generateContent<T = any>(
    prompt: string,
    options: LLMRequestOptions = {}
  ): Promise<LLMResponse<T>> {
    const model = this.genAI.getGenerativeModel({
      model: options.model || this.modelName,
      generationConfig: {
        temperature: options.temperature ?? this.defaultTemperature,
        ...(options.responseSchema && {
          responseMimeType: 'application/json',
          responseSchema: options.responseSchema,
        }),
      },
    })

    try {
      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      // Parse JSON if schema was provided
      let content: T
      if (options.responseSchema) {
        try {
          content = JSON.parse(text) as T
        } catch (e) {
          throw new Error(`Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        content = text as T
      }

      return {
        content,
        rawText: text,
      }
    } catch (error) {
      // Handle quota errors
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('Quota exceeded')) {
        throw new Error(`API quota exceeded: ${errorMessage}`)
      }

      // Handle model not found
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        throw new Error(`Model not found: ${errorMessage}`)
      }

      // Re-throw other errors
      throw error
    }
  }

  /**
   * Generate content with retry logic
   */
  async generateContentWithRetry<T = any>(
    prompt: string,
    options: LLMRequestOptions = {},
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<LLMResponse<T>> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.generateContent<T>(prompt, options)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry on quota or model errors
        const errorMessage = lastError.message
        if (
          errorMessage.includes('quota') ||
          errorMessage.includes('429') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('404')
        ) {
          throw lastError
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries - 1) {
          const delay = retryDelay * Math.pow(2, attempt)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError || new Error('Unknown error')
  }

  /**
   * Get model instance (for direct access if needed)
   */
  getModel(modelName?: string) {
    return this.genAI.getGenerativeModel({
      model: modelName || this.modelName,
    })
  }
}

// Singleton instance (lazy initialization)
let llmClientInstance: LLMClient | null = null

export function getLLMClient(apiKey?: string): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient(apiKey)
  }
  return llmClientInstance
}

