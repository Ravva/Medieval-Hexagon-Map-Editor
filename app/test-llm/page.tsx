'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type ApiMode = 'gemini' | 'local'

interface LocalModel {
  id: string
  object: string
  owned_by: string
}

export default function TestLLMPage() {
  const [apiMode, setApiMode] = useState<ApiMode>('gemini')
  const [localUrl, setLocalUrl] = useState('http://localhost:1234')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Локальные модели
  const [localModels, setLocalModels] = useState<LocalModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [modelsLoading, setModelsLoading] = useState(false)

  // Автоматическая загрузка моделей при переключении на локальный режим (только если URL не менялся)
  useEffect(() => {
    if (apiMode === 'local' && localModels.length === 0 && !modelsLoading) {
      // Не загружаем автоматически, пользователь должен нажать кнопку
      // Это предотвращает лишние запросы при переключении вкладок
    }
  }, [apiMode, localModels.length, modelsLoading])

  const runTest = async (testType: string) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/llm/test', {
        method: testType === 'simple' ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: testType !== 'simple' ? JSON.stringify({ testType }) : undefined,
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Unknown error')
        setResult(data)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // Functions for testing local server
  const testLocalEndpoint = async (endpoint: string, method: 'GET' | 'POST', body?: any) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const url = `${localUrl}${endpoint}`
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      }

      if (method === 'POST' && body) {
        options.body = JSON.stringify(body)
      }

      const response = await fetch(url, options)

      // Пытаемся получить текст ответа
      const text = await response.text()
      let data: any

      try {
        data = JSON.parse(text)
      } catch {
        // Если не JSON, возвращаем текст
        data = { raw: text, status: response.status, statusText: response.statusText }
      }

      if (!response.ok) {
        setError(data.error || data.message || `HTTP ${response.status}: ${response.statusText}`)
        setResult(data)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  // Загрузка списка моделей
  const loadLocalModels = async () => {
    setModelsLoading(true)
    setError(null)
    try {
      const url = `${localUrl}/v1/models`
      const response = await fetch(url)
      const text = await response.text()
      let data: any

      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text }
      }

      if (!response.ok) {
        setError(data.error || data.message || `HTTP ${response.status}`)
        return
      }

      // Обработка формата ответа
      const models = data.data || data.models || []
      setLocalModels(models)

      // Автоматически выбираем первую модель, если есть
      if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0].id)
      }

      setResult({ success: true, models, count: models.length })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelsLoading(false)
    }
  }

  // Функция для вызова локального chat completions API
  const callLocalChatCompletions = async (messages: any[], options: {
    temperature?: number
    responseFormat?: { type: 'json_schema' | 'text' | 'json_object'; schema?: any }
    systemMessage?: string
  } = {}) => {
    const model = selectedModel || localModels[0]?.id || 'local-model'

    const requestBody: any = {
      model,
      messages: options.systemMessage
        ? [{ role: 'system', content: options.systemMessage }, ...messages]
        : messages,
      temperature: options.temperature ?? 0.7,
    }

    // Добавляем response_format только если указан и не json_object (который не поддерживается)
    if (options.responseFormat && options.responseFormat.type !== 'json_object') {
      requestBody.response_format = options.responseFormat
    }

    const url = `${localUrl}/v1/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const text = await response.text()
    let data: any

    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    return data
  }

  // Tests for local models (similar to Gemini)
  const testLocalSimple = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const data = await callLocalChatCompletions([
        { role: 'user', content: 'Say "Hello, Local LLM API is working!" in JSON format: {"message": "your message here"}' }
      ])

      const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || ''

      setResult({
        success: true,
        testType: 'simple',
        response: content,
        rawResponse: data,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const testLocalJsonSchema = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const systemMessage = `You are a helpful assistant that responds in JSON format.
You must return a JSON object with the following structure:
{
  "message": "string",
  "status": "success" or "error",
  "data": {
    "testNumber": number,
    "testBoolean": boolean
  }
}`

      // Убираем response_format, так как сервер не поддерживает 'json_object'
      // Полагаемся только на system message для структурированного вывода
      const data = await callLocalChatCompletions([
        { role: 'user', content: 'Generate a test response with message "JSON Schema test successful", status "success", and data with testNumber=42 and testBoolean=true. Return ONLY valid JSON, no other text.' }
      ], {
        temperature: 0.7,
        systemMessage,
      })

      const content = data.choices?.[0]?.message?.content || ''
      let parsedResponse
      try {
        parsedResponse = JSON.parse(content)
      } catch (e) {
        parsedResponse = { raw: content }
      }

      setResult({
        success: true,
        testType: 'json-schema',
        response: parsedResponse,
        rawText: content,
        rawResponse: data,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const testLocalHexMapSample = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const systemMessage = `You are an expert game designer. You must respond ONLY with valid JSON.
Return a JSON object with this exact structure:
{
  "hexes": [
    {
      "q": number (0-5),
      "r": number (0-5),
      "tile_id": "string",
      "rotation": number (0, 60, 120, 180, 240, or 300),
      "height": number (0-4)
    }
  ]
}`

      const prompt = `Generate a small 3x3 hex map example (q: 0-2, r: 0-2).
Use tile_id values like "tiles_base_hex_grass", "tiles_base_hex_water", "tiles_base_hex_forest".
Create a simple pattern: center should be water (q=1, r=1), surrounded by grass tiles.
Rotation must be one of: 0, 60, 120, 180, 240, or 300 degrees.
Return exactly 9 hexes (all combinations of q and r from 0 to 2).
Return ONLY valid JSON, no other text.`

      // Убираем response_format, полагаемся на system message
      const data = await callLocalChatCompletions([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.8,
        systemMessage,
      })

      const content = data.choices?.[0]?.message?.content || ''
      let parsedResponse
      try {
        parsedResponse = JSON.parse(content)
      } catch (e) {
        parsedResponse = { raw: content, error: 'Failed to parse JSON' }
      }

      setResult({
        success: true,
        testType: 'hex-map-sample',
        response: parsedResponse,
        rawText: content,
        rawResponse: data,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const testLocalGenerateMap = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const systemMessage = `You are an expert game designer. You must respond ONLY with valid JSON.
Return a JSON object with this exact structure:
{
  "hexes": [
    {
      "q": number (0-4),
      "r": number (0-4),
      "tile_id": "string",
      "rotation": number (0, 60, 120, 180, 240, or 300),
      "height": number (0-4)
    }
  ]
}

Use tile_id values like:
- "tiles_base_hex_grass" for plains/grass
- "tiles_base_hex_water" for water
- "tiles_base_hex_forest" for forests
- "tiles_base_hex_mountain" for mountains`

      const prompt = `Generate a 5x5 hex map (q: 0-4, r: 0-4) for a fantasy war game.
- Use AXIAL coordinates (q, r)
- Create a varied landscape with:
  * A small lake in the center (q: 2, r: 2) using water tiles
  * Some forest areas (use forest tiles)
  * Mostly plains/grass (use grass tiles)
  * Maybe a mountain or two (use mountain tiles)
- Each position (q, r) should have at least one hex
- For elevated features (height > 0), also include a base tile at height 0
- Rotation must be one of: 0, 60, 120, 180, 240, or 300 degrees
- Generate hexes for all 25 positions (5x5 = 25 hexes minimum)
Return ONLY valid JSON, no other text.`

      // Убираем response_format, полагаемся на system message
      const data = await callLocalChatCompletions([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.8,
        systemMessage,
      })

      const content = data.choices?.[0]?.message?.content || ''
      let parsedResponse
      try {
        parsedResponse = JSON.parse(content)
      } catch (e) {
        parsedResponse = { raw: content, error: 'Failed to parse JSON' }
      }

      setResult({
        success: true,
        testType: 'generate-map-5x5',
        hexes: parsedResponse.hexes || [],
        count: parsedResponse.hexes?.length || 0,
        expectedCount: 25,
        response: parsedResponse,
        rawText: content,
        rawResponse: data,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-8 max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>LLM API Test</CardTitle>
          <CardDescription>
            Testing connection to LLM API (Gemini or local server)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={apiMode} onValueChange={(v) => setApiMode(v as ApiMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="gemini">Gemini API</TabsTrigger>
              <TabsTrigger value="local">Локальный сервер</TabsTrigger>
            </TabsList>

            <TabsContent value="gemini" className="space-y-4">
              <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                <p className="text-sm text-cyan-400">
                  Testing Google Gemini API (gemini-2.5-flash - 1M input, 64K output tokens)
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={async () => {
                    setLoading(true)
                    setError(null)
                    setResult(null)
                    try {
                      const res = await fetch('/api/llm/list-models')
                      const data = await res.json()
                      setResult(data)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  variant="outline"
                >
                  Available Models List
                </Button>
                <Button
                  onClick={() => runTest('simple')}
                  disabled={loading}
                  variant="default"
                >
                  Test 1: Simple Connection
                </Button>
                <Button
                  onClick={() => runTest('json-schema')}
                  disabled={loading}
                  variant="default"
                >
                  Test 2: JSON Schema
                </Button>
                <Button
                  onClick={() => runTest('hex-map-sample')}
                  disabled={loading}
                  variant="default"
                >
                  Test 3: Map Example (hex)
                </Button>
                <Button
                  onClick={async () => {
                    setLoading(true)
                    setError(null)
                    setResult(null)
                    try {
                      const res = await fetch('/api/llm/generate-map', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          width: 5,
                          height: 5,
                          theme: 'fantasy_war',
                        }),
                      })
                      const data = await res.json()
                      if (!res.ok) {
                        setError(data.error || 'Unknown error')
                        setResult(data)
                      } else {
                        setResult(data)
                      }
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  variant="default"
                >
                  Test 4: Generate 5x5 Map
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="local" className="space-y-4">
              <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="local-url">Local Server URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="local-url"
                      value={localUrl}
                      onChange={(e) => setLocalUrl(e.target.value)}
                      placeholder="http://localhost:1234"
                      className="flex-1"
                    />
                    <Button
                      onClick={loadLocalModels}
                      disabled={modelsLoading || loading}
                      variant="outline"
                    >
                      {modelsLoading ? 'Loading...' : 'Load Models'}
                    </Button>
                  </div>
                </div>

                {localModels.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="model-select">Select Model</Label>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger id="model-select">
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
                    {selectedModel && (
                      <p className="text-xs text-purple-400">
                        Выбрана модель: <code className="bg-black/30 px-1 rounded">{selectedModel}</code>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={loadLocalModels}
                  disabled={modelsLoading || loading}
                  variant="outline"
                >
                  Available Models List
                </Button>
                <Button
                  onClick={testLocalSimple}
                  disabled={loading || !selectedModel}
                  variant="default"
                >
                  Test 1: Simple Connection
                </Button>
                <Button
                  onClick={testLocalJsonSchema}
                  disabled={loading || !selectedModel}
                  variant="default"
                >
                  Test 2: JSON Schema
                </Button>
                <Button
                  onClick={testLocalHexMapSample}
                  disabled={loading || !selectedModel}
                  variant="default"
                >
                  Test 3: Map Example (hex)
                </Button>
                <Button
                  onClick={testLocalGenerateMap}
                  disabled={loading || !selectedModel}
                  variant="default"
                >
                  Test 4: Generate 5x5 Map
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {loading && (
            <div className={`p-4 border rounded-lg ${
              apiMode === 'gemini'
                ? 'bg-cyan-500/10 border-cyan-500/20'
                : 'bg-purple-500/10 border-purple-500/20'
            }`}>
              <p className={apiMode === 'gemini' ? 'text-cyan-400' : 'text-purple-400'}>
                {apiMode === 'gemini'
                  ? 'Выполняется запрос к Gemini API...'
                  : `Выполняется запрос к ${localUrl}...`}
              </p>
            </div>
          )}

          {error && (
            <Card className="border-red-500/50 bg-red-500/10">
              <CardContent className="pt-6">
                <Badge variant="destructive" className="mb-2">Ошибка</Badge>
                <pre className="text-sm text-red-400 whitespace-pre-wrap font-mono">
                  {error}
                </pre>
              </CardContent>
            </Card>
          )}

          {result && (
            <Card className="border-green-500/50 bg-green-500/10">
              <CardHeader>
                <CardTitle className="text-green-400">Результат</CardTitle>
                <Badge variant="outline" className="w-fit">
                  {result.success !== false ? 'Успешно' : 'Ошибка'}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {result.testType && (
                    <div>
                      <strong className="text-cyan-400">Test Type:</strong>{' '}
                      <code className="text-sm bg-black/30 px-2 py-1 rounded">
                        {result.testType}
                      </code>
                    </div>
                  )}
                  <div>
                    <strong className="text-cyan-400">Ответ API:</strong>
                    <pre className="mt-2 text-sm bg-black/30 p-4 rounded-lg overflow-auto max-h-96 font-mono">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {apiMode === 'gemini' && (
            <div className="pt-4 border-t border-gray-700">
              <h3 className="text-lg font-semibold mb-2">Gemini API Test Descriptions:</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <strong className="text-cyan-400">Test 1:</strong> Simple connection
                  check to the API. Generates a simple response without structure.
                </li>
                <li>
                  <strong className="text-cyan-400">Test 2:</strong> JSON Schema validation
                  test. API should return strictly structured JSON according to schema.
                </li>
                <li>
                  <strong className="text-cyan-400">Test 3:</strong> Hexagonal map generation
                  example test. Checks schema functionality for future map generation.
                </li>
              </ul>
            </div>
          )}

          {apiMode === 'local' && (
            <div className="pt-4 border-t border-gray-700">
              <h3 className="text-lg font-semibold mb-2">Local Model Test Descriptions:</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <strong className="text-purple-400">Model List:</strong> Loads list of available models from local server via GET /v1/models.
                </li>
                <li>
                  <strong className="text-purple-400">Test 1:</strong> Simple connection check to local API. Generates a simple response without structure.
                </li>
                <li>
                  <strong className="text-purple-400">Test 2:</strong> JSON Schema validation via OpenAI-compatible format. API should return strictly structured JSON.
                </li>
                <li>
                  <strong className="text-purple-400">Test 3:</strong> Hexagonal map generation example test. Checks schema functionality for future map generation.
                </li>
                <li>
                  <strong className="text-purple-400">Test 4:</strong> Generate a full 5x5 map using the selected local model.
                </li>
              </ul>
              <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <p className="text-xs text-purple-300">
                  <strong>Note:</strong> To run tests, you must first load the model list and select a model from the list.
                  Local server must support OpenAI-compatible API format (POST /v1/chat/completions).
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

