'use client'

import { useState, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Check, X, ArrowRight, CircleNotch, Download, ArrowClockwise } from '@phosphor-icons/react'
import { modelLoader } from '@/lib/three/ModelLoader'
import { axialToWorld } from '@/lib/game/HexCoordinateConverter'
import { cn } from '@/lib/utils'
import type { TileDescriptor } from '@/lib/llm/AssetAnalyzer'
import type { TileConnections } from '@/lib/llm/TileConnectionAnalyzer'

interface RegistryData {
  version: string
  generatedAt: string
  totalTiles: number
  tiles: TileDescriptor[]
  statistics: {
    byCategory: Record<string, number>
    byBiome: Record<string, number>
    tilesWithConnections: number
  }
}

export default function GenerateRegistryPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const [isGenerating, setIsGenerating] = useState(false)
  const [registryData, setRegistryData] = useState<RegistryData | null>(null)
  const [selectedTile, setSelectedTile] = useState<TileDescriptor | null>(null)
  const [approvedTiles, setApprovedTiles] = useState<Set<string>>(new Set())
  // Редактируемые типы соединений для текущего тайла
  const [editedConnections, setEditedConnections] = useState<TileConnections | null>(null)

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    // Максимальное приближение по умолчанию
    camera.position.set(0, 8, 8)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true })

    // Функция для обновления размера renderer
    const updateSize = () => {
      if (canvasRef.current) {
        const container = canvasRef.current.parentElement
        if (container) {
          const width = container.clientWidth
          const height = container.clientHeight
          renderer.setSize(width, height)
          if (cameraRef.current) {
            cameraRef.current.aspect = width / height
            cameraRef.current.updateProjectionMatrix()
          }
        }
      }
    }

    // Устанавливаем начальный размер
    updateSize()
    renderer.shadowMap.enabled = true
    rendererRef.current = renderer

    // Обработчик изменения размера окна
    const handleResize = () => {
      updateSize()
    }
    window.addEventListener('resize', handleResize)

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 20, 10)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    // Add mouse wheel zoom
    const handleWheel = (event: WheelEvent) => {
      if (!cameraRef.current) return
      event.preventDefault()
      const zoomSpeed = 0.1
      const delta = event.deltaY > 0 ? 1 + zoomSpeed : 1 - zoomSpeed
      cameraRef.current.position.multiplyScalar(delta)
      // Limit zoom
      const minDistance = 3
      const maxDistance = 50
      const distance = cameraRef.current.position.length()
      if (distance < minDistance) {
        cameraRef.current.position.normalize().multiplyScalar(minDistance)
      } else if (distance > maxDistance) {
        cameraRef.current.position.normalize().multiplyScalar(maxDistance)
      }
      cameraRef.current.lookAt(0, 0, 0)
    }

    const canvas = canvasRef.current
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false })
    }

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate)
      if (cameraRef.current && sceneRef.current) {
        renderer.render(sceneRef.current, cameraRef.current)
      }
    }
    animate()

    return () => {
      if (canvas) {
        canvas.removeEventListener('wheel', handleWheel)
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Render selected tile or test pair
  useEffect(() => {
    if (!sceneRef.current) return

    // СНАЧАЛА очищаем ВСЁ перед загрузкой нового
    const objectsToRemove: THREE.Object3D[] = []
    sceneRef.current.traverse((child) => {
      if (child.userData?.isTileModel) {
        objectsToRemove.push(child)
      }
    })
    objectsToRemove.forEach((obj) => {
      if (obj.parent) {
        obj.parent.remove(obj)
      }
    })

    if (selectedTile) {
      // Небольшая задержка чтобы гарантировать очистку
      setTimeout(() => {
        if (sceneRef.current && selectedTile) {
          renderTile(selectedTile)
        }
      }, 0)
    }
  }, [selectedTile, editedConnections])

  const renderTile = (tile: TileDescriptor) => {
    if (!sceneRef.current) return

    modelLoader
      .loadModel(`tile_${tile.tile_id}`, tile.obj_path, tile.mtl_path)
      .then((model) => {
        if (!sceneRef.current) return

        const group = new THREE.Group()
        group.userData.isTileModel = true
        group.add(model.clone())

        const hexSize = 3.5
        const R = 2 / Math.sqrt(3) // Внешний радиус в единицах модели
        const outerRadius = R * hexSize // Внешний радиус в реальных единицах
        const connectionRadius = 0.3
        const compassRadius = outerRadius + 1.5

        // Все 6 граней гексагона (flat-topped)
        const directions = [
          { name: 'east', label: 'E', pos: [outerRadius, 0, 0], compassPos: [compassRadius, 0, 0] },
          { name: 'northeast', label: 'NE', pos: [outerRadius * 0.5, 0, outerRadius * 0.866], compassPos: [compassRadius * 0.5, 0, -compassRadius * 0.866] },
          { name: 'northwest', label: 'NW', pos: [-outerRadius * 0.5, 0, outerRadius * 0.866], compassPos: [-compassRadius * 0.5, 0, -compassRadius * 0.866] },
          { name: 'west', label: 'W', pos: [-outerRadius, 0, 0], compassPos: [-compassRadius, 0, 0] },
          { name: 'southwest', label: 'SW', pos: [-outerRadius * 0.5, 0, -outerRadius * 0.866], compassPos: [-compassRadius * 0.5, 0, compassRadius * 0.866] },
          { name: 'southeast', label: 'SE', pos: [outerRadius * 0.5, 0, -outerRadius * 0.866], compassPos: [compassRadius * 0.5, 0, compassRadius * 0.866] },
        ]

        // Добавляем подписи для всех 6 граней
        directions.forEach((dir) => {
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (context) {
            canvas.width = 64
            canvas.height = 64
            context.fillStyle = 'rgba(255, 255, 255, 0.9)'
            context.font = 'bold 24px Arial'
            context.textAlign = 'center'
            context.textBaseline = 'middle'
            context.fillText(dir.label, 32, 32)
            const texture = new THREE.CanvasTexture(canvas)
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture })
            const sprite = new THREE.Sprite(spriteMaterial)
            sprite.position.set(dir.compassPos[0], 1.5, dir.compassPos[2])
            sprite.scale.set(0.5, 0.5, 1)
            sprite.userData.isTileModel = true
            group.add(sprite)
          }
        })

        // Используем отредактированные соединения или исходные
        // Если editedConnections пустой объект {}, используем его (все будет unknown)
        // Если editedConnections null, используем tile.connections
        const connections = editedConnections !== null ? editedConnections : (tile.connections || {})
        console.log('Rendering tile:', tile.tile_id, 'connections:', connections, 'editedConnections:', editedConnections, 'tile.connections:', tile.connections)

        // Показываем цветные сферы только для граней с соединениями
        directions.forEach((dir) => {
          const connectionType = connections[dir.name as keyof typeof connections]

          // Если нет соединения - ничего не показываем
          if (!connectionType || typeof connectionType !== 'string') {
            return
          }

          // Определяем цвет по типу соединения
          let color = 0xff0000 // Красный для unknown (по умолчанию)

          switch (connectionType) {
            case 'grass':
              color = 0x00ff00 // Чистый зеленый
              break
            case 'water':
              color = 0x0066ff // Чистый синий
              break
            case 'coast':
              color = 0xffaa00 // Оранжево-золотой
              break
            case 'road':
              color = 0x8b4513 // Коричневый
              break
            default:
              color = 0xff0000 // Красный для unknown
          }

          const geometry = new THREE.SphereGeometry(connectionRadius, 16, 16)
          const material = new THREE.MeshStandardMaterial({
            color,
            emissive: 0x000000, // Без свечения
            roughness: 0.5,
            metalness: 0.1
          })
          const indicator = new THREE.Mesh(geometry, material)
          indicator.position.set(dir.pos[0], 0.5, dir.pos[2])
          indicator.userData.direction = dir.name // Сохраняем направление для клика
          group.add(indicator)
        })

        sceneRef.current.add(group)
      })
      .catch((error) => {
        console.error(`Failed to load tile ${tile.tile_id}:`, error)
      })
  }


  const generateRegistry = async () => {
    setIsGenerating(true)
    try {
      const response = await fetch('/api/llm/generate-registry', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to generate registry')
      }

      const data = await response.json()
      setRegistryData(data)
      setApprovedTiles(new Set())
    } catch (error) {
      console.error('Error generating registry:', error)
      alert('Ошибка при генерации реестра: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsGenerating(false)
    }
  }

  const approveTile = () => {
    if (!selectedTile || !registryData) return
    // editedConnections может быть пустым объектом {}, это нормально
    const connectionsToSave = editedConnections || {}

    // Обновляем соединения тайла в registryData
    const updatedTiles = registryData.tiles.map((t) => {
      if (t.tile_id === selectedTile.tile_id) {
        return {
          ...t,
          connections: connectionsToSave,
        }
      }
      return t
    })

    const updatedRegistryData = {
      ...registryData,
      tiles: updatedTiles,
    }

    setRegistryData(updatedRegistryData)
    setApprovedTiles((prev) => new Set([...prev, selectedTile.tile_id]))

    // Сохраняем в файл
    saveRegistryToFile(updatedRegistryData)
  }

  const saveRegistryToFile = async (data: RegistryData) => {
    try {
      const response = await fetch('/api/llm/save-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error('Failed to save registry')
      }
    } catch (error) {
      console.error('Error saving registry:', error)
      alert('Ошибка при сохранении реестра: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const saveRegistry = async () => {
    if (!registryData) return
    await saveRegistryToFile(registryData)
    alert('Реестр успешно сохранен!')
  }

  const getConnectionCount = (exits: TileConnections | undefined): number => {
    if (!exits) return 0
    return Object.values(exits).filter(Boolean).length
  }

  const getConnectionString = (exits: TileConnections | undefined): string => {
    if (!exits) return 'Нет соединений'
    const connections = Object.entries(exits)
      .filter(([, value]) => value)
      .map(([key]) => key)
    return connections.length > 0 ? connections.join(', ') : 'Нет соединений'
  }

  // При выборе тайла инициализируем отредактированные соединения
  useEffect(() => {
    if (selectedTile) {
      // Преобразуем connections: если там boolean, конвертируем в 'unknown'
      // Если там уже строки (типы), используем их
      const connections = selectedTile.connections || {}
      const convertedConnections: TileConnections = {}

      // Все возможные направления
      const allDirections: Array<keyof TileConnections> = ['east', 'northeast', 'northwest', 'west', 'southwest', 'southeast']

      // Конвертируем boolean в строки или используем существующие строки
      allDirections.forEach((dir) => {
        const value = connections[dir]
        if (value === true) {
          // Старый формат: boolean -> конвертируем в 'unknown'
          convertedConnections[dir] = 'unknown'
        } else if (typeof value === 'string') {
          // Новый формат: строка (тип соединения)
          convertedConnections[dir] = value
        } else if (value !== undefined && value !== null) {
          // Любое другое значение -> 'unknown'
          convertedConnections[dir] = 'unknown'
        }
        // Если value === undefined или null, не добавляем в convertedConnections (будет показано как 'unknown' в UI)
      })

      console.log('Initializing editedConnections:', {
        tile_id: selectedTile.tile_id,
        originalConnections: selectedTile.connections,
        convertedConnections,
      })

      setEditedConnections(convertedConnections)
    } else {
      setEditedConnections(null)
    }
  }, [selectedTile])

  // Обработка клика по индикатору соединения для изменения типа
  useEffect(() => {
    if (!canvasRef.current || !selectedTile) return

    const handleClick = (event: MouseEvent) => {
      if (!cameraRef.current || !sceneRef.current || !rendererRef.current) return

      const rect = canvasRef.current.getBoundingClientRect()
      const mouse = new THREE.Vector2()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, cameraRef.current)

      const intersects = raycaster.intersectObjects(sceneRef.current.children, true)
      const indicator = intersects.find((i) => i.object.userData.direction)

      if (indicator && indicator.object.userData.direction) {
        const direction = indicator.object.userData.direction as keyof TileConnections
        const currentType = editedConnections?.[direction] || 'unknown'

        // Циклическое переключение типов: unknown -> grass -> water -> coast -> road -> unknown
        const types: Array<'unknown' | 'grass' | 'water' | 'coast' | 'road'> = ['unknown', 'grass', 'water', 'coast', 'road']
        const currentIndex = types.indexOf(currentType as any)
        const nextIndex = (currentIndex + 1) % types.length
        const nextType = types[nextIndex] === 'unknown' ? undefined : types[nextIndex]

        setEditedConnections((prev) => {
          const next = prev ? { ...prev } : {}
          if (nextType) {
            next[direction] = nextType
          } else {
            delete next[direction]
          }
          return next
        })
      }
    }

    const canvas = canvasRef.current
    canvas.addEventListener('click', handleClick)
    return () => canvas.removeEventListener('click', handleClick)
  }, [selectedTile, editedConnections])

  // Filter tiles that need connection validation (rivers, roads, coast, base)
  const tilesToValidate = registryData?.tiles.filter(
    (tile) =>
      tile.category === 'tiles' &&
      (tile.subcategory === 'rivers' || tile.subcategory === 'roads' || tile.subcategory === 'coast' || tile.subcategory === 'base')
  ) || []

  return (
    <div className="flex h-screen w-screen bg-background">
      {/* Left Panel: Tile List */}
      <div className="w-96 border-r border-border bg-card">
        <div className="p-4 border-b border-border">
          <h1 className="text-2xl font-bold mb-2">Генерация Реестра Тайлов</h1>
          <div className="flex gap-2">
            <Button onClick={generateRegistry} disabled={isGenerating} className="flex-1">
              {isGenerating ? (
                <>
                  <CircleNotch className="mr-2 h-4 w-4 animate-spin" />
                  Генерация...
                </>
              ) : (
                <>
                  <ArrowClockwise className="mr-2 h-4 w-4" />
                  Сгенерировать
                </>
              )}
            </Button>
            {registryData && (
              <Button onClick={saveRegistry} variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Сохранить
              </Button>
            )}
          </div>
        </div>

        {registryData && (
          <div className="p-4 border-b border-border">
            <div className="text-sm text-muted-foreground mb-2">Статистика:</div>
            <div className="space-y-1 text-sm">
              <div>Всего тайлов: {registryData.totalTiles}</div>
              <div>С соединениями: {registryData.statistics.tilesWithConnections}</div>
              <div>Требуют проверки: {tilesToValidate.length}</div>
              <div>Утверждено: {approvedTiles.size}</div>
            </div>
          </div>
        )}

        <ScrollArea className="h-[calc(100vh-200px)]">
          <div className="p-4 space-y-2">
            {tilesToValidate.map((tile) => {
              const isApproved = approvedTiles.has(tile.tile_id)
              const connectionCount = getConnectionCount(tile.connections)

              return (
                <Card
                  key={tile.tile_id}
                  className={cn(
                    'cursor-pointer transition-colors',
                    selectedTile?.tile_id === tile.tile_id && 'ring-2 ring-primary',
                    isApproved && 'bg-green-500/10 border-green-500/50'
                  )}
                  onClick={() => setSelectedTile(tile)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{tile.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {tile.subcategory} • {connectionCount} соединений
                        </div>
                        {tile.connections && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {getConnectionString(tile.connections)}
                          </div>
                        )}
                      </div>
                      {isApproved && (
                        <Check className="h-4 w-4 text-green-500 flex-shrink-0 ml-2" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Center: 3D Preview */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold">
            {selectedTile
              ? `Просмотр: ${selectedTile.name}`
              : 'Выберите тайл для просмотра'}
          </h2>
          {selectedTile && (
            <p className="text-sm text-muted-foreground mt-1">
              Кликните по кружку на грани для изменения типа соединения
            </p>
          )}
        </div>
        <div className="flex-1 bg-muted/30 relative">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        </div>
        {selectedTile && (
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <Button
                onClick={approveTile}
                variant={approvedTiles.has(selectedTile.tile_id) ? 'default' : 'outline'}
              >
                <Check className="mr-2 h-4 w-4" />
                Утвердить
              </Button>
              <Button
                onClick={() => {
                  setEditedConnections(selectedTile.connections ? { ...selectedTile.connections } : {})
                }}
                variant="outline"
              >
                <ArrowClockwise className="mr-2 h-4 w-4" />
                Сбросить изменения
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


