'use client'

import { useState, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Check, X, ArrowRight, CircleNotch, Download, ArrowClockwise, Eye } from '@phosphor-icons/react'
import { modelLoader } from '@/lib/three/ModelLoader'
import { axialToWorld } from '@/lib/game/HexCoordinateConverter'
import { cn } from '@/lib/utils'
import type { TileDescriptor } from '@/lib/llm/AssetAnalyzer'
import type { TileConnections } from '@/lib/llm/TileConnectionAnalyzer'
import { renderTileFromMultipleAngles, extractBase64FromDataUrl } from '@/lib/llm/TileVisionRenderer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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

  // Vision analysis settings
  const [visionDialogOpen, setVisionDialogOpen] = useState(false)
  const [visionUrl, setVisionUrl] = useState('http://localhost:1234')
  const [visionModels, setVisionModels] = useState<Array<{ id: string; object: string; owned_by: string }>>([])
  const [selectedVisionModel, setSelectedVisionModel] = useState<string>('')
  const [loadingVisionModels, setLoadingVisionModels] = useState(false)
  const [analyzingVision, setAnalyzingVision] = useState(false)

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    // Начальная позиция камеры (будет автоматически подстроена при загрузке модели)
    camera.position.set(0, 8, 8)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true })

    // Функция для обновления размера renderer (фиксированный размер 1000x1000)
    const updateSize = () => {
      const width = 1000
      const height = 1000
      renderer.setSize(width, height)
      if (cameraRef.current) {
        cameraRef.current.aspect = width / height
        cameraRef.current.updateProjectionMatrix()
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

    // Фиксированная камера - без zoom (чтобы ничего не прыгало)
    // Камера остается в фиксированной позиции для стабильного отображения

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
    if (!sceneRef.current || !cameraRef.current) return

    modelLoader
      .loadModel(`tile_${tile.tile_id}`, tile.obj_path, tile.mtl_path)
      .then((model) => {
        if (!sceneRef.current || !cameraRef.current) return

        const group = new THREE.Group()
        group.userData.isTileModel = true
        const modelClone = model.clone()
        group.add(modelClone)

        // Вычисляем bounding box модели для центрирования
        const box = new THREE.Box3().setFromObject(modelClone)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())

        // Центрируем модель в начале координат
        modelClone.position.sub(center)

        // Вычисляем максимальный размер для масштабирования
        const maxDim = Math.max(size.x, size.y, size.z)

        // Масштабируем модель так, чтобы она помещалась в кадр
        // Используем фиксированный размер кадра (1000x1000) и FOV 45°
        const fov = cameraRef.current.fov * (Math.PI / 180)
        const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.5 // 1.5 для запаса

        // Позиционируем камеру для оптимального обзора
        // Слегка сверху и сбоку для лучшего обзора гексагона
        const cameraDistance = distance * 1.2
        cameraRef.current.position.set(0, cameraDistance * 0.7, cameraDistance)
        cameraRef.current.lookAt(0, 0, 0)

        // Обновляем projection matrix после изменения позиции
        cameraRef.current.updateProjectionMatrix()

        // Вычисляем радиусы на основе реального размера модели после центрирования
        // Используем размер модели для определения масштаба
        const modelRadius = Math.max(size.x, size.z) / 2
        // Для гексагона: внешний радиус примерно равен modelRadius
        const outerRadius = modelRadius * 1.0
        const connectionRadius = Math.max(0.15, modelRadius * 0.06) // Адаптивный размер индикаторов
        const compassRadius = outerRadius + modelRadius * 0.3

        // Все 6 граней гексагона (flat-topped)
        const directions = [
          { name: 'east', label: 'E', pos: [outerRadius, 0, 0], compassPos: [compassRadius, 0, 0] },
          { name: 'northeast', label: 'NE', pos: [outerRadius * 0.5, 0, outerRadius * 0.866], compassPos: [compassRadius * 0.5, 0, -compassRadius * 0.866] },
          { name: 'northwest', label: 'NW', pos: [-outerRadius * 0.5, 0, outerRadius * 0.866], compassPos: [-compassRadius * 0.5, 0, -compassRadius * 0.866] },
          { name: 'west', label: 'W', pos: [-outerRadius, 0, 0], compassPos: [-compassRadius, 0, 0] },
          { name: 'southwest', label: 'SW', pos: [-outerRadius * 0.5, 0, -outerRadius * 0.866], compassPos: [-compassRadius * 0.5, 0, compassRadius * 0.866] },
          { name: 'southeast', label: 'SE', pos: [outerRadius * 0.5, 0, -outerRadius * 0.866], compassPos: [compassRadius * 0.5, 0, compassRadius * 0.866] },
        ]

        // Добавляем подписи для всех 6 граней (выше, чтобы не перекрывать тайл)
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
            // Поднимаем подписи выше, чтобы не перекрывать тайл
            sprite.position.set(dir.compassPos[0], 3.0, dir.compassPos[2])
            sprite.scale.set(0.4, 0.4, 1) // Немного уменьшаем размер
            sprite.userData.isTileModel = true
            group.add(sprite)
          }
        })

        // Используем отредактированные соединения или исходные
        // Если editedConnections пустой объект {}, используем его (все будет unknown)
        // Если editedConnections null, используем tile.connections
        const connections = editedConnections !== null ? editedConnections : (tile.connections || {})
        // Убрали console.log для чистоты кода

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
          // Поднимаем индикаторы выше, чтобы не перекрывать тайл
          indicator.position.set(dir.pos[0], 0.8, dir.pos[2])
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

      // Инициализация editedConnections без логирования

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

  // Загрузка списка vision моделей
  const loadVisionModels = async () => {
    setLoadingVisionModels(true)
    try {
      const url = `${visionUrl}/v1/models`
      const response = await fetch(url)
      const text = await response.text()
      let data: any

      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text }
      }

      if (!response.ok) {
        alert(`Ошибка загрузки моделей: ${data.error || data.message || `HTTP ${response.status}`}`)
        return
      }

      const models = data.data || data.models || []
      setVisionModels(models)

      // Автоматически выбираем первую модель, если есть
      if (models.length > 0) {
        // Если уже выбрана модель и она есть в списке - оставляем её
        // Иначе выбираем первую
        const currentModelExists = models.some(m => m.id === selectedVisionModel)
        if (!currentModelExists || !selectedVisionModel) {
          const firstModelId = models[0].id
          setSelectedVisionModel(firstModelId)
        }
      } else {
        setSelectedVisionModel('')
      }
    } catch (err) {
      alert(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoadingVisionModels(false)
    }
  }

  // Vision анализ соединений
  const analyzeConnectionsWithVision = async () => {
    if (!selectedTile || !sceneRef.current || !cameraRef.current || !rendererRef.current) {
      alert('Выберите тайл для анализа')
      return
    }

    if (!selectedVisionModel && visionModels.length === 0) {
      alert('Загрузите список моделей и выберите vision модель')
      return
    }

    setAnalyzingVision(true)
    try {
      // Создаем отдельную сцену только для vision анализа (без меток и подписей)
      const visionScene = new THREE.Scene()
      visionScene.background = new THREE.Color(0x1a1a1a)

      // Копируем освещение из основной сцены
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
      visionScene.add(ambientLight)
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
      directionalLight.position.set(10, 20, 10)
      visionScene.add(directionalLight)

      // Загружаем модель тайла без меток и индикаторов
      const model = await modelLoader.loadModel(`vision_${selectedTile.tile_id}`, selectedTile.obj_path, selectedTile.mtl_path)
      const modelClone = model.clone()

      // Центрируем модель
      const box = new THREE.Box3().setFromObject(modelClone)
      const center = box.getCenter(new THREE.Vector3())
      modelClone.position.sub(center)

      visionScene.add(modelClone)

      // Создаем временную камеру для vision анализа
      const visionCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const fov = visionCamera.fov * (Math.PI / 180)
      const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.5
      const cameraDistance = distance * 1.2
      visionCamera.position.set(0, cameraDistance * 0.7, cameraDistance)
      visionCamera.lookAt(0, 0, 0)
      visionCamera.updateProjectionMatrix()

      // Рендерим тайл с 6 разных углов (только модель, без меток)
      const images = await renderTileFromMultipleAngles(
        visionScene,
        visionCamera,
        rendererRef.current,
        {
          width: 512,
          height: 512,
          fov: 45,
          distance: cameraDistance,
        }
      )

      // Очищаем временную сцену
      visionScene.clear()

      // Конвертируем в base64 (убираем data: префикс)
      const base64Images = images.map((img) => extractBase64FromDataUrl(img))

      // Определяем tileType и biome из selectedTile
      const tileType = selectedTile.category === 'tiles'
        ? (selectedTile.subcategory === 'rivers' ? 'river'
          : selectedTile.subcategory === 'roads' ? 'road'
          : selectedTile.subcategory === 'coast' ? 'coast'
          : selectedTile.subcategory === 'base' ? 'base'
          : 'other')
        : 'other'

      // Вызываем API для vision анализа
      const response = await fetch('/api/llm/analyze-connections-vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          images: base64Images,
          localUrl: visionUrl,
          model: selectedVisionModel || visionModels[0]?.id,
          tileType,
          biome: selectedTile.biome,
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Vision анализ не удался')
      }

      // Применяем результаты к editedConnections
      if (data.connections) {
        // Получаем текущие соединения для сравнения
        const currentConnections = editedConnections || selectedTile.connections || {}
        const newConnections = data.connections

        // Сравниваем и формируем описание изменений
        const changes: string[] = []
        const unchanged: string[] = []
        const added: string[] = []
        const removed: string[] = []

        const allDirections = ['east', 'southeast', 'southwest', 'west', 'northwest', 'northeast'] as const
        const typeLabels: Record<string, string> = {
          grass: '🟢 Трава',
          water: '🔵 Вода',
          coast: '🟠 Побережье',
          road: '🟤 Дорога',
          unknown: '🔴 Неизвестно',
        }

        const directionLabels: Record<string, string> = {
          east: 'Восток (E)',
          southeast: 'Юго-Восток (SE)',
          southwest: 'Юго-Запад (SW)',
          west: 'Запад (W)',
          northwest: 'Северо-Запад (NW)',
          northeast: 'Северо-Восток (NE)',
        }

        allDirections.forEach((dir) => {
          const current = currentConnections[dir]
          const vision = newConnections[dir]

          if (!current && vision) {
            // Добавлено новое соединение
            added.push(`  ➕ ${directionLabels[dir]}: ${typeLabels[vision] || vision}`)
          } else if (current && !vision) {
            // Удалено соединение
            removed.push(`  ➖ ${directionLabels[dir]}: было ${typeLabels[current] || current}`)
          } else if (current && vision && current !== vision) {
            // Изменен тип
            changes.push(`  🔄 ${directionLabels[dir]}: ${typeLabels[current] || current} → ${typeLabels[vision] || vision}`)
          } else if (current === vision && current) {
            // Без изменений
            unchanged.push(`  ✓ ${directionLabels[dir]}: ${typeLabels[current] || current}`)
          }
        })

        // Формируем сравнительное сообщение
        let message = '✅ Vision анализ завершен!\n\n'

        if (changes.length > 0) {
          message += `🔄 Изменения:\n${changes.join('\n')}\n\n`
        }

        if (added.length > 0) {
          message += `➕ Добавлено:\n${added.join('\n')}\n\n`
        }

        if (removed.length > 0) {
          message += `➖ Удалено:\n${removed.join('\n')}\n\n`
        }

        if (unchanged.length > 0) {
          message += `✓ Без изменений:\n${unchanged.join('\n')}\n\n`
        }

        // Статистика
        const connectionTypes: Record<string, number> = {}
        Object.values(newConnections).forEach((type) => {
          if (type) {
            connectionTypes[type] = (connectionTypes[type] || 0) + 1
          }
        })

        const typeList = Object.entries(connectionTypes)
          .map(([type, count]) => `  • ${typeLabels[type] || type}: ${count}`)
          .join('\n')

        message += `📊 Итоговая статистика:\n${typeList}`

        setEditedConnections(newConnections)
        alert(message)
        // Закрываем диалог после успешного анализа
        setVisionDialogOpen(false)
      } else {
        alert('Vision модель не обнаружила соединений')
      }
    } catch (error) {
      alert(`Ошибка vision анализа: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAnalyzingVision(false)
    }
  }

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
          <div className="flex items-start justify-between">
            <div className="flex-1">
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
            {selectedTile && (
              <div className="ml-4">
                <Button
                  onClick={() => {
                    setVisionDialogOpen(true)
                    if (visionModels.length === 0) {
                      loadVisionModels()
                    }
                  }}
                  variant="outline"
                  size="sm"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Vision анализ
                </Button>
              </div>
            )}
          </div>
        </div>
        {/* 3D превью 1000x1000 с скругленными углами */}
        <div className="w-[1000px] h-[1000px] bg-muted/30 relative border-b border-border mx-auto overflow-hidden rounded-lg">
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

        {/* Vision Analysis Dialog */}
        <Dialog open={visionDialogOpen} onOpenChange={setVisionDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Vision анализ соединений</DialogTitle>
              <DialogDescription>
                Используйте локальную vision модель для автоматического определения типов соединений тайла
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="vision-url">URL локального сервера</Label>
                <div className="flex gap-2">
                  <Input
                    id="vision-url"
                    value={visionUrl}
                    onChange={(e) => setVisionUrl(e.target.value)}
                    placeholder="http://localhost:1234"
                    className="flex-1"
                  />
                  <Button
                    onClick={loadVisionModels}
                    disabled={loadingVisionModels || analyzingVision}
                    variant="outline"
                    size="sm"
                  >
                    {loadingVisionModels ? (
                      <>
                        <CircleNotch className="mr-2 h-4 w-4 animate-spin" />
                        Загрузка...
                      </>
                    ) : (
                      'Загрузить'
                    )}
                  </Button>
                </div>
              </div>

              {visionModels.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="vision-model">Vision модель</Label>
                  <Select
                    value={selectedVisionModel}
                    onValueChange={setSelectedVisionModel}
                  >
                    <SelectTrigger id="vision-model">
                      <SelectValue placeholder="Выберите модель">
                        {selectedVisionModel || 'Выберите модель'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {visionModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Найдено моделей: {visionModels.length}
                    {selectedVisionModel && ` • Выбрано: ${selectedVisionModel}`}
                  </p>
                </div>
              )}

              {visionModels.length === 0 && !loadingVisionModels && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    Нажмите "Загрузить" для получения списка доступных vision моделей
                  </p>
                </div>
              )}

              {selectedTile && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <p className="text-sm font-semibold mb-1">Тайл для анализа:</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedTile.name} ({selectedTile.category}/{selectedTile.subcategory})
                  </p>
                </div>
              )}

              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <p className="font-semibold mb-1">Примечание:</p>
                <p>
                  Vision анализ создаст 6 скриншотов тайла с разных углов и отправит их в модель для определения типов соединений.
                  Это может занять 1-3 минуты в зависимости от модели.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVisionDialogOpen(false)} disabled={analyzingVision}>
                Отмена
              </Button>
              <Button
                onClick={async () => {
                  await analyzeConnectionsWithVision()
                  if (!analyzingVision) {
                    setVisionDialogOpen(false)
                  }
                }}
                disabled={
                  analyzingVision ||
                  !selectedVisionModel ||
                  visionModels.length === 0 ||
                  !selectedTile
                }
              >
                {analyzingVision ? (
                  <>
                    <CircleNotch className="mr-2 h-4 w-4 animate-spin" />
                    Анализ...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Анализировать соединения
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}


