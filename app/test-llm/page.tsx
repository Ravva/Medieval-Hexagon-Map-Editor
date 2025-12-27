'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function TestLLMPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Gemini API Test</CardTitle>
          <CardDescription>
            Тестирование подключения к Google Gemini API (используется gemini-2.5-flash - 1M input, 64K output токенов)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              Список доступных моделей
            </Button>
            <Button
              onClick={() => runTest('simple')}
              disabled={loading}
              variant="default"
            >
              Тест 1: Простое подключение
            </Button>
            <Button
              onClick={() => runTest('json-schema')}
              disabled={loading}
              variant="default"
            >
              Тест 2: JSON Schema
            </Button>
            <Button
              onClick={() => runTest('hex-map-sample')}
              disabled={loading}
              variant="default"
            >
              Тест 3: Пример карты (hex)
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
              Тест 4: Генерация карты 5x5
            </Button>
          </div>

          {loading && (
            <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
              <p className="text-cyan-400">Выполняется запрос к Gemini API...</p>
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
                  {result.success ? 'Успешно' : 'Ошибка'}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {result.testType && (
                    <div>
                      <strong className="text-cyan-400">Тип теста:</strong>{' '}
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

          <div className="pt-4 border-t border-gray-700">
            <h3 className="text-lg font-semibold mb-2">Описание тестов:</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <strong className="text-cyan-400">Тест 1:</strong> Простая проверка
                подключения к API. Генерирует простой ответ без структуры.
              </li>
              <li>
                <strong className="text-cyan-400">Тест 2:</strong> Проверка работы JSON
                Schema. API должен вернуть строго структурированный JSON согласно схеме.
              </li>
              <li>
                <strong className="text-cyan-400">Тест 3:</strong> Тест генерации примера
                гексагональной карты. Проверяет работу со схемой для будущей генерации карт.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

