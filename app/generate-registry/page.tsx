'use client'

import { ArrowClockwise, Check, CircleNotch } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TileDescriptor } from '@/lib/llm/AssetAnalyzer'
import type { ConnectionType, TileConnections } from '@/lib/llm/TileConnectionAnalyzer'
import { modelLoader } from '@/lib/three/ModelLoader'
import { cn } from '@/lib/utils'

interface RegistryData {
  version: string
  generatedAt: string
  totalTiles: number
  tiles: TileDescriptor[]
  approvedTiles?: string[] // Список ID утвержденных тайлов
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
  const [editedConnections, setEditedConnections] = useState<TileConnections | null>(null)

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(0, 8, 8)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true })

    const updateSize = () => {
      const width = 500
      const height = 500
      renderer.setSize(width, height)
      if (cameraRef.current) {
        cameraRef.current.aspect = width / height
        cameraRef.current.updateProjectionMatrix()
      }
    }

    updateSize()
    renderer.shadowMap.enabled = true
    rendererRef.current = renderer

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

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate)
      if (cameraRef.current && sceneRef.current) {
        renderer.render(sceneRef.current, cameraRef.current)
      }
    }
    animate()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const renderTile = useCallback(
    (tile: TileDescriptor) => {
      if (!sceneRef.current || !cameraRef.current) return

      modelLoader
        .loadModel(`tile_${tile.tile_id}`, tile.obj_path, tile.mtl_path)
        .then((model) => {
          if (!sceneRef.current || !cameraRef.current) return

          const group = new THREE.Group()
          group.userData.isTileModel = true
          const modelClone = model.clone()
          group.add(modelClone)

          // Center model
          const box = new THREE.Box3().setFromObject(modelClone)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          modelClone.position.sub(center)

          // Scale model
          const maxDim = Math.max(size.x, size.y, size.z)
          const fov = cameraRef.current.fov * (Math.PI / 180)
          const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5
          const cameraDistance = distance * 1.2
          cameraRef.current.position.set(0, cameraDistance * 0.7, cameraDistance)
          cameraRef.current.lookAt(0, 0, 0)
          cameraRef.current.updateProjectionMatrix()

          // Calculate radii
          const modelRadius = Math.max(size.x, size.z) / 2
          const outerRadius = modelRadius * 1.4 // Increased distance from tile
          const connectionRadius = Math.max(0.15, modelRadius * 0.06)
          const compassRadius = outerRadius + modelRadius * 0.3

          // Hex directions (flat-top hexagon, камера сверху: -Z = вверх экрана, +Z = вниз экрана)
          const directions = [
            {
              name: 'east',
              label: 'E',
              pos: [outerRadius, 0, 0], // +X (право)
              compassPos: [compassRadius, 0, 0],
            },
            {
              name: 'northeast',
              label: 'NE',
              pos: [outerRadius * 0.5, 0, -outerRadius * 0.866], // +X, -Z (вверх экрана)
              compassPos: [compassRadius * 0.5, 0, -compassRadius * 0.866],
            },
            {
              name: 'northwest',
              label: 'NW',
              pos: [-outerRadius * 0.5, 0, -outerRadius * 0.866], // -X, -Z (вверх экрана)
              compassPos: [-compassRadius * 0.5, 0, -compassRadius * 0.866],
            },
            {
              name: 'west',
              label: 'W',
              pos: [-outerRadius, 0, 0], // -X (лево)
              compassPos: [-compassRadius, 0, 0],
            },
            {
              name: 'southwest',
              label: 'SW',
              pos: [-outerRadius * 0.5, 0, outerRadius * 0.866], // -X, +Z (вниз экрана)
              compassPos: [-compassRadius * 0.5, 0, compassRadius * 0.866],
            },
            {
              name: 'southeast',
              label: 'SE',
              pos: [outerRadius * 0.5, 0, outerRadius * 0.866], // +X, +Z (вниз экрана)
              compassPos: [compassRadius * 0.5, 0, compassRadius * 0.866],
            },
          ]

          // Add labels
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
              sprite.position.set(dir.compassPos[0], 3.0, dir.compassPos[2])
              sprite.scale.set(0.4, 0.4, 1)
              sprite.userData.isTileModel = true
              group.add(sprite)
            }
          })

          // Add connection spheres
          const connections =
            editedConnections !== null ? editedConnections : tile.connections || {}
          directions.forEach((dir) => {
            const connectionType = (connections[dir.name as keyof typeof connections] ||
              'none') as ConnectionType

            let color = 0xff0000 // Red for none
            switch (connectionType) {
              case 'grass':
                color = 0x00ff00
                break
              case 'water':
                color = 0x0066ff
                break
              case 'river':
                color = 0x0066ff
                break
              case 'coast':
                color = 0xd2b48c
                break
              case 'road':
                color = 0x8b4513
                break
              default:
                color = 0xff0000
            }

            const geometry = new THREE.SphereGeometry(connectionRadius, 16, 16)
            const material = new THREE.MeshStandardMaterial({
              color,
              emissive: 0x000000,
              roughness: 0.5,
              metalness: 0.1,
            })
            const indicator = new THREE.Mesh(geometry, material)
            indicator.position.set(dir.pos[0], 0.8, dir.pos[2])
            indicator.userData.direction = dir.name
            group.add(indicator)
          })

          sceneRef.current.add(group)
        })
        .catch((error) => {
          console.error(`Failed to load tile ${tile.tile_id}:`, error)
        })
    },
    [editedConnections]
  )

  // Render selected tile
  useEffect(() => {
    if (!sceneRef.current) return

    // Clear scene
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
      setTimeout(() => {
        if (sceneRef.current && selectedTile) {
          renderTile(selectedTile)
        }
      }, 0)
    }
  }, [selectedTile, renderTile])

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
      // Восстанавливаем список утвержденных тайлов из данных
      setApprovedTiles(new Set(data.approvedTiles || []))
    } catch (error) {
      console.error('Error generating registry:', error)
      alert(
        `Ошибка при генерации реестра: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const approveTile = async () => {
    if (!selectedTile || !registryData) return
    const connectionsToSave = editedConnections || {}

    console.log('Утверждение тайла:', selectedTile.tile_id)
    console.log('Соединения для сохранения:', connectionsToSave)

    const updatedTiles = registryData.tiles.map((t) => {
      if (t.tile_id === selectedTile.tile_id) {
        return {
          ...t,
          connections: connectionsToSave,
        }
      }
      return t
    })

    const newApprovedTiles = new Set([...approvedTiles, selectedTile.tile_id])

    const updatedRegistryData = {
      ...registryData,
      tiles: updatedTiles,
      approvedTiles: Array.from(newApprovedTiles), // Сохраняем список утвержденных тайлов
    }

    setRegistryData(updatedRegistryData)
    setApprovedTiles(newApprovedTiles)

    // Сохраняем данные в файл
    try {
      await saveRegistryToFile(updatedRegistryData)
      console.log(`Тайл ${selectedTile.tile_id} утвержден и сохранен`)
    } catch (error) {
      console.error('Ошибка при сохранении тайла:', error)
      alert(
        `Ошибка при сохранении тайла: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
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
      throw error // Пробрасываем ошибку наверх
    }
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

  const getConnectionDisplay = (
    connectionType: string | undefined
  ): { icon: string; label: string; color: string } => {
    switch (connectionType) {
      case 'grass':
        return { icon: '🟢', label: 'Grass', color: '#00ff00' }
      case 'water':
        return { icon: '🔵', label: 'Water', color: '#0066ff' }
      case 'river':
        return { icon: '🔵', label: 'River', color: '#0066ff' }
      case 'coast':
        return { icon: '🟤', label: 'Coast', color: '#d2b48c' }
      case 'road':
        return { icon: '🟫', label: 'Road', color: '#8b4513' }
      default:
        return { icon: '🔴', label: 'None', color: '#ff0000' }
    }
  }

  // Initialize edited connections when tile is selected
  useEffect(() => {
    if (selectedTile) {
      const connections = selectedTile.connections || {}
      const convertedConnections: TileConnections = {}
      const allDirections: Array<keyof TileConnections> = [
        'east',
        'northeast',
        'northwest',
        'west',
        'southwest',
        'southeast',
      ]

      allDirections.forEach((dir) => {
        const value = connections[dir]
        if (typeof value === 'boolean' && value === true) {
          convertedConnections[dir] = 'unknown'
        } else if (typeof value === 'string') {
          convertedConnections[dir] = value
        } else if (value !== undefined && value !== null && typeof value !== 'boolean') {
          convertedConnections[dir] = 'unknown'
        }
      })

      setEditedConnections(convertedConnections)
    } else {
      setEditedConnections(null)
    }
  }, [selectedTile])

  // Handle clicks on connection indicators
  useEffect(() => {
    if (!canvasRef.current || !selectedTile) return

    const handleClick = (event: MouseEvent) => {
      if (!cameraRef.current || !sceneRef.current || !rendererRef.current || !canvasRef.current)
        return

      const rect = canvasRef.current.getBoundingClientRect()
      const mouse = new THREE.Vector2()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, cameraRef.current)

      const intersects = raycaster.intersectObjects(sceneRef.current.children, true)
      const indicator = intersects.find((i) => i.object.userData.direction)

      if (indicator?.object.userData.direction) {
        const direction = indicator.object.userData.direction as keyof TileConnections
        const currentType = editedConnections?.[direction] || 'none'

        const types: ConnectionType[] = ['none', 'grass', 'water', 'river', 'coast', 'road']
        const currentIndex = types.indexOf(currentType as ConnectionType)

        let nextIndex: number
        if (event.button === 0) {
          // Left click - next type
          nextIndex = (currentIndex + 1) % types.length
        } else if (event.button === 2) {
          // Right click - previous type
          nextIndex = (currentIndex - 1 + types.length) % types.length
        } else {
          return
        }

        const nextType = types[nextIndex]

        setEditedConnections((prev) => {
          const next = prev ? { ...prev } : {}
          if (nextType === 'none') {
            delete next[direction]
          } else {
            next[direction] = nextType
          }
          return next
        })
      }
    }

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }

    const canvas = canvasRef.current
    canvas.addEventListener('mousedown', handleClick)
    canvas.addEventListener('contextmenu', handleContextMenu)
    return () => {
      canvas.removeEventListener('mousedown', handleClick)
      canvas.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [selectedTile, editedConnections])

  const tilesToValidate =
    registryData?.tiles.filter(
      (tile) =>
        tile.category === 'tiles' &&
        (tile.subcategory === 'rivers' ||
          tile.subcategory === 'roads' ||
          tile.subcategory === 'coast' ||
          tile.subcategory === 'base')
    ) || []

  return (
    <div className="flex h-screen w-screen bg-background">
      {/* Left Panel: Tile List */}
      <div className="w-96 border-r border-border bg-card">
        <div className="p-4 border-b border-border">
          <h1 className="text-2xl font-bold mb-2">Tile Registry Generation</h1>
          <div className="flex gap-2">
            <Button onClick={generateRegistry} disabled={isGenerating} className="flex-1">
              {isGenerating ? (
                <>
                  <CircleNotch className="mr-2 h-4 w-4 animate-spin" />
                  Загрузка...
                </>
              ) : (
                <>
                  <ArrowClockwise className="mr-2 h-4 w-4" />
                  Загрузить реестр
                </>
              )}
            </Button>
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
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-semibold">
                {selectedTile ? `Просмотр: ${selectedTile.name}` : 'Выберите тайл для просмотра'}
              </h2>
              {selectedTile && (
                <p className="text-sm text-muted-foreground mt-1">
                  ЛКМ по точке - следующий тип, ПКМ - предыдущий тип
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 3D Preview */}
        <div className="w-[500px] h-[500px] bg-muted/30 relative border-b border-border mx-auto overflow-hidden rounded-lg">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        </div>

        {selectedTile && (
          <div className="p-4 border-t border-border">
            {/* Connection comparison interface */}
            {editedConnections && (
              <div className="mb-4">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  {/* Left column - Original data */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
                      Исходные данные
                    </h3>
                    <div className="space-y-1">
                      {(
                        [
                          'west',
                          'northwest',
                          'northeast',
                          'east',
                          'southeast',
                          'southwest',
                        ] as const
                      ).map((direction) => {
                        const connectionType = selectedTile.connections?.[direction] || 'none'
                        const display = getConnectionDisplay(typeof connectionType === 'string' ? connectionType : 'none')
                        return (
                          <div key={direction} className="flex items-center gap-2 text-sm">
                            <span className="uppercase text-xs font-mono w-8">
                              {direction === 'west'
                                ? 'W'
                                : direction === 'northwest'
                                  ? 'NW'
                                  : direction === 'northeast'
                                    ? 'NE'
                                    : direction === 'east'
                                      ? 'E'
                                      : direction === 'southeast'
                                        ? 'SE'
                                        : 'SW'}
                            </span>
                            <div className="flex items-center gap-1">
                              <span>{display.icon}</span>
                              <span style={{ color: display.color }}>{display.label}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Right column - Current data */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
                      Текущие данные
                    </h3>
                    <div className="space-y-1">
                      {(
                        [
                          'west',
                          'northwest',
                          'northeast',
                          'east',
                          'southeast',
                          'southwest',
                        ] as const
                      ).map((direction) => {
                        const connectionType = editedConnections?.[direction] || 'none'
                        const display = getConnectionDisplay(typeof connectionType === 'string' ? connectionType : 'none')
                        return (
                          <div key={direction} className="flex items-center gap-2 text-sm">
                            <span className="uppercase text-xs font-mono w-8">
                              {direction === 'west'
                                ? 'W'
                                : direction === 'northwest'
                                  ? 'NW'
                                  : direction === 'northeast'
                                    ? 'NE'
                                    : direction === 'east'
                                      ? 'E'
                                      : direction === 'southeast'
                                        ? 'SE'
                                        : 'SW'}
                            </span>
                            <div className="flex items-center gap-1">
                              <span>{display.icon}</span>
                              <span style={{ color: display.color }}>{display.label}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                  setEditedConnections(
                    selectedTile.connections ? { ...selectedTile.connections } : {}
                  )
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
