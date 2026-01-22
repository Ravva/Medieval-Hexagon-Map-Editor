import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { getAssetPath } from '@/lib/utils/paths'
import {
  MapTrifold,
  FloppyDisk,
  FolderOpen,
  Trash,
  CaretLeft,
  CaretUp,
  CaretDown,
  ArrowsInLineHorizontal,
  ArrowsInLineVertical,
  Cube,
  SelectionPlus,
  Compass,
  List,
  Keyboard,
  Sparkle,
  File
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SaveMapDialog, type SaveMapData } from '@/components/SaveMapDialog'
import { NewMapDialog } from '@/components/NewMapDialog'
import { UnsavedDataDialog } from '@/components/UnsavedDataDialog'
import { Hex, TERRAIN_CONFIG, TERRAIN_TYPES, type TerrainType } from '@/lib/game/Hex'
import { Map as GameMap } from '@/lib/game/Map'
import { MapSerializer, type BuildingData } from '@/lib/game/MapSerializer'
import { axialToWorld, worldToAxial, offsetToAxial } from '@/lib/game/HexCoordinateConverter'
import { modelLoader } from '@/lib/three/ModelLoader'
import { cn } from '@/lib/utils'

type EditMode = 'terrain' | 'building'

type MapSize = 'tiny' | 'small' | 'medium' | 'large' | 'very-large'

const MAP_SIZES: Record<MapSize, { label: string; width: number; height: number }> = {
  'tiny': { label: 'Tiny', width: 10, height: 10 },
  'small': { label: 'Small', width: 25, height: 25 },
  'medium': { label: 'Medium', width: 50, height: 50 },
  'large': { label: 'Large', width: 75, height: 75 },
  'very-large': { label: 'Very large', width: 100, height: 100 },
}

interface AssetModel {
  name: string
  obj: string
  mtl: string
}

interface AssetFolder {
  name: string
  models: AssetModel[]
}

interface AssetCategory {
  name: string
  folders: AssetFolder[]
}

interface ClipboardData {
  hexes: Array<{
    q: number
    r: number
    terrain: TerrainType
    height: number
    rotation?: number
    modelData?: { obj: string; mtl: string; name: string }
    hasRiver?: boolean
  }>
  sourceHeight: number
  globalLevel: number
  // Для обратной совместимости с одиночным выделением
  hex?: {
    q: number
    r: number
    terrain: TerrainType
    height: number
    rotation?: number
    modelData?: { obj: string; mtl: string; name: string }
    hasRiver?: boolean
  }
}

interface HistoryState {
  map: string // JSON сериализация карты
  timestamp: number
}

// Глобальный рендерер и сцена для превью (чтобы не превышать лимит WebGL контекстов)
let sharedPreviewRenderer: THREE.WebGLRenderer | null = null
let sharedPreviewScene: THREE.Scene | null = null
let sharedPreviewCamera: THREE.PerspectiveCamera | null = null

// Очередь для последовательного рендеринга превью
let renderQueue: Promise<void> = Promise.resolve()

// Функция для проверки загрузки всех текстур в объекте
const waitForTexturesLoaded = (object: THREE.Object3D, maxWait = 3000): Promise<void> => {
  const textures: THREE.Texture[] = []

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const material = child.material
      const materials = Array.isArray(material) ? material : [material]

      materials.forEach((mat) => {
        if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhongMaterial || mat instanceof THREE.MeshLambertMaterial) {
          if (mat.map && !textures.includes(mat.map)) textures.push(mat.map)
          if (mat.normalMap && !textures.includes(mat.normalMap)) textures.push(mat.normalMap)
          if (mat.aoMap && !textures.includes(mat.aoMap)) textures.push(mat.aoMap)
          if (mat.emissiveMap && !textures.includes(mat.emissiveMap)) textures.push(mat.emissiveMap)

          if (mat instanceof THREE.MeshStandardMaterial) {
            if (mat.roughnessMap && !textures.includes(mat.roughnessMap)) textures.push(mat.roughnessMap)
            if (mat.metalnessMap && !textures.includes(mat.metalnessMap)) textures.push(mat.metalnessMap)
          }
        }
      })
    }
  })

  if (textures.length === 0) {
    // Нет текстур - ждем один кадр для применения материалов
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  // Проверяем, что все текстуры загружены
  return Promise.all(
    textures.map((texture) => {
      return new Promise<void>((resolve) => {
        // Проверяем, есть ли у текстуры изображение
        if (!texture.image) {
          // Текстура еще не имеет изображения - ждем
          const checkInterval = setInterval(() => {
            if (texture.image) {
              clearInterval(checkInterval)
              clearTimeout(timeout)
              resolve()
            }
          }, 50)

          const timeout = setTimeout(() => {
            clearInterval(checkInterval)
            resolve() // Продолжаем даже если таймаут
          }, maxWait)
          return
        }

        const image = texture.image as HTMLImageElement | HTMLCanvasElement | VideoFrame | ImageBitmap | null

        // Canvas и другие типы всегда готовы
        if (image instanceof HTMLCanvasElement || image instanceof ImageBitmap || image instanceof VideoFrame) {
          resolve()
          return
        }

        // Для HTMLImageElement проверяем complete
        if (image instanceof HTMLImageElement) {
          if (image.complete && image.naturalWidth > 0) {
            resolve()
            return
          }

          // Ждем загрузки
          let resolved = false
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true
              resolve() // Продолжаем даже если таймаут
            }
          }, maxWait)

          const originalOnLoad = image.onload
          const originalOnError = image.onerror

          image.onload = () => {
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              if (originalOnLoad) originalOnLoad.call(image, new Event('load'))
              resolve()
            }
          }

          image.onerror = () => {
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              if (originalOnError) originalOnError.call(image, new ErrorEvent('error'))
              resolve() // Продолжаем даже при ошибке
            }
          }
        } else {
          resolve()
        }
      })
    })
  ).then(() => {
    // Дополнительная задержка для применения текстур в GPU
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })
}

const initSharedPreview = () => {
  if (typeof window === 'undefined') return null
  if (!sharedPreviewRenderer) {
    try {
      sharedPreviewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
      sharedPreviewRenderer.setPixelRatio(1) // Для превью достаточно 1х для скорости
      sharedPreviewRenderer.setSize(120, 120)

      sharedPreviewScene = new THREE.Scene()
      // Улучшенное освещение: заполняющее + несколько направленных источников
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
      sharedPreviewScene.add(ambientLight)

      const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0)
      sharedPreviewScene.add(hemisphereLight)

      const mainLight = new THREE.DirectionalLight(0xffffff, 1.2)
      mainLight.position.set(5, 10, 7.5)
      sharedPreviewScene.add(mainLight)

      const fillLight = new THREE.DirectionalLight(0xffffff, 0.6)
      fillLight.position.set(-5, 5, -5)
      sharedPreviewScene.add(fillLight)

      sharedPreviewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
      sharedPreviewCamera.position.set(4, 4, 4)
      sharedPreviewCamera.lookAt(0, 0, 0)
    } catch (e) {
      console.error('Failed to init shared preview renderer:', e)
      return null
    }
  }
  return { renderer: sharedPreviewRenderer, scene: sharedPreviewScene!, camera: sharedPreviewCamera! }
}

function ModelPreview({ obj, mtl }: { obj: string; mtl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hasImage, setHasImage] = useState(false)
  const previewIdRef = useRef<string>(`preview_${Date.now()}_${Math.random()}`)

  useEffect(() => {
    const shared = initSharedPreview()
    if (!shared || !canvasRef.current) return

    // Сбрасываем состояние при изменении модели
    setHasImage(false)
    const ctx = canvasRef.current.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, 120, 120)
    }

    let isMounted = true
    const { renderer, scene, camera } = shared
    const previewId = previewIdRef.current
    let tempGroup: THREE.Group | null = null

    modelLoader.loadModel(`${obj}_preview`, getAssetPath(obj), getAssetPath(mtl)).then(model => {
      if (!isMounted) return

      const modelInstance = model.clone()

      // Вычисляем bounding box модели
      const box = new THREE.Box3().setFromObject(modelInstance)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())

      // Находим максимальный размер для пропорционального масштабирования
      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = 3.8 / (maxDim || 1)

      // Применяем одинаковый масштаб ко всем осям для сохранения пропорций
      modelInstance.scale.set(scale, scale, scale)

      // Центрируем модель после масштабирования
      const scaledCenter = center.clone().multiplyScalar(scale)
      modelInstance.position.sub(scaledCenter)

      modelInstance.rotation.y = Math.PI / 2

      // Добавляем в очередь рендеринга для последовательной обработки
      renderQueue = renderQueue.then(() => {
        return new Promise<void>((resolve) => {
          if (!isMounted) {
            resolve()
            return
          }

          // Очищаем сцену от предыдущего превью этого компонента
          const existingPreview = scene.getObjectByName(previewId)
          if (existingPreview) {
            scene.remove(existingPreview)
          }

          // Добавляем модель в сцену с уникальным именем
          tempGroup = new THREE.Group()
          tempGroup.name = previewId
          tempGroup.add(modelInstance)
          scene.add(tempGroup)

          // Ждем загрузки всех текстур
          waitForTexturesLoaded(modelInstance, 3000).then(() => {
            if (!isMounted || !tempGroup) {
              resolve()
              return
            }

            // Рендерим один кадр
            renderer.setClearColor(0x000000, 0)
            renderer.render(scene, camera)

            // Копируем результат на 2D канвас компонента с правильными пропорциями
            const ctx = canvasRef.current?.getContext('2d')
            if (ctx && canvasRef.current) {
              // Очищаем канвас
              ctx.clearRect(0, 0, 120, 120)

              // Копируем изображение с сохранением пропорций
              // WebGL рендерер имеет размер 120x120, поэтому просто копируем как есть
              ctx.drawImage(
                renderer.domElement,
                0, 0, 120, 120,  // источник: x, y, width, height
                0, 0, 120, 120   // назначение: x, y, width, height
              )

              if (isMounted) {
                setHasImage(true)
              }
            }

            // Убираем модель из общей сцены только после копирования
            if (tempGroup) {
              scene.remove(tempGroup)
              tempGroup = null
            }

            resolve()
          }).catch(() => {
            // В случае ошибки все равно пытаемся отрендерить
            if (!isMounted || !tempGroup) {
              resolve()
              return
            }

            renderer.setClearColor(0x000000, 0)
            renderer.render(scene, camera)

            const ctx = canvasRef.current?.getContext('2d')
            if (ctx && canvasRef.current) {
              ctx.clearRect(0, 0, 120, 120)
              ctx.drawImage(renderer.domElement, 0, 0, 120, 120, 0, 0, 120, 120)
              if (isMounted) {
                setHasImage(true)
              }
            }

            if (tempGroup) {
              scene.remove(tempGroup)
              tempGroup = null
            }

            resolve()
          })
        })
      })
    }).catch(err => console.error('Preview load error:', err))

    return () => {
      isMounted = false
      // Удаляем модель из сцены при размонтировании
      renderQueue = renderQueue.then(() => {
        const existingPreview = scene.getObjectByName(previewId)
        if (existingPreview) {
          scene.remove(existingPreview)
        }
      })
    }
  }, [obj, mtl])

  return (
    <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
      {!hasImage && <div className="absolute inset-0 flex items-center justify-center"><Cube className="animate-spin text-muted-foreground/30" size={24} /></div>}
      <canvas ref={canvasRef} width={120} height={120} className={cn("w-full h-full pointer-events-none transition-opacity duration-300", hasImage ? "opacity-100" : "opacity-0")} />
    </div>
  )
}

export default function MapEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GameMap | null>(null)
  const hexMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const buildingObjectsRef = useRef<Map<string, THREE.Group>>(new Map())
  const selectionMeshRef = useRef<THREE.Mesh | null>(null)
  const selectionMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const animationFrameRef = useRef<number | null>(null)
  const draggedModelRef = useRef<{ obj: string; mtl: string; name: string } | null>(null)
  const tileHeightRef = useRef<number>(1.0) // Will be updated from first loaded model
  const clipboardDataRef = useRef<ClipboardData | null>(null)
  const historyRef = useRef<HistoryState[]>([])
  const historyIndexRef = useRef<number>(-1)
  const maxHistorySize = 50
  const isUndoRedoInProgressRef = useRef<boolean>(false)

  const [isLoading, setIsLoading] = useState(true)
  const [loadingText, setLoadingText] = useState('Initializing...')
  const [mapSize, setMapSize] = useState<MapSize>('tiny')
  const [selectedTerrain, setSelectedTerrain] = useState<TerrainType>(TERRAIN_TYPES.PLAINS)
  const [editMode, setEditMode] = useState<EditMode>('terrain')
  const [selectedHexes, setSelectedHexes] = useState<Array<{ q: number; r: number }>>([])
  // Для обратной совместимости
  const selectedHex = selectedHexes.length > 0 ? selectedHexes[0] : null
  const [currentHeightLevel, setCurrentHeightLevel] = useState(0) // Global height level 0-4
  const [selectedModel, setSelectedModel] = useState<{ obj: string; mtl: string; name: string } | null>(null)

  const isDraggingTileRef = useRef(false) // Left click drag tile
  const isRotatingRef = useRef(false) // Right click rotate
  const isPanningRef = useRef(false)   // Middle click pan
  const dragStartHexRef = useRef<{ q: number; r: number } | null>(null)
  const isCopyModeRef = useRef(false) // CTRL key pressed during drag (copy instead of move)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const lastMouseHexRef = useRef<{ q: number; r: number } | null>(null)
  const mouseDownPosRef = useRef<{ x: number; y: number; coords: { q: number; r: number } | null } | null>(null) // Track mouse down position to detect drag
  const cameraDistanceRef = useRef(150)
  const cameraAngleXRef = useRef(Math.PI / 4)
  const cameraAngleYRef = useRef(Math.PI / 4)
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0))

  const [assetCategories, setAssetCategories] = useState<AssetCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [newMapDialogOpen, setNewMapDialogOpen] = useState(false)
  const [unsavedDataDialogOpen, setUnsavedDataDialogOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'new' | 'load' | null>(null)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [generateMapSize, setGenerateMapSize] = useState<MapSize>('tiny')
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generateBiome, setGenerateBiome] = useState<'plains' | 'water' | 'forest' | 'mountain'>('plains')
  const [isGenerating, setIsGenerating] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Generation progress tracking
  const [generationProgress, setGenerationProgress] = useState<{
    stage: string
    progress: number
    thoughts: string
    timeElapsed: number
  } | null>(null)

  // Map state tracking
  const [mapName, setMapName] = useState<string>('')
  const [mapPath, setMapPath] = useState<string>('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Локальные модели для генерации
  const [useLocalModel, setUseLocalModel] = useState(false)
  const [localModelUrl, setLocalModelUrl] = useState('http://localhost:1234')
  const [localModels, setLocalModels] = useState<Array<{ id: string; object: string; owned_by: string }>>([])
  const [selectedLocalModel, setSelectedLocalModel] = useState<string>('')
  const [loadingLocalModels, setLoadingLocalModels] = useState(false)

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        // In production, use tile registry instead of API
        const tileRegistry = await import('@/lib/llm/tile-registry.json')

        console.log('Loaded tile registry:', tileRegistry.tiles.length, 'tiles')

        // Group tiles by category and subcategory
        const categories: any = {}

        tileRegistry.tiles.forEach((tile: any) => {
          if (!categories[tile.category]) {
            categories[tile.category] = {
              name: tile.category,
              folders: {}
            }
          }

          const subcategory = tile.subcategory || 'default'
          if (!categories[tile.category].folders[subcategory]) {
            categories[tile.category].folders[subcategory] = {
              name: subcategory,
              models: []
            }
          }

          categories[tile.category].folders[subcategory].models.push({
            name: tile.name,
            obj: tile.obj_path,
            mtl: tile.mtl_path,
            texture: tile.texture_path
          })
        })

        // Convert to array format
        const categoryArray = Object.values(categories).map((cat: any) => ({
          ...cat,
          folders: Object.values(cat.folders)
        }))

        console.log('Processed categories:', categoryArray.length, categoryArray.map(c => c.name))
        console.log('Categories structure:', categoryArray.map(c => ({
          name: c.name,
          folders: c.folders.map((f: any) => ({ name: f.name, modelCount: f.models.length }))
        })))

        setAssetCategories(categoryArray)
        if (categoryArray.length > 0) {
          const tiles = categoryArray.find((c: any) => c.name === 'tiles')
          if (tiles) {
            console.log('Setting tiles category, folders:', tiles.folders.map((f: any) => f.name))
            setSelectedCategory('tiles')
            if (tiles.folders.length > 0) {
              setSelectedFolder(tiles.folders[0].name)
              console.log('Selected folder:', tiles.folders[0].name, 'with', tiles.folders[0].models.length, 'models')
            }
          } else {
            console.log('No tiles category found, using first category:', categoryArray[0].name)
            setSelectedCategory(categoryArray[0].name)
            if (categoryArray[0].folders.length > 0) {
              setSelectedFolder(categoryArray[0].folders[0].name)
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch assets:', error)
      }
    }
    fetchAssets()
  }, [])

  useEffect(() => {
    if (selectedCategory === 'tiles') {
      setEditMode('terrain')
    } else {
      setEditMode('building')
    }
  }, [selectedCategory])

  const currentCategory = assetCategories.find(c => c.name === selectedCategory)
  const currentFolder = currentCategory?.folders.find(f => f.name === selectedFolder)
  const availableModels = currentFolder?.models || []

  // Debug logging for asset state
  useEffect(() => {
    console.log('Asset state debug:', {
      assetCategoriesLength: assetCategories.length,
      selectedCategory,
      selectedFolder,
      currentCategory: currentCategory ? { name: currentCategory.name, foldersCount: currentCategory.folders.length } : null,
      currentFolder: currentFolder ? { name: currentFolder.name, modelsCount: currentFolder.models.length } : null,
      availableModelsLength: availableModels.length
    })
  }, [assetCategories, selectedCategory, selectedFolder, currentCategory, currentFolder, availableModels])

  // Convert axial coordinates (q, r) to world coordinates for Three.js
  const hexToWorld = (q: number, r: number, mWidth?: number, mHeight?: number): [number, number] => {
    const width = mWidth ?? mapRef.current?.width ?? 10
    const height = mHeight ?? mapRef.current?.height ?? 5
    const hexSize = 3.5
    return axialToWorld(q, r, width, height, hexSize)
  }

  const createHexagonalGrid = (width: number, height: number, level: number): THREE.Group => {
    const getHexPoints = (cx: number, cy: number, radius: number, rotation: number): THREE.Vector3[] => {
      const points: THREE.Vector3[] = []
      for (let i = 0; i < 6; i++) {
        const angle = (i * 60 + rotation) * (Math.PI / 180)
        const x = cx + radius * Math.cos(angle)
        const y = cy + radius * Math.sin(angle)
        points.push(new THREE.Vector3(x, 0, y))
      }
      return points
    }

    const group = new THREE.Group()
    group.name = `__hexGrid_level_${level}`
    const R = 2 / Math.sqrt(3)
    const scale = 3.5
    const LEVEL_HEIGHT = tileHeightRef.current || 0.7
    const gridY = level * LEVEL_HEIGHT + 0.001

    // Create grid using offset coordinates for rectangular initialization, then convert to axial
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Convert offset to axial for grid creation
        const { q, r } = offsetToAxial(x, y)
        if (mapRef.current && mapRef.current.isValidCoordinate(q, r)) {
          const [worldX, worldZ] = hexToWorld(q, r, width, height)
          const points = getHexPoints(worldX, worldZ, R * scale, 0)
          const linePoints: THREE.Vector3[] = []
          for (let i = 0; i < 6; i++) {
            linePoints.push(points[i], points[(i + 1) % 6])
          }
          const geometry = new THREE.BufferGeometry().setFromPoints(linePoints)
          const material = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.3 })
          const segments = new THREE.LineSegments(geometry, material)
          segments.position.y = gridY
          segments.name = `grid_${q}_${r}_level_${level}`
          segments.renderOrder = -1
          group.add(segments)
        }
      }
    }
    return group
  }

  // Convert world coordinates to axial coordinates
  const _worldToHex = (worldX: number, worldZ: number): { q: number; r: number } | null => {
    const width = mapRef.current?.width ?? 10
    const height = mapRef.current?.height ?? 5
    const hexSize = 3.5
    const axial = worldToAxial(worldX, worldZ, width, height, hexSize)
    // Validate coordinates
    if (!mapRef.current || !mapRef.current.isValidCoordinate(axial.q, axial.r)) {
      return null
    }
    return axial
  }

  const setupLighting = (scene: THREE.Scene) => {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(50, 100, 50)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    scene.add(directionalLight)
  }


  const createHexMesh = async (hex: Hex): Promise<THREE.Group | null> => {
    const [worldX, worldZ] = hexToWorld(hex.q, hex.r, mapRef.current?.width, mapRef.current?.height)
    try {
      const model = hex.modelData || selectedModel || availableModels[0]
      if (model) {
        // If hex didn't have modelData, save it now to ensure persistence
        if (!hex.modelData) hex.modelData = model

        const key = `terrain_${hex.terrain}_${model.name}_${hex.q}_${hex.r}`

        // Try to get from cache synchronously first
        let loadedModel = modelLoader.getCachedModel(key)

        // If not in cache, wait for it
        if (!loadedModel) {
          loadedModel = await modelLoader.loadModel(key, getAssetPath(model.obj), getAssetPath(model.mtl))
        }

        if (loadedModel) {
          const clone = loadedModel.clone()

          // Important: we scale the group BEFORE measuring so we get the actual scaled height
          clone.rotation.y = Math.PI / 2 + (hex.rotation || 0)
          clone.scale.set(3.5, 3.5, 3.5)

          // Measure tile height AFTER scaling to get actual scaled height
          const realBox = new THREE.Box3().setFromObject(clone)
          const actualHeight = realBox.max.y - realBox.min.y

          // Calibrate LEVEL_HEIGHT constant from first model if not set
          // LEVEL_HEIGHT is CONSTANT (height of base tile after scaling)
          if (tileHeightRef.current === 1.0 && actualHeight > 0) {
            tileHeightRef.current = actualHeight
          }

          // LEVEL_HEIGHT is CONSTANT (height of base tile)
          const LEVEL_HEIGHT = tileHeightRef.current

          // Position: each level stands on top of the previous level
          // Level 0: Y = 0 - minY (bottom of tile at ground level)
          // Level 1: Y = LEVEL_HEIGHT - minY (bottom of tile at top of level 0)
          // Level 2: Y = 2 * LEVEL_HEIGHT - minY (bottom of tile at top of level 1)
          const minY = realBox.min.y
          const levelBaseY = (hex.height || 0) * LEVEL_HEIGHT
          clone.position.set(worldX, levelBaseY - minY, worldZ)

          clone.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true
              child.receiveShadow = true
            }
          })

          // Update individual grid height
          const gridGroup = sceneRef.current?.getObjectByName(`__hexGrid_level_${hex.height || 0}`)
          const grid = gridGroup?.getObjectByName(`grid_${hex.q}_${hex.r}_level_${hex.height || 0}`)
          if (grid) {
            const LEVEL_HEIGHT = tileHeightRef.current
            grid.position.y = (hex.height || 0) * LEVEL_HEIGHT + 0.001
            grid.visible = true // Grid is always visible under tiles
          }

          return clone
        }
      }
    } catch (error) {
      console.warn(`Failed to load model for hex ${hex.q},${hex.r}:`, error)
    }
    return null
  }

  const handleInitializeMap = async () => {
    if (!sceneRef.current) return

    // Fill only if a tile is selected
    if (!selectedModel) {
      console.warn('Please select a tile in the preview first.')
      return
    }

    setLoadingText('Заполнение карты...')
    const mapDimensions = MAP_SIZES[mapSize]
    const map = new GameMap(mapDimensions.width, mapDimensions.height)

    // Determine terrain type based on current selection
    let terrain: TerrainType = TERRAIN_TYPES.PLAINS
    if (selectedFolder === 'roads') terrain = TERRAIN_TYPES.ROAD
    else if (selectedFolder === 'coast') terrain = TERRAIN_TYPES.WATER
    else if (selectedFolder === 'forest') terrain = TERRAIN_TYPES.FOREST
    else if (selectedFolder === 'mountains') terrain = TERRAIN_TYPES.MOUNTAIN

    // Initialize using offset coordinates, then convert to axial
    for (let y = 0; y < mapDimensions.height; y++) {
      for (let x = 0; x < mapDimensions.width; x++) {
        // Convert offset to axial for initialization
        const { q, r } = offsetToAxial(x, y)
        const h = new Hex(q, r, terrain)
        h.modelData = selectedModel
        map.setHex(q, r, h)
      }
    }

    mapRef.current = map
    await buildMap()
    setSelectedHexes([])
    // Инициализируем историю после создания карты
    saveHistoryState()
  }

  const handleInitializeMapWithModel = async (newMapSize: MapSize, model: { obj: string; mtl: string; name: string }) => {
    if (!sceneRef.current) return

    setLoadingText('Filling map with base tiles...')
    setIsLoading(true)

    const mapDimensions = MAP_SIZES[newMapSize]
    const map = new GameMap(mapDimensions.width, mapDimensions.height)

    // Determine terrain type based on current selection
    let terrain: TerrainType = TERRAIN_TYPES.PLAINS
    if (selectedFolder === 'roads') terrain = TERRAIN_TYPES.ROAD
    else if (selectedFolder === 'coast') terrain = TERRAIN_TYPES.WATER
    else if (selectedFolder === 'forest') terrain = TERRAIN_TYPES.FOREST
    else if (selectedFolder === 'mountains') terrain = TERRAIN_TYPES.MOUNTAIN

    // Initialize using offset coordinates, then convert to axial
    // Fill the bottom level (height = 0) with the selected tile
    for (let y = 0; y < mapDimensions.height; y++) {
      for (let x = 0; x < mapDimensions.width; x++) {
        // Convert offset to axial for initialization
        const { q, r } = offsetToAxial(x, y)
        const h = new Hex(q, r, terrain)
        h.height = 0 // Fill the bottom level (lowest level)
        h.modelData = model
        map.setHex(q, r, h)
      }
    }

    mapRef.current = map
    await buildMap()
    setSelectedHexes([])
    setIsLoading(false)

    // Инициализируем историю после создания карты
    saveHistoryState()
    // Сбрасываем флаг изменений для новой заполненной карты
    setHasUnsavedChanges(false)

    showNotification('success', `New ${MAP_SIZES[newMapSize].label} map created and filled with ${model.name}`)
  }

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 6000)
  }

  const handleSaveMap = () => {
    if (!mapRef.current) {
      showNotification('error', 'No map to save')
      return
    }

    // Если карта уже была сохранена и есть имя, сохраняем напрямую
    if (mapName && mapPath) {
      handleQuickSave()
    } else {
      // Иначе открываем диалог сохранения
      setSaveDialogOpen(true)
    }
  }

  const handleQuickSave = () => {
    if (!mapRef.current || !mapName) return

    try {
      setLoadingText('Saving map...')
      setIsLoading(true)

      // Collect building data
      const buildingData = new Map<string, { obj: string; mtl: string; name: string }>()
      buildingObjectsRef.current.forEach((building, key) => {
        const modelData = (building as any).userData?.modelData
        if (modelData) {
          buildingData.set(key, modelData)
        }
      })

      const jsonString = MapSerializer.serialize(mapRef.current, mapSize, {
        name: mapName,
        description: '', // Используем пустое описание для быстрого сохранения
        includeBuildings: buildingData.size > 0,
        buildingData: buildingData.size > 0 ? buildingData : undefined,
      })

      // Validate before saving
      const validation = MapSerializer.validate(JSON.parse(jsonString))
      if (!validation.valid) {
        throw new Error(`Validation error: ${validation.errors.join(', ')}`)
      }

      // Create download link
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = mapPath || `${mapName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setIsLoading(false)
      setHasUnsavedChanges(false)
      showNotification('success', `Map "${mapName}" saved successfully`)
    } catch (error) {
      console.error('Failed to save map:', error)
      setIsLoading(false)
      showNotification('error', `Save error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleSaveMapConfirm = (saveData: SaveMapData) => {
    if (!mapRef.current) return

    try {
      setSaveDialogOpen(false)
      setLoadingText('Saving map...')
      setIsLoading(true)

      // Collect building data
      const buildingData = new Map<string, { obj: string; mtl: string; name: string }>()
      buildingObjectsRef.current.forEach((building, key) => {
        const modelData = (building as any).userData?.modelData
        if (modelData) {
          buildingData.set(key, modelData)
        }
      })

      const jsonString = MapSerializer.serialize(mapRef.current, mapSize, {
        name: saveData.name,
        description: saveData.description,
        includeBuildings: buildingData.size > 0,
        buildingData: buildingData.size > 0 ? buildingData : undefined,
      })

      // Validate before saving
      const validation = MapSerializer.validate(JSON.parse(jsonString))
      if (!validation.valid) {
        throw new Error(`Validation error: ${validation.errors.join(', ')}`)
      }

      // Create download link
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = saveData.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setIsLoading(false)

      // Сохраняем информацию о карте
      setMapName(saveData.name)
      setMapPath(saveData.filename)
      setHasUnsavedChanges(false)

      showNotification('success', `Map "${saveData.name}" saved successfully`)
      console.log('Map saved successfully:', saveData)
    } catch (error) {
      console.error('Failed to save map:', error)
      setIsLoading(false)
      showNotification('error', `Save error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleNewMap = () => {
    // Проверяем несохраненные изменения перед открытием диалога
    if (hasUnsavedChanges) {
      setPendingAction('new')
      setUnsavedDataDialogOpen(true)
    } else {
      // Если нет несохраненных изменений, открываем диалог напрямую
      setNewMapDialogOpen(true)
    }
  }

  const handleNewMapConfirm = (newMapSize: MapSize, fillMap: boolean, selectedTile?: { tile_id: string; name: string; obj_path: string; mtl_path: string }) => {
    // Clear the current map
    if (mapRef.current) {
      mapRef.current.hexes.clear()
    }

    // Clear buildings
    buildingObjectsRef.current.clear()

    // Clear selection
    setSelectedHexes([])

    // Reset history
    historyRef.current = []
    historyIndexRef.current = -1

    // Reset map info
    setMapName('')
    setMapPath('')
    setHasUnsavedChanges(false)

    // Update map size if different
    if (newMapSize !== mapSize) {
      setMapSize(newMapSize)
    }

    // Fill map with base tiles if requested
    if (fillMap) {
      if (selectedTile) {
        // Используем тайл из диалога
        const model = {
          obj: getAssetPath(selectedTile.obj_path),
          mtl: getAssetPath(selectedTile.mtl_path),
          name: selectedTile.name
        }
        handleInitializeMapWithModel(newMapSize, model)
      } else if (selectedModel) {
        // Fallback на выбранный тайл из левой панели
        handleInitializeMapWithModel(newMapSize, selectedModel)
      } else {
        showNotification('error', 'Please select a tile to use as template for filling')
        // Re-render the scene
        if (sceneRef.current && rendererRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current)
        }
        showNotification('success', `New ${MAP_SIZES[newMapSize].label} map created`)
      }
    } else {
      // Re-render the scene
      if (sceneRef.current && rendererRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current)
      }
      showNotification('success', `New ${MAP_SIZES[newMapSize].label} map created`)
    }
  }

  const handleGenerateMap = async () => {
    setGenerateDialogOpen(true)
  }

  // Загрузка локальных моделей
  const loadLocalModels = async () => {
    setLoadingLocalModels(true)
    try {
      const url = `${localModelUrl}/v1/models`
      const response = await fetch(url)
      const text = await response.text()
      let data: any

      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text }
      }

      if (!response.ok) {
        showNotification('error', data.error || data.message || `Failed to load models: HTTP ${response.status}`)
        return
      }

      const models = data.data || data.models || []
      setLocalModels(models)

      if (models.length > 0 && !selectedLocalModel) {
        setSelectedLocalModel(models[0].id)
      }
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingLocalModels(false)
    }
  }

  const confirmGenerateMap = async () => {
    try {
      if (!generatePrompt.trim()) {
        showNotification('error', 'Please enter a generation prompt')
        return
      }

      setIsGenerating(true)
      setLoadingText('Generating map via LLM...')
      setIsLoading(true)
      setGenerationProgress({
        stage: 'Initializing...',
        progress: 0,
        thoughts: '',
        timeElapsed: 0
      })

      const mapDimensions = MAP_SIZES[generateMapSize]

      // Call API to generate map (returns serialized map format)
      const requestBody: any = {
        width: mapDimensions.width,
        height: mapDimensions.height,
        prompt: generatePrompt.trim(),
        biome: generateBiome,
        returnFormat: 'serialized',
        stream: useLocalModel, // Enable streaming for local models
      }

      // Добавляем параметры локальной модели, если используется
      if (useLocalModel) {
        requestBody.useLocalModel = true
        requestBody.localUrl = localModelUrl
        requestBody.model = selectedLocalModel || localModels[0]?.id
      }

      // Increase timeout for local models (may take longer to generate)
      const timeout = useLocalModel ? 600000 : 30000 // 10 minutes for local, 30 sec for Gemini
      const controller = new AbortController()

      // Start progress tracking
      const startTime = Date.now()
      const progressInterval = setInterval(() => {
        if (generationProgress) {
          setGenerationProgress(prev => prev ? {
            ...prev,
            timeElapsed: Math.floor((Date.now() - startTime) / 1000)
          } : null)
        }
      }, 1000)
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch('/api/llm/generate-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeoutId)
        clearInterval(progressInterval)
      })

      if (!response.ok) {
        let errorData: any
        try {
          errorData = await response.json()
        } catch {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
        }
        throw new Error(errorData.error || 'Map generation error')
      }

      // Check if response is streaming (for debug data)
      const contentType = response.headers.get('content-type')
      let data: any

      if (contentType?.includes('text/plain') || contentType?.includes('text/event-stream')) {
        // Handle streaming response with debug data
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let finalData: any = null

        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || '' // Keep incomplete line in buffer

              for (const line of lines) {
                if (line.trim()) {
                  // Parse debug data
                  if (line.includes('Prompt processing progress')) {
                    const match = line.match(/(\d+)%/)
                    if (match) {
                      setGenerationProgress(prev => prev ? {
                        ...prev,
                        stage: 'Processing prompt...',
                        progress: parseInt(match[1])
                      } : null)
                    }
                  } else if (line.includes('Thought for')) {
                    const match = line.match(/Thought for (\d+) seconds/)
                    if (match) {
                      setGenerationProgress(prev => prev ? {
                        ...prev,
                        stage: 'Thinking...',
                        progress: Math.min(prev.progress + 10, 90)
                      } : null)
                    }
                  } else if (line.startsWith('{') && line.includes('success')) {
                    // Final JSON response
                    try {
                      finalData = JSON.parse(line)
                    } catch (e) {
                      console.warn('Failed to parse final JSON:', e)
                    }
                  } else {
                    // Thoughts/reasoning
                    setGenerationProgress(prev => prev ? {
                      ...prev,
                      thoughts: line.trim()
                    } : null)
                  }
                }
              }
            }
          } finally {
            reader.releaseLock()
          }
        }

        if (!finalData) {
          throw new Error('No final response received from streaming API')
        }
        data = finalData
      } else {
        // Handle regular JSON response
        try {
          data = await response.json()
        } catch (e) {
          const text = await response.text()
          throw new Error(`Failed to parse response: ${e instanceof Error ? e.message : String(e)}\nResponse: ${text.substring(0, 500)}`)
        }
      }

      if (!data.success || !data.mapData) {
        throw new Error('Invalid API response format')
      }

      // Close dialog and clear progress
      setGenerateDialogOpen(false)
      setGenerationProgress(null)

      setLoadingText('Loading map...')

      // Update map size if different
      if (data.mapSize && data.mapSize !== mapSize) {
        setMapSize(data.mapSize as MapSize)
      }

      // Deserialize map using MapSerializer (same as loading from file)
      const jsonString = JSON.stringify(data.mapData)
      const validation = MapSerializer.validate(data.mapData)
      if (!validation.valid) {
        throw new Error(`Validation error: ${validation.errors.join(', ')}`)
      }

      const { map, mapSize: loadedMapSize, buildings } = MapSerializer.deserialize(jsonString)

      // Update map size if different
      if (loadedMapSize !== mapSize) {
        setMapSize(loadedMapSize)
      }

      // Clear existing map
      hexMeshesRef.current.forEach((mesh) => {
        sceneRef.current?.remove(mesh)
      })
      hexMeshesRef.current.clear()

      buildingObjectsRef.current.forEach((building) => {
        sceneRef.current?.remove(building)
      })
      buildingObjectsRef.current.clear()

      // Set new map
      mapRef.current = map

      // Load buildings if present (buildings are not generated by LLM yet, but structure is ready)
      // Note: LLM generation currently only generates terrain tiles, not buildings

      // Rebuild map visualization
      setLoadingText('Building map...')
      await buildMap()

      setSelectedHexes([])
      setIsLoading(false)
      setIsGenerating(false)
      // Initialize history after generating map
      saveHistoryState()
      showNotification('success', `Map ${mapDimensions.width}x${mapDimensions.height} generated successfully`)
      console.log('Map generated successfully')
    } catch (error) {
      console.error('Failed to generate map:', error)
      setIsLoading(false)
      setIsGenerating(false)
      setGenerationProgress(null) // Clear progress on error

      let errorMessage = error instanceof Error ? error.message : String(error)

      // Специальная обработка для timeout
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('fetch failed'))) {
        if (useLocalModel) {
          errorMessage = 'Generation interrupted due to timeout. Local models may take a long time to generate (5-10 minutes). Try reducing map size or wait longer.'
        } else {
          errorMessage = 'Generation interrupted due to timeout. Please try again.'
        }
      }

      showNotification('error', `Generation error: ${errorMessage}`)
    }
  }

  const handleLoadMap = () => {
    // Проверяем несохраненные изменения перед открытием диалога
    if (hasUnsavedChanges) {
      setPendingAction('load')
      setUnsavedDataDialogOpen(true)
    } else {
      // Если нет несохраненных изменений, открываем диалог загрузки напрямую
      openLoadDialog()
    }
  }

  const openLoadDialog = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        setLoadingText('Loading map...')
        setIsLoading(true)

        const text = await file.text()

        // Validate file before deserializing
        let parsedData: unknown
        try {
          parsedData = JSON.parse(text)
        } catch (parseError) {
          throw new Error('File is not valid JSON')
        }

        const validation = MapSerializer.validate(parsedData)
        if (!validation.valid) {
          throw new Error(`Invalid file format: ${validation.errors.join(', ')}`)
        }

        const { map, mapSize: loadedMapSize, buildings, metadata } = MapSerializer.deserialize(text)

        // Update map size if different
        if (loadedMapSize !== mapSize) {
          setMapSize(loadedMapSize)
        }

        // Clear existing map
        hexMeshesRef.current.forEach((mesh) => {
          sceneRef.current?.remove(mesh)
        })
        hexMeshesRef.current.clear()

        buildingObjectsRef.current.forEach((building) => {
          sceneRef.current?.remove(building)
        })
        buildingObjectsRef.current.clear()

        // Set new map
        mapRef.current = map

        // Rebuild map visualization
        await buildMap()

        // Load buildings if present
        if (buildings && buildings.length > 0) {
          setLoadingText(`Loading buildings (${buildings.length})...`)
          for (const building of buildings) {
            await placeBuilding(building.q, building.r, building.modelData)
          }
        }

        setSelectedHexes([])
        setIsLoading(false)

        // Устанавливаем информацию о карте
        const loadedMapName = metadata?.name || file.name.replace('.json', '')
        setMapName(loadedMapName)
        setMapPath(file.name)
        setHasUnsavedChanges(false)

        // Инициализируем историю после загрузки карты
        saveHistoryState()
        showNotification('success', `Map "${loadedMapName}" loaded successfully`)
        console.log('Map loaded successfully')
      } catch (error) {
        console.error('Failed to load map:', error)
        setIsLoading(false)
        showNotification('error', `Load error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    input.click()
  }

  const handleUnsavedDataSave = () => {
    // Открываем диалог сохранения
    handleSaveMap()
  }

  const handleUnsavedDataDiscard = () => {
    // Выполняем отложенное действие
    if (pendingAction === 'new') {
      setNewMapDialogOpen(true)
    } else if (pendingAction === 'load') {
      openLoadDialog()
    }
    setPendingAction(null)
  }

  const buildMap = async () => {
    if (!sceneRef.current || !mapRef.current) return

    // Не показываем индикатор загрузки во время undo/redo, чтобы не блокировать UI
    if (!isUndoRedoInProgressRef.current) {
      setLoadingText('Building map...')
    }

    // Clear hexes
    hexMeshesRef.current.forEach((mesh) => {
      sceneRef.current?.remove(mesh)
    })
    hexMeshesRef.current.clear()

    // Clear buildings
    buildingObjectsRef.current.forEach((obj) => {
      sceneRef.current?.remove(obj)
    })
    buildingObjectsRef.current.clear()

    // Build meshes for all hexes in all stacks
    const promises: Promise<void>[] = []
    let hexCount = 0

    mapRef.current.hexes.forEach((hexStack, key) => {
      if (hexStack && hexStack.length > 0) {
        hexStack.forEach(hex => {
          hexCount++
          const promise = (async () => {
            const mesh = await createHexMesh(hex)
            if (mesh && sceneRef.current) {
              sceneRef.current.add(mesh)
              hexMeshesRef.current.set(`${hex.q},${hex.r}_${hex.height}`, mesh as any)
            }
          })()
          promises.push(promise)
        })
      }
    })

    await Promise.all(promises)
    console.log('buildMap completed - hexes created:', hexCount, 'meshes in ref:', hexMeshesRef.current.size)
  }

  const updateHexMesh = async (q: number, r: number, height?: number) => {
    if (!mapRef.current || !sceneRef.current) return

    // If height specified, update only that hex. Otherwise update all hexes at position
    const hexStack = mapRef.current.getHexStack(q, r)
    const hexesToUpdate = height !== undefined
      ? hexStack.filter(h => h.height === height)
      : hexStack

    for (const hex of hexesToUpdate) {
      const hexKey = `${q},${r}_${hex.height}`
      const oldMesh = hexMeshesRef.current.get(hexKey)

      // Remove old mesh
      if (oldMesh) {
        sceneRef.current.remove(oldMesh)
        hexMeshesRef.current.delete(hexKey)
      }

      // Create new mesh
      const model = hex.modelData || selectedModel || availableModels[0]

      if (model) {
        if (!hex.modelData) hex.modelData = model
        const key = `terrain_${hex.terrain}_${model.name}_${hex.q}_${hex.r}_${hex.height}`
        const cached = modelLoader.getCachedModel(key)

        if (cached) {
          const [wX, wZ] = hexToWorld(q, r)
          const clone = cached.clone()
          clone.rotation.y = Math.PI / 2 + (hex.rotation || 0)
          clone.scale.set(3.5, 3.5, 3.5)

          // Calculate position using CONSTANT level height
          const box = new THREE.Box3().setFromObject(clone)
          const minY = box.min.y // Bottom of the model

          // Level height is CONSTANT (height of base tile)
          const LEVEL_HEIGHT = tileHeightRef.current || 0.7

          // Position: level * LEVEL_HEIGHT, adjusted so bottom aligns with level top
          const levelTop = hex.height * LEVEL_HEIGHT
          clone.position.set(wX, levelTop - minY, wZ)

          sceneRef.current.add(clone)
          hexMeshesRef.current.set(hexKey, clone as any)

          // Force selection highlight update if this is the selected hex
          if (selectedHexes.some(h => h.q === q && h.r === r)) {
            setSelectedHexes([...selectedHexes])
          }
        } else {
          // Load asynchronously if not cached
          const mesh = await createHexMesh(hex)
          if (mesh && sceneRef.current) {
            sceneRef.current.add(mesh)
            hexMeshesRef.current.set(hexKey, mesh as any)
          }
        }
      }
    }
  }

  const saveHistoryState = () => {
    if (!mapRef.current) return
    // Не сохраняем историю во время undo/redo операций
    if (isUndoRedoInProgressRef.current) {
      console.log('Skipping saveHistoryState during undo/redo')
      return
    }
    try {
      const mapJson = MapSerializer.serialize(mapRef.current, mapSize, {})
      const state: HistoryState = {
        map: mapJson,
        timestamp: Date.now(),
      }

      // Если история пустая или индекс -1, создаем новый массив
      if (historyRef.current.length === 0 || historyIndexRef.current === -1) {
        historyRef.current = [state]
        historyIndexRef.current = 0
        console.log('History initialized, length:', historyRef.current.length, 'index:', historyIndexRef.current)
        return
      }

      // Удаляем все состояния после текущего индекса (если делаем undo, а потом новое действие)
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)

      // Добавляем новое состояние
      historyRef.current.push(state)

      // Ограничиваем размер истории
      if (historyRef.current.length > maxHistorySize) {
        const removedCount = historyRef.current.length - maxHistorySize
        historyRef.current = historyRef.current.slice(removedCount)
      }

      // Всегда устанавливаем индекс на последний элемент после добавления
      historyIndexRef.current = historyRef.current.length - 1

      console.log('History saved, length:', historyRef.current.length, 'index:', historyIndexRef.current)
    } catch (error) {
      console.warn('Failed to save history state:', error)
    }
  }

  const undo = async (): Promise<boolean> => {
    if (!mapRef.current || !sceneRef.current) return false

    console.log('Undo attempt - Index:', historyIndexRef.current, 'History length:', historyRef.current.length)

    // Проверяем, что есть состояние для undo (индекс должен быть больше 0)
    // Если индекс равен 0, значит мы уже на первом состоянии и undo невозможен
    if (historyIndexRef.current <= 0) {
      console.log('Undo failed: Already at first state')
      return false
    }

    // Уменьшаем индекс и загружаем предыдущее состояние
    historyIndexRef.current--
    const state = historyRef.current[historyIndexRef.current]

    if (!state) {
      console.error('Undo state not found at index:', historyIndexRef.current, 'history length:', historyRef.current.length)
      return false
    }

    console.log('Undo: Loading state at index', historyIndexRef.current)

    try {
      const { map } = MapSerializer.deserialize(state.map)
      mapRef.current = map
      console.log('Undo: Map deserialized, hex count:', map.hexes.size)
      await buildMap()
      setSelectedHexes([])

      console.log('Undo completed - Index after undo:', historyIndexRef.current, 'History length:', historyRef.current.length, 'meshes in scene:', hexMeshesRef.current.size)
      showNotification('success', 'Undone')
      return true
    } catch (error) {
      console.error('Failed to undo:', error)
      showNotification('error', 'Undo error')
      return false
    }
  }

  const redo = async (): Promise<boolean> => {
    if (!mapRef.current || !sceneRef.current) return false

    console.log('Redo attempt - Index:', historyIndexRef.current, 'History length:', historyRef.current.length)

    // Проверяем, что есть состояние для redo (текущий индекс должен быть меньше последнего)
    // Если индекс равен length - 1, значит мы уже на последнем состоянии и redo невозможен
    if (historyIndexRef.current >= historyRef.current.length - 1) {
      console.log('Redo failed: Already at last state')
      return false
    }

    // Устанавливаем флаг, чтобы предотвратить сохранение истории во время redo
    isUndoRedoInProgressRef.current = true

    try {
      // Увеличиваем индекс и загружаем следующее состояние
      historyIndexRef.current++
      const state = historyRef.current[historyIndexRef.current]

      if (!state) {
        console.error('Redo state not found at index:', historyIndexRef.current, 'history length:', historyRef.current.length)
        isUndoRedoInProgressRef.current = false
        return false
      }

      console.log('Redo: Loading state at index', historyIndexRef.current)

      const { map } = MapSerializer.deserialize(state.map)
      mapRef.current = map
      console.log('Redo: Map deserialized, hex count:', map.hexes.size)
      await buildMap()
      setSelectedHexes([])

      console.log('Redo completed - Index after redo:', historyIndexRef.current, 'History length:', historyRef.current.length, 'meshes in scene:', hexMeshesRef.current.size)
      showNotification('success', 'Redone')
      return true
    } catch (error) {
      console.error('Failed to redo:', error)
      showNotification('error', 'Redo error')
      return false
    } finally {
      // Снимаем флаг после завершения redo
      isUndoRedoInProgressRef.current = false
    }
  }

  const copyHex = (): boolean => {
    if (!mapRef.current) return false

    // Определяем, какие тайлы копировать: выделенные или тайл под курсором
    let hexesToCopy: Array<{ q: number; r: number }> = []

    if (selectedHexes.length > 0) {
      // Используем выделенные тайлы
      hexesToCopy = selectedHexes
    } else {
      // Если нет выделенных, используем тайл под курсором
      const hexUnderCursor = lastMouseHexRef.current
      if (hexUnderCursor && mapRef.current.hasHex(hexUnderCursor.q, hexUnderCursor.r)) {
        hexesToCopy = [hexUnderCursor]
      } else {
        showNotification('error', 'Нет тайла для копирования. Наведите курсор на тайл или выделите его.')
        return false
      }
    }

    // Копируем тайлы
    const hexes: ClipboardData['hexes'] = []

    for (const selected of hexesToCopy) {
      const hex = mapRef.current.getHex(selected.q, selected.r)
      if (hex) {
        hexes.push({
          q: hex.q,
          r: hex.r,
          terrain: hex.terrain,
          height: hex.height,
          rotation: hex.rotation,
          modelData: hex.modelData,
          hasRiver: hex.hasRiver,
        })
      }
    }

    if (hexes.length === 0) {
      showNotification('error', 'Нет тайлов для копирования')
      return false
    }

    const clipboardData: ClipboardData = {
      hexes,
      sourceHeight: hexes[0].height, // Используем высоту первого тайла
      globalLevel: currentHeightLevel,
      // Для обратной совместимости
      hex: hexes.length === 1 ? hexes[0] : undefined,
    }

    // Сохраняем в localStorage для персистентности
    try {
      localStorage.setItem('mapEditor_clipboard', JSON.stringify(clipboardData))
    } catch (error) {
      console.warn('Failed to save clipboard to localStorage:', error)
    }

    // Сохраняем в ref
    clipboardDataRef.current = clipboardData

    showNotification('success', `Скопировано тайлов: ${hexes.length}`)
    return true
  }

  const pasteHex = async (q: number, r: number): Promise<boolean> => {
    if (!mapRef.current) return false

    // Сохраняем состояние перед вставкой для undo
    saveHistoryState()

    // Получаем данные из буфера обмена
    let clipboardData: ClipboardData | null = clipboardDataRef.current

    // Если нет в ref, пытаемся загрузить из localStorage
    if (!clipboardData) {
      try {
        const stored = localStorage.getItem('mapEditor_clipboard')
        if (stored) {
          clipboardData = JSON.parse(stored)
          clipboardDataRef.current = clipboardData
        }
      } catch (error) {
        console.warn('Failed to load clipboard from localStorage:', error)
      }
    }

    if (!clipboardData) {
      showNotification('error', 'Буфер обмена пуст')
      return false
    }

    // Поддержка как нового формата (hexes), так и старого (hex) для обратной совместимости
    const hexesToPaste = clipboardData.hexes || (clipboardData.hex ? [clipboardData.hex] : [])

    if (hexesToPaste.length === 0) {
      showNotification('error', 'Буфер обмена пуст')
      return false
    }

    // Вычисляем смещение от первого скопированного тайла
    const firstHex = hexesToPaste[0]
    const offsetQ = q - firstHex.q
    const offsetR = r - firstHex.r

    let pastedCount = 0
    const pastedHexes: Array<{ q: number; r: number }> = []

    // Вставляем все тайлы с сохранением относительных позиций
    for (const hexData of hexesToPaste) {
      const targetQ = hexData.q + offsetQ
      const targetR = hexData.r + offsetR

      // Проверяем, что координаты валидны
      if (!mapRef.current.isValidCoordinate(targetQ, targetR)) {
        continue
      }

      // Вычисляем целевую высоту с учетом глобального уровня
      const heightOffset = hexData.height - clipboardData.globalLevel
      let targetHeight = currentHeightLevel + heightOffset

      // Проверяем, что целевая высота в допустимых пределах
      if (targetHeight < 0) {
        targetHeight = 0
      }
      if (targetHeight > 4) {
        continue
      }

      // Проверяем, свободен ли целевой уровень
      if (mapRef.current.hasHex(targetQ, targetR, targetHeight)) {
        // Ищем следующий свободный уровень выше текущего глобального
        let nextLevel = currentHeightLevel
        while (nextLevel <= 4 && mapRef.current.hasHex(targetQ, targetR, nextLevel)) {
          nextLevel++
        }
        if (nextLevel > 4) {
          continue
        }
        targetHeight = nextLevel
      }

      // Создаем новый Hex
      const newHex = new Hex(targetQ, targetR, hexData.terrain)
      newHex.height = targetHeight
      newHex.rotation = hexData.rotation || 0
      newHex.modelData = hexData.modelData
      newHex.hasRiver = hexData.hasRiver || false

      // Устанавливаем тайл на карту
      mapRef.current.setHex(targetQ, targetR, newHex)

      // Обновляем визуализацию
      await updateHexMesh(targetQ, targetR, targetHeight)

      pastedCount++
      pastedHexes.push({ q: targetQ, r: targetR })
    }

    if (pastedCount === 0) {
      showNotification('error', 'Не удалось вставить тайлы')
      return false
    }

    // Обновляем выделение на вставленные тайлы
    setSelectedHexes(pastedHexes)

    // Отмечаем изменения
    setHasUnsavedChanges(true)

    // Сохраняем состояние после вставки для истории
    saveHistoryState()

    showNotification('success', `Вставлено тайлов: ${pastedCount}`)
    return true
  }

  const removeHex = async (q: number, r: number) => {
    if (!sceneRef.current || !mapRef.current) return

    // Always remove topmost hex
    const hexStack = mapRef.current.getHexStack(q, r)
    const targetHex = hexStack.length > 0 ? hexStack[hexStack.length - 1] : null

    if (!targetHex) return

    const hexKey = `${q},${r}_${targetHex.height}`
    const obj = hexMeshesRef.current.get(hexKey)

    if (obj) {
      sceneRef.current.remove(obj)
      hexMeshesRef.current.delete(hexKey)
    }

    // Remove hex from map
    mapRef.current.removeHex(q, r, targetHex.height)

    // Update grid visibility - show grid for this level if no hex at this level
    if (!mapRef.current.hasHex(q, r, targetHex.height)) {
      const gridGroup = sceneRef.current.getObjectByName(`__hexGrid_level_${targetHex.height}`)
      const grid = gridGroup?.getObjectByName(`grid_${q}_${r}_level_${targetHex.height}`)
      if (grid) {
        grid.visible = true
      }
    }

    const building = buildingObjectsRef.current.get(hexKey)
    if (building) {
      sceneRef.current.remove(building)
      buildingObjectsRef.current.delete(hexKey)
    }

    // Отмечаем изменения
    setHasUnsavedChanges(true)
  }

  const copyHexAtPosition = async (fromQ: number, fromR: number, toQ: number, toR: number) => {
    if (!mapRef.current || !sceneRef.current) return false

    // Сохраняем состояние перед копированием для undo
    saveHistoryState()

    // Get topmost hex at source position
    const sourceHexStack = mapRef.current.getHexStack(fromQ, fromR)
    if (sourceHexStack.length === 0) return false

    const hexToCopy = sourceHexStack[sourceHexStack.length - 1]
    const hexHeight = hexToCopy.height

    // Check if target position is valid
    if (!mapRef.current.isValidCoordinate(toQ, toR)) return false

    // Check if target position is free at the same height, or find next free level
    let targetHeight = hexHeight
    if (mapRef.current.hasHex(toQ, toR, targetHeight)) {
      // Ищем следующий свободный уровень выше текущего
      let nextLevel = targetHeight
      while (nextLevel <= 4 && mapRef.current.hasHex(toQ, toR, nextLevel)) {
        nextLevel++
      }
      if (nextLevel > 4) {
        showNotification('error', 'Нет свободных уровней для копирования')
        return false
      }
      targetHeight = nextLevel
    }

    // Clone hex and update coordinates
    const newHex = new Hex(toQ, toR, hexToCopy.terrain)
    newHex.height = targetHeight
    newHex.rotation = hexToCopy.rotation
    newHex.modelData = hexToCopy.modelData
    newHex.hasRiver = hexToCopy.hasRiver

    // Add hex to target (don't remove from source - it's a copy)
    mapRef.current.setHex(toQ, toR, newHex)
    await updateHexMesh(toQ, toR, targetHeight)

    // Отмечаем изменения
    setHasUnsavedChanges(true)

    // Сохраняем состояние после копирования для истории
    saveHistoryState()

    // Wait for mesh to be updated in hexMeshesRef before updating selection
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSelectedHexes([{ q: toQ, r: toR }])
      })
    })

    showNotification('success', 'Тайл скопирован')
    return true
  }

  const moveHex = async (fromQ: number, fromR: number, toQ: number, toR: number) => {
    if (!mapRef.current || !sceneRef.current) return false

    // Get topmost hex at source position
    const sourceHexStack = mapRef.current.getHexStack(fromQ, fromR)
    if (sourceHexStack.length === 0) return false

    const hexToMove = sourceHexStack[sourceHexStack.length - 1]
    const hexHeight = hexToMove.height

    // Check if target position is valid and free at the same height
    if (!mapRef.current.isValidCoordinate(toQ, toR)) return false
    if (mapRef.current.hasHex(toQ, toR, hexHeight)) return false

    // Clone hex and update coordinates
    const newHex = new Hex(toQ, toR, hexToMove.terrain)
    newHex.height = hexHeight
    newHex.rotation = hexToMove.rotation
    newHex.modelData = hexToMove.modelData

    // Remove hex from source
    await removeHex(fromQ, fromR)

    // Add hex to target
    mapRef.current.setHex(toQ, toR, newHex)
    await updateHexMesh(toQ, toR, hexHeight)

    // Отмечаем изменения
    setHasUnsavedChanges(true)

    // Wait for mesh to be updated in hexMeshesRef before updating selection
    // Use requestAnimationFrame to ensure mesh is rendered before updating highlight
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSelectedHexes([{ q: toQ, r: toR }])
      })
    })

    return true
  }

  const placeBuilding = async (q: number, r: number, building: AssetModel) => {
    if (!sceneRef.current) return
    const hexKey = `${q},${r}`
    const [worldX, worldZ] = hexToWorld(q, r, mapRef.current?.width, mapRef.current?.height)
    const oldBuilding = buildingObjectsRef.current.get(hexKey)
    if (oldBuilding) sceneRef.current.remove(oldBuilding)
    try {
      const key = `building_${building.name}_${q}_${r}`
      const loadedModel = await modelLoader.loadModel(key, getAssetPath(building.obj), getAssetPath(building.mtl))
      loadedModel.position.set(worldX, 0, worldZ)
      loadedModel.rotation.y = Math.PI / 2
      loadedModel.scale.set(3.5, 3.5, 3.5)

      // Store model metadata for serialization
      ;(loadedModel as any).userData = {
        modelData: {
          obj: getAssetPath(building.obj),
          mtl: getAssetPath(building.mtl),
          name: building.name,
        },
      }

      sceneRef.current.add(loadedModel)
      buildingObjectsRef.current.set(hexKey, loadedModel)
    } catch (error) {
      console.error(`Failed to place building ${building.name}:`, error)
    }
  }

  const initialize = async () => {
    if (!canvasRef.current) return
    try {
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x1a1a1a)
      sceneRef.current = scene

      // Create a hit plane for clicking on empty spaces
      const hitPlaneGeom = new THREE.PlaneGeometry(1000, 1000)
      const hitPlaneMat = new THREE.MeshBasicMaterial({ visible: false })
      const hitPlane = new THREE.Mesh(hitPlaneGeom, hitPlaneMat)
      hitPlane.rotation.x = -Math.PI / 2
      hitPlane.name = '__hitPlane'
      scene.add(hitPlane)

      // Add hexagonal grids for all levels (initially only current level visible)
      const gridMapDimensions = MAP_SIZES[mapSize]
      for (let level = 0; level <= 4; level++) {
        const hexGrid = createHexagonalGrid(gridMapDimensions.width, gridMapDimensions.height, level)
        hexGrid.visible = (level === currentHeightLevel)
        scene.add(hexGrid)
      }

      // Initialize Selection Highlight here to ensure it exists in the scene
      const scale = 3.5
      const R = 2 / Math.sqrt(3)
      const outerR = R * scale * 1.05
      const innerR = R * scale * 0.95

      const selectionShape = new THREE.Shape()
      for (let i = 0; i < 6; i++) {
        const angle = (i * 60) * (Math.PI / 180)
        const x = outerR * Math.cos(angle)
        const y = outerR * Math.sin(angle)
        if (i === 0) selectionShape.moveTo(x, y)
        else selectionShape.lineTo(x, y)
      }
      selectionShape.closePath()

      const selectionHole = new THREE.Path()
      for (let i = 0; i < 6; i++) {
        const angle = (i * 60) * (Math.PI / 180)
        const x = innerR * Math.cos(angle)
        const y = innerR * Math.sin(angle)
        if (i === 0) selectionHole.moveTo(x, y)
        else selectionHole.lineTo(x, y)
      }
      selectionHole.closePath()
      selectionShape.holes.push(selectionHole)

      const selectionGeom = new THREE.ShapeGeometry(selectionShape)
      selectionGeom.rotateX(-Math.PI / 2)
      selectionGeom.rotateY(Math.PI / 2)

      const selectionMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff, // Bright Cyan (Primary)
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      })
      const sMesh = new THREE.Mesh(selectionGeom, selectionMat)
      sMesh.name = '__selectionHighlight'
      sMesh.renderOrder = 2000
      sMesh.visible = false
      scene.add(sMesh)
      selectionMeshRef.current = sMesh

      const container = containerRef.current
      if (!container) return
      const width = container.clientWidth
      const height = container.clientHeight

      const aspect = width / height
      const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000)
      cameraRef.current = camera
      const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.shadowMap.enabled = true
      rendererRef.current = renderer
      setupLighting(scene)
      const initMapDimensions = MAP_SIZES[mapSize]
      const map = new GameMap(initMapDimensions.width, initMapDimensions.height)
      mapRef.current = map
      await buildMap()
      animate()
      setIsLoading(false)
    } catch (error) {
      console.error('Init failed:', error)
      setLoadingText(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const animate = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return
    const camera = cameraRef.current
    const dist = cameraDistanceRef.current
    const ax = cameraAngleXRef.current
    const ay = cameraAngleYRef.current
    const target = cameraTargetRef.current
    camera.position.x = target.x + Math.cos(ay) * Math.cos(ax) * dist
    camera.position.y = target.y + Math.sin(ax) * dist
    camera.position.z = target.z + Math.sin(ay) * Math.cos(ax) * dist
    camera.lookAt(target)
    rendererRef.current.render(sceneRef.current, camera)
    animationFrameRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    initialize()
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  // Update grid visibility when currentHeightLevel changes
  useEffect(() => {
    if (!sceneRef.current) return

    // Update visibility for all grid levels
    for (let level = 0; level <= 4; level++) {
      const gridGroup = sceneRef.current.getObjectByName(`__hexGrid_level_${level}`)
      if (gridGroup) {
        gridGroup.visible = (level === currentHeightLevel)
      }
    }
  }, [currentHeightLevel])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // WASD: Move selected hex if selected, otherwise pan camera
      // Работаем только с первым выделенным hex для навигации
      if (selectedHexes.length > 0 && mapRef.current) {
        const selectedHex = selectedHexes[0]
        const neighbors = mapRef.current.getNeighborCoordinates(selectedHex.q, selectedHex.r)
        const hexStack = mapRef.current.getHexStack(selectedHex.q, selectedHex.r)
        if (hexStack.length > 0) {
          const hexHeight = hexStack[hexStack.length - 1].height
          let targetCoords: { q: number; r: number } | null = null

          // Map WASD to neighbor directions (simplified with axial coordinates - no conditional logic!)
          // Directions in axial coordinates are always the same
          // Инвертировано: W/S и A/D поменяны местами
          if (e.code === 'KeyW') {
            // South East (q: 0, r: 1) - инвертировано
            targetCoords = neighbors.find(n => n.q === selectedHex.q && n.r === selectedHex.r + 1) || neighbors.find(n => n.r > selectedHex.r) || null
          } else if (e.code === 'KeyS') {
            // North West (q: 0, r: -1) - инвертировано
            targetCoords = neighbors.find(n => n.q === selectedHex.q && n.r === selectedHex.r - 1) || neighbors.find(n => n.r < selectedHex.r) || null
          } else if (e.code === 'KeyA') {
            // East (q: 1, r: 0) - инвертировано
            targetCoords = neighbors.find(n => n.q === selectedHex.q + 1 && n.r === selectedHex.r) || neighbors.find(n => n.q > selectedHex.q) || null
          } else if (e.code === 'KeyD') {
            // West (q: -1, r: 0) - инвертировано
            targetCoords = neighbors.find(n => n.q === selectedHex.q - 1 && n.r === selectedHex.r) || neighbors.find(n => n.q < selectedHex.q) || null
          }

          if (targetCoords && !mapRef.current.hasHex(targetCoords.q, targetCoords.r, hexHeight)) {
            await moveHex(selectedHex.q, selectedHex.r, targetCoords.q, targetCoords.r)
          }
        }
      } else {
        // No selection: pan camera with WASD
        const moveSpeed = 5
        const yaw = cameraAngleYRef.current
        const forward = new THREE.Vector3(-Math.cos(yaw), 0, -Math.sin(yaw))
        const right = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw))

        if (e.code === 'KeyW') cameraTargetRef.current.add(forward.multiplyScalar(moveSpeed))
        if (e.code === 'KeyS') cameraTargetRef.current.add(forward.multiplyScalar(-moveSpeed))
        // Инвертировано: A влево, D вправо
        if (e.code === 'KeyA') cameraTargetRef.current.add(right.multiplyScalar(moveSpeed))
        if (e.code === 'KeyD') cameraTargetRef.current.add(right.multiplyScalar(-moveSpeed))
      }

      // Q/E Rotating, R/F Height change for selected hex (работаем только с первым выделенным)
      if (selectedHexes.length > 0 && mapRef.current) {
        const selectedHex = selectedHexes[0]
        // Always work with topmost hex
        const hexStack = mapRef.current.getHexStack(selectedHex.q, selectedHex.r)
        const hex = hexStack.length > 0 ? hexStack[hexStack.length - 1] : null

        if (hex) {
          const oldHeight = hex.height

          if (e.code === 'KeyQ') {
            hex.rotation = (hex.rotation || 0) + Math.PI / 3  // Против часовой (увеличиваем угол)
            updateHexMesh(selectedHex.q, selectedHex.r, hex.height)
          }
          if (e.code === 'KeyE') {
            hex.rotation = (hex.rotation || 0) - Math.PI / 3  // По часовой (уменьшаем угол)
            updateHexMesh(selectedHex.q, selectedHex.r, hex.height)
          }
          if (e.code === 'KeyR') {
            const newHeight = Math.min(4, (hex.height || 0) + 1)
            if (newHeight !== oldHeight && !mapRef.current.hasHex(selectedHex.q, selectedHex.r, newHeight)) {
              // Remove from old height
              mapRef.current.removeHex(selectedHex.q, selectedHex.r, oldHeight)
              const oldMeshKey = `${selectedHex.q},${selectedHex.r}_${oldHeight}`
              const oldMesh = hexMeshesRef.current.get(oldMeshKey)
              if (oldMesh && sceneRef.current) {
                sceneRef.current.remove(oldMesh)
                hexMeshesRef.current.delete(oldMeshKey)
              }

              // Add at new height
              hex.height = newHeight
              mapRef.current.setHex(selectedHex.q, selectedHex.r, hex)
              await updateHexMesh(selectedHex.q, selectedHex.r, newHeight)

              // Force selection highlight update after mesh is created
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setSelectedHexes([selectedHex])
                })
              })
            }
          }
          if (e.code === 'KeyF') {
            const newHeight = Math.max(0, (hex.height || 0) - 1)
            if (newHeight !== oldHeight && !mapRef.current.hasHex(selectedHex.q, selectedHex.r, newHeight)) {
              // Remove from old height
              mapRef.current.removeHex(selectedHex.q, selectedHex.r, oldHeight)
              const oldMeshKey = `${selectedHex.q},${selectedHex.r}_${oldHeight}`
              const oldMesh = hexMeshesRef.current.get(oldMeshKey)
              if (oldMesh && sceneRef.current) {
                sceneRef.current.remove(oldMesh)
                hexMeshesRef.current.delete(oldMeshKey)
              }

              // Add at new height
              hex.height = newHeight
              mapRef.current.setHex(selectedHex.q, selectedHex.r, hex)
              await updateHexMesh(selectedHex.q, selectedHex.r, newHeight)

              // Force selection highlight update after mesh is created
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setSelectedHexes([selectedHex])
                })
              })
            }
          }
        }
      }

      // Delete key deletes all selected hexes (topmost)
      if (e.code === 'Delete' && selectedHexes.length > 0) {
        saveHistoryState()
        for (const hex of selectedHexes) {
          await removeHex(hex.q, hex.r)
        }
        setSelectedHexes([])
      }

      // Copy/Paste with Ctrl+C / Ctrl+V (or Cmd on Mac)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault()
          copyHex()
          return
        }

        if (e.key === 'v' || e.key === 'V') {
          e.preventDefault()
          // Используем позицию курсора мыши (последнюю известную позицию hex под курсором)
          const targetHex = lastMouseHexRef.current
          if (targetHex) {
            await pasteHex(targetHex.q, targetHex.r)
          } else {
            showNotification('error', 'Наведите курсор на ячейку для вставки')
          }
          return
        }

        // Undo/Redo with Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault()
          if (e.shiftKey) {
            // Ctrl+Shift+Z = Redo
            await redo()
          } else {
            // Ctrl+Z = Undo
            await undo()
          }
          return
        }

        // File operations
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault()
          handleNewMap()
          return
        }

        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault()
          handleLoadMap()
          return
        }

        if (e.key === 's' || e.key === 'S') {
          e.preventDefault()
          handleSaveMap()
          return
        }

        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault()
          // Ctrl+Y = Redo
          await redo()
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedHexes])

  // Функция для создания меша выделения
  const createSelectionMesh = (): THREE.Mesh => {
    const scale = 3.5
    const R = 2 / Math.sqrt(3)
    const outerR = R * scale * 1.05
    const innerR = R * scale * 0.95

    const selectionShape = new THREE.Shape()
    for (let i = 0; i < 6; i++) {
      const angle = (i * 60) * (Math.PI / 180)
      const x = outerR * Math.cos(angle)
      const y = outerR * Math.sin(angle)
      if (i === 0) selectionShape.moveTo(x, y)
      else selectionShape.lineTo(x, y)
    }
    selectionShape.closePath()

    const selectionHole = new THREE.Path()
    for (let i = 0; i < 6; i++) {
      const angle = (i * 60) * (Math.PI / 180)
      const x = innerR * Math.cos(angle)
      const y = innerR * Math.sin(angle)
      if (i === 0) selectionHole.moveTo(x, y)
      else selectionHole.lineTo(x, y)
    }
    selectionHole.closePath()
    selectionShape.holes.push(selectionHole)

    const selectionGeom = new THREE.ShapeGeometry(selectionShape)
    selectionGeom.rotateX(-Math.PI / 2)
    selectionGeom.rotateY(Math.PI / 2)

    const selectionMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff, // Bright Cyan (Primary)
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    })
    const sMesh = new THREE.Mesh(selectionGeom, selectionMat)
    sMesh.name = '__selectionHighlight'
    sMesh.renderOrder = 2000
    sMesh.visible = false
    return sMesh
  }

  // Selection Highlight Update Effect
  useEffect(() => {
    if (!sceneRef.current || !mapRef.current) return

    // Удаляем все старые меши выделения, которых нет в текущем выделении
    const currentKeys = new Set(selectedHexes.map(h => `${h.q},${h.r}`))
    selectionMeshesRef.current.forEach((mesh, key) => {
      if (!currentKeys.has(key)) {
        sceneRef.current?.remove(mesh)
        selectionMeshesRef.current.delete(key)
      }
    })

    // Создаем или обновляем меши выделения для всех выделенных hex
    if (selectedHexes.length > 0 && mapRef.current && sceneRef.current) {
      selectedHexes.forEach(selectedHex => {
        const hexKey = `${selectedHex.q},${selectedHex.r}`

        // Always get the topmost hex at this position
        const hex = mapRef.current!.getHex(selectedHex.q, selectedHex.r)
        if (!hex) return

        const [wX, wZ] = hexToWorld(selectedHex.q, selectedHex.r)
        const hexStack = mapRef.current!.getHexStack(selectedHex.q, selectedHex.r)
        const topmostHex = hexStack.length > 0 ? hexStack[hexStack.length - 1] : hex
        const meshKey = topmostHex ? `${selectedHex.q},${selectedHex.r}_${topmostHex.height}` : `${selectedHex.q},${selectedHex.r}`

        // Получаем или создаем меш выделения
        let selectionMesh = selectionMeshesRef.current.get(hexKey)
        if (!selectionMesh) {
          selectionMesh = createSelectionMesh()
          sceneRef.current!.add(selectionMesh)
          selectionMeshesRef.current.set(hexKey, selectionMesh)
        }

        // Wait for mesh to be available if it's not yet created
        const updateHighlight = () => {
          const meshObj = hexMeshesRef.current.get(meshKey)
          let hValue = 0

          if (meshObj) {
            // Force matrix update to get correct world position
            meshObj.updateMatrixWorld(true)
            const box = new THREE.Box3().setFromObject(meshObj)
            if (!box.isEmpty()) {
              hValue = box.max.y
            } else {
              // Fallback: calculate from hex data
              const LEVEL_HEIGHT = tileHeightRef.current || 0.7
              const minY = meshObj.position.y
              hValue = (topmostHex?.height || 0) * LEVEL_HEIGHT - minY + (LEVEL_HEIGHT / 2)
            }
          } else {
            // If mesh not found yet, calculate height from hex data
            const LEVEL_HEIGHT = tileHeightRef.current || 0.7
            const h = topmostHex ? (topmostHex.height || 0) : 0
            hValue = h * LEVEL_HEIGHT + (LEVEL_HEIGHT / 2)
          }

          if (selectionMesh) {
            selectionMesh.position.set(wX, hValue + 0.1, wZ)
            // Mirror the tile's rotation: constant offset PI/2 + hex state rotation
            selectionMesh.rotation.y = Math.PI / 2 + (topmostHex?.rotation || 0)
            selectionMesh.visible = true
            // Force update
            selectionMesh.updateMatrixWorld(true)
          }
        }

        // Always use double requestAnimationFrame to ensure mesh is fully updated
        requestAnimationFrame(() => {
          requestAnimationFrame(updateHighlight)
        })
      })

      // Скрываем старый одиночный меш выделения (для обратной совместимости)
      if (selectionMeshRef.current) {
        selectionMeshRef.current.visible = false
      }
    } else {
      // Скрываем все меши выделения
      selectionMeshesRef.current.forEach(mesh => {
        mesh.visible = false
      })
      // Скрываем старый одиночный меш выделения (для обратной совместимости)
      if (selectionMeshRef.current) {
        selectionMeshRef.current.visible = false
      }
    }
  }, [selectedHexes])

  useEffect(() => {
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current && containerRef.current) {
        const width = containerRef.current.clientWidth
        const height = containerRef.current.clientHeight
        cameraRef.current.aspect = width / height
        cameraRef.current.updateProjectionMatrix()
        rendererRef.current.setSize(width, height)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const getHexAtScreenPosition = (clientX: number, clientY: number): { q: number; r: number } | null => {
    if (!cameraRef.current || !mapRef.current || !canvasRef.current) return null
    const rect = canvasRef.current.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, cameraRef.current)

    // Raycast against hexes - always get the topmost (first) intersection
    const intersects = raycaster.intersectObjects(Array.from(hexMeshesRef.current.values()), true)
    if (intersects.length > 0) {
      let hitMesh: THREE.Object3D | null = intersects[0].object
      let hexKey: string | null = null
      while (hitMesh && !hexKey) {
        const found = Array.from(hexMeshesRef.current.entries()).find(([_, m]) => m === hitMesh)
        if (found) hexKey = found[0]
        else hitMesh = hitMesh.parent
      }

      if (hexKey) {
        const parts = hexKey.split('_')
        const [q, r] = parts[0].split(',').map(Number)
        return { q, r }
      }
    }

    // Raycast against the hit plane if no hex was hit
    const planeIntersects = raycaster.intersectObjects(
      sceneRef.current?.children.filter((c) => c.name === '__hitPlane') || []
    )
    if (planeIntersects.length > 0) {
      const pt = planeIntersects[0].point
      const coords = _worldToHex(pt.x, pt.z)
      if (coords) {
        return coords
      }
    }

    return null
  }

  const getHexAtMousePosition = (event: React.MouseEvent<HTMLCanvasElement>): { q: number; r: number } | null => {
    return getHexAtScreenPosition(event.clientX, event.clientY)
  }

  const handleCanvasClick = async (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!mapRef.current) return

    // Handle tile drag & drop
    if (isDraggingTileRef.current && dragStartHexRef.current) {
      const targetCoords = getHexAtMousePosition(event)
      if (targetCoords) {
        const hexStack = mapRef.current.getHexStack(dragStartHexRef.current.q, dragStartHexRef.current.r)
        if (hexStack.length > 0) {
          // Check if target is different
          if (targetCoords.q !== dragStartHexRef.current.q || targetCoords.r !== dragStartHexRef.current.r) {
            if (isCopyModeRef.current) {
              // CTRL was pressed: copy tile instead of moving
              await copyHexAtPosition(dragStartHexRef.current.q, dragStartHexRef.current.r, targetCoords.q, targetCoords.r)
            } else {
              // Normal drag: move tile
              const hexHeight = hexStack[hexStack.length - 1].height
              if (!mapRef.current.hasHex(targetCoords.q, targetCoords.r, hexHeight)) {
                await moveHex(dragStartHexRef.current.q, dragStartHexRef.current.r, targetCoords.q, targetCoords.r)
              }
            }
          }
        }
      }
      isDraggingTileRef.current = false
      isCopyModeRef.current = false
      dragStartHexRef.current = null
      return
    }

    // Normal click: select hex
    const coords = getHexAtMousePosition(event)
    if (coords) {
      if (mapRef.current.hasHex(coords.q, coords.r)) {
        // Ctrl+ЛКМ: множественное выделение
        if (event.ctrlKey || event.metaKey) {
          setSelectedHexes(prev => {
            // Проверяем, не выбран ли уже этот hex
            const isAlreadySelected = prev.some(h => h.q === coords.q && h.r === coords.r)
            if (isAlreadySelected) {
              // Убираем из выделения
              return prev.filter(h => !(h.q === coords.q && h.r === coords.r))
            } else {
              // Добавляем в выделение
              return [...prev, coords]
            }
          })
        } else {
          // Обычный клик: одиночное выделение
          setSelectedHexes([coords])
        }
      } else {
        // Клик по пустому месту без Ctrl - снимаем выделение
        if (!event.ctrlKey && !event.metaKey) {
          setSelectedHexes([])
        }
      }
    } else {
      // Клик вне карты без Ctrl - снимаем выделение
      if (!event.ctrlKey && !event.metaKey) {
        setSelectedHexes([])
      }
    }
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const dx = event.clientX - lastMouseRef.current.x
    const dy = event.clientY - lastMouseRef.current.y

    if (isRotatingRef.current) {
      cameraAngleYRef.current += dx * 0.01
      cameraAngleXRef.current = Math.max(0.1, Math.min(Math.PI / 2, cameraAngleXRef.current + dy * 0.01))
    } else if (isPanningRef.current) {
      const yaw = cameraAngleYRef.current
      const forward = new THREE.Vector3(-Math.cos(yaw), 0, -Math.sin(yaw))
      const right = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw))
      const panFactor = cameraDistanceRef.current * 0.001
      cameraTargetRef.current.add(right.multiplyScalar(dx * panFactor))
      cameraTargetRef.current.add(forward.multiplyScalar(dy * panFactor))
    }

    // Check if we should start dragging (mouse moved enough from initial click)
    if (mouseDownPosRef.current && !isDraggingTileRef.current && mapRef.current) {
      const moveDistance = Math.sqrt(
        Math.pow(event.clientX - mouseDownPosRef.current.x, 2) +
        Math.pow(event.clientY - mouseDownPosRef.current.y, 2)
      )
      // Start dragging if mouse moved more than 5 pixels
      if (moveDistance > 5) {
        const coords = mouseDownPosRef.current.coords
        if (coords && mapRef.current.hasHex(coords.q, coords.r)) {
          isDraggingTileRef.current = true
          dragStartHexRef.current = { q: coords.q, r: coords.r }
          isCopyModeRef.current = false
        }
      }
    }

    // Update CTRL state during drag (for copy mode)
    if (isDraggingTileRef.current) {
      isCopyModeRef.current = event.ctrlKey || event.metaKey
    }

    // Tile dragging is handled in handleCanvasClick (onMouseUp)
    lastMouseRef.current = { x: event.clientX, y: event.clientY }

    // Обновляем последнюю позицию hex под курсором для вставки
    const coords = getHexAtMousePosition(event)
    lastMouseHexRef.current = coords
  }

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    cameraDistanceRef.current = Math.max(20, Math.min(500, cameraDistanceRef.current + event.deltaY * 0.1))
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground selection:bg-primary/20">
      <aside className="w-80 border-r border-border bg-card/50 backdrop-blur-md flex flex-col z-20">
        <div className="p-6 border-b border-border bg-card/80">
          <h1 className="text-xl font-bold tracking-tight flex flex-col items-center justify-center gap-2">
            <div className="flex items-center justify-center gap-3">
              <div className="w-6 h-6 overflow-visible flex items-center justify-center">
                <div style={{ transform: 'scale(4)' }}>
                  <ModelPreview obj={getAssetPath("/assets/terrain/buildings/blue/building_home_B_blue.obj")} mtl={getAssetPath("/assets/terrain/buildings/blue/building_home_B_blue.mtl")} />
                </div>
              </div>
              <div className="flex flex-col items-start ml-[20px]">
                <span>Medieval Hexagon Map</span>
                <span>Editor</span>
              </div>
            </div>
          </h1>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 flex flex-col h-full gap-6 min-h-0">
            <section className="space-y-4">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assets</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assetCategories.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currentCategory?.folders.map(f => <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2 h-full content-start">
                {availableModels.map((m, i) => (
                  <div
                    key={i}
                    draggable={true}
                    onDragStart={() => {
                      draggedModelRef.current = m
                      setSelectedModel(m)
                    }}
                    onClick={() => setSelectedModel(m)}
                    className={cn("p-1 rounded-xl border-2 transition-all cursor-pointer group hover:bg-muted/30", selectedModel?.name === m.name ? "border-primary bg-primary/5" : "border-transparent bg-muted/10")}
                  >
                    <div className="aspect-square w-full">
                      <ModelPreview obj={getAssetPath(m.obj)} mtl={getAssetPath(m.mtl)} />
                    </div>
                    <p className="text-[11px] font-bold text-center mt-1 truncate px-1 py-1 uppercase tracking-tight">{m.name}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </ScrollArea>
        <div className="p-4 border-t border-border flex flex-col gap-2">
          {/* AI Generation temporarily disabled for GitHub Pages deployment */}
          {false && (
            <Button
              className="w-full font-bold shadow-lg shadow-primary/20 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
              onClick={handleGenerateMap}
              disabled={isGenerating}
            >
              <Sparkle size={16} className="mr-2" />
              {isGenerating ? 'Generating...' : 'Generate Map (AI)'}
            </Button>
          )}
        </div>

        {/* Save Map Dialog */}
        <SaveMapDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          onSave={handleSaveMapConfirm}
        />

        {/* New Map Dialog */}
        <NewMapDialog
          open={newMapDialogOpen}
          onOpenChange={setNewMapDialogOpen}
          onConfirm={handleNewMapConfirm}
        />

        {/* Unsaved Data Dialog */}
        <UnsavedDataDialog
          open={unsavedDataDialogOpen}
          onOpenChange={setUnsavedDataDialogOpen}
          onSave={handleUnsavedDataSave}
          onDiscard={handleUnsavedDataDiscard}
        />

        {/* Generate Map Dialog */}
        <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
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
                <Label>LLM Provider</Label>
                <Tabs value={useLocalModel ? 'local' : 'gemini'} onValueChange={(v) => setUseLocalModel(v === 'local')}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="gemini">Gemini API</TabsTrigger>
                    <TabsTrigger value="local">Local Server</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

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

              {/* Progress display during generation */}
              {isGenerating && generationProgress ? (
                <div className="space-y-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">{generationProgress.stage}</span>
                      <span className="text-xs text-muted-foreground">
                        {generationProgress.timeElapsed}s elapsed
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${generationProgress.progress}%` }}
                      />
                    </div>
                    {generationProgress.progress > 0 && (
                      <span className="text-xs text-blue-400">{generationProgress.progress}%</span>
                    )}
                  </div>

                  {generationProgress.thoughts && (
                    <div className="mt-3 p-3 bg-gray-800/50 rounded border-l-4 border-blue-500">
                      <p className="text-xs text-gray-300 font-mono leading-relaxed">
                        {generationProgress.thoughts}
                      </p>
                    </div>
                  )}
                </div>
              ) : !isGenerating ? (
                <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                  <p className="font-semibold mb-1">Note:</p>
                  {useLocalModel ? (
                    <p>Local models may take 5-10 minutes to generate a map depending on size. The current map will be replaced.</p>
                  ) : (
                    <p>Generation may take 5-10 seconds. The current map will be replaced.</p>
                  )}
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setGenerateDialogOpen(false)} disabled={isGenerating}>
                Cancel
              </Button>
              <Button
                onClick={confirmGenerateMap}
                disabled={
                  isGenerating ||
                  !generatePrompt.trim() ||
                  (useLocalModel && (!selectedLocalModel && localModels.length > 0))
                }
              >
                {isGenerating ? 'Generating...' : 'Generate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </aside>

      <main className="flex-1 relative flex flex-col overflow-hidden bg-[#050505]" ref={containerRef}>
        {/* TOP LEFT: FILE MENU */}
        <Popover>
          <PopoverTrigger asChild>
            <div className="absolute top-4 left-4 z-30 p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-full flex items-center gap-3 px-4 py-2 shadow-2xl cursor-pointer hover:bg-card/90 transition-colors">
              <File size={18} className="text-primary" weight="bold" />
              <span className="text-xs font-bold tracking-tight uppercase text-primary">File</span>
            </div>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 bg-card/95 backdrop-blur-xl border border-border/50 shadow-2xl">
            <div className="space-y-1">
              <div
                onClick={handleNewMap}
                className="flex items-center justify-between px-2 py-2 rounded cursor-pointer hover:bg-primary/10 transition-colors"
              >
                <span>New...</span>
                <span className="text-xs text-muted-foreground">Ctrl+N</span>
              </div>
              <Separator />
              <div
                onClick={handleLoadMap}
                className="flex items-center justify-between px-2 py-2 rounded cursor-pointer hover:bg-primary/10 transition-colors"
              >
                <span>Open...</span>
                <span className="text-xs text-muted-foreground">Ctrl+O</span>
              </div>
              <div
                onClick={handleSaveMap}
                className="flex items-center justify-between px-2 py-2 rounded cursor-pointer hover:bg-primary/10 transition-colors"
              >
                <span>Save...</span>
                <span className="text-xs text-muted-foreground">Ctrl+S</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* TOP CENTER: MAP NAME */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-full flex items-center gap-2 px-4 py-2 shadow-2xl">
          <span className="text-xs font-bold tracking-tight uppercase text-primary">
            {mapName ? `${mapName}${hasUnsavedChanges ? '*' : ''}` : 'Not saved...'}
          </span>
        </div>

        {/* TOP RIGHT: CURRENT SELECTION FROM PREVIEW */}
        {selectedModel && (
          <div className="absolute top-4 right-4 z-30 p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-full flex items-center gap-3 pl-4 pr-2 py-1.5 shadow-2xl overflow-visible">
            <Cube size={18} className="text-primary" weight="bold" />
            <div className="flex flex-col leading-none">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold leading-tight">Placing</span>
              <span className="text-xs font-bold tracking-tight uppercase">{selectedModel.name}</span>
            </div>
            <div className="w-8 h-8 overflow-visible ml-1 flex items-center justify-center">
              <div style={{ transform: 'scale(2.5)' }}>
                <ModelPreview obj={getAssetPath(selectedModel.obj)} mtl={getAssetPath(selectedModel.mtl)} />
              </div>
            </div>
          </div>
        )}

        {/* LEFT CENTER: GLOBAL HEIGHT LEVEL SELECTOR */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-card/80 backdrop-blur-xl border border-border/50 hover:bg-primary/20 text-primary transition-all shadow-xl"
            onClick={() => setCurrentHeightLevel(prev => Math.min(4, prev + 1))}
            disabled={currentHeightLevel >= 4}
          >
            <CaretUp size={20} weight="bold" />
          </Button>
          <div className="p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-2xl px-4 py-3 shadow-2xl">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none">Level</span>
              <span className="text-2xl font-black text-primary tracking-tighter tabular-nums">{currentHeightLevel + 1}</span>
              <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest leading-none">of 5</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-card/80 backdrop-blur-xl border border-border/50 hover:bg-primary/20 text-primary transition-all shadow-xl"
            onClick={() => setCurrentHeightLevel(prev => Math.max(0, prev - 1))}
            disabled={currentHeightLevel <= 0}
          >
            <CaretDown size={20} weight="bold" />
          </Button>
        </div>

        {/* BOTTOM LEFT: GRID INFO */}
        <div className="absolute bottom-24 left-6 z-30 p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-full flex items-center gap-3 px-4 py-2 shadow-2xl">
          <MapTrifold size={18} className="text-primary" weight="bold" />
          <span className="text-xs font-bold tracking-tight uppercase">GRID: {MAP_SIZES[mapSize].width}×{MAP_SIZES[mapSize].height}</span>
        </div>

        {/* BOTTOM LEFT: SELECTION INFO */}
        {selectedHexes.length > 0 && mapRef.current?.getHex(selectedHexes[0].q, selectedHexes[0].r) && (
          <div className="absolute bottom-6 left-6 z-30 p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-full flex items-center gap-4 pl-6 pr-2 py-3 shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-left-4 duration-300 overflow-visible">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {selectedHexes.length > 1 ? 'Selected' : 'Hex'}
              </span>
              {selectedHexes.length === 1 ? (
                <span className="text-sm font-black text-primary tracking-tighter tabular-nums">{selectedHexes[0].q}, {selectedHexes[0].r}</span>
              ) : (
                <span className="text-sm font-black text-primary tracking-tighter tabular-nums">{selectedHexes.length} hexes</span>
              )}
            </div>
            {selectedHexes.length === 1 && (
              <>
                <Separator orientation="vertical" className="h-5 bg-border/50" />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Level</span>
                  <span className="text-sm font-black text-primary tracking-tighter tabular-nums">{(mapRef.current.getHex(selectedHexes[0].q, selectedHexes[0].r)?.height || 0) + 1}/5</span>
                </div>
                <Separator orientation="vertical" className="h-5 bg-border/50" />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Type</span>
                  <span className="text-xs font-bold text-primary tracking-tight uppercase">{mapRef.current.getHex(selectedHexes[0].q, selectedHexes[0].r)?.modelData?.name || mapRef.current.getHex(selectedHexes[0].q, selectedHexes[0].r)?.terrain || 'Standard'}</span>
                </div>
                {/* Tile Preview */}
                {(() => {
                  const selectedHex = mapRef.current.getHex(selectedHexes[0].q, selectedHexes[0].r)
                  if (selectedHex?.modelData) {
                    return (
                      <div className="w-8 h-8 overflow-visible ml-1 flex items-center justify-center">
                        <div style={{ transform: 'scale(2.5)' }}>
                          <ModelPreview obj={getAssetPath(selectedHex.modelData.obj)} mtl={getAssetPath(selectedHex.modelData.mtl)} />
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}
              </>
            )}
          </div>
        )}

        {/* BOTTOM CENTER: CAMERA MODE */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-full flex items-center gap-3 px-4 py-2 shadow-2xl transition-all hover:bg-card/95">
          <Compass size={18} className="text-primary animate-pulse" />
          <span className="text-xs font-bold tracking-tight uppercase">3D PERSPECTIVE</span>
          <Separator orientation="vertical" className="h-4 bg-border/50" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-primary/20 text-primary transition-colors" onClick={() => { cameraDistanceRef.current = 150; cameraAngleXRef.current = Math.PI / 4; cameraAngleYRef.current = Math.PI / 4; }}>
                <ArrowsInLineHorizontal size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset View</TooltipContent>
          </Tooltip>
        </div>

        {/* BOTTOM RIGHT: CONTROLS */}
        <Popover>
          <PopoverTrigger asChild>
            <div className="absolute bottom-6 right-6 z-30 p-1 bg-card/80 backdrop-blur-xl border border-border/50 rounded-full flex items-center gap-4 pl-6 pr-6 py-3 shadow-2xl pointer-events-auto cursor-pointer hover:bg-card/90 transition-colors">
              <Keyboard size={18} className="text-primary" weight="bold" />
              <span className="text-xs font-bold tracking-tight uppercase text-primary">Controls</span>
            </div>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-80 bg-card/95 backdrop-blur-xl border border-border/50 shadow-2xl"
          >
            <div className="space-y-3">
              <h4 className="font-bold text-sm uppercase tracking-wider text-primary mb-3">Keyboard Shortcuts</h4>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Move tile (if selected)</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">WASD</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Pan camera (no selection)</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">WASD</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Rotate tile</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Q / E</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Change height</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">R / F</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Delete tile</span>
                  <span className="bg-destructive/20 px-2 py-0.5 rounded border border-destructive/30 text-destructive font-mono font-bold">DEL</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Copy tile</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Ctrl+C</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Paste tile</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Ctrl+V</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Undo</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Ctrl+Z</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Redo</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Ctrl+Y / Ctrl+Shift+Z</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">New map</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Ctrl+N</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Open map</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Ctrl+O</span>
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Save map</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-mono font-bold">Ctrl+S</span>
                </div>
              </div>

              <Separator className="my-3" />

              <h4 className="font-bold text-sm uppercase tracking-wider text-primary mb-3">Mouse Controls</h4>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Select / Drag tile</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-bold">LMB</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Multiple selection</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-bold">Ctrl+LMB</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Copy tile (drag)</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-bold">Ctrl+Drag</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Pan camera</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-bold">MMB</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-border/30">
                  <span className="text-muted-foreground">Rotate camera</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-bold">RMB</span>
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Zoom</span>
                  <span className="bg-primary/20 px-2 py-0.5 rounded border border-primary/30 text-primary font-bold">Wheel</span>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex-1 relative">
          {isLoading && <div className="absolute inset-0 bg-background/90 z-50 flex items-center justify-center font-bold uppercase tracking-widest">{loadingText}</div>}
          <canvas
            ref={canvasRef}
            className="w-full h-full outline-none cursor-crosshair"
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={async (e) => {
              e.preventDefault()
              if (!draggedModelRef.current || !mapRef.current || !canvasRef.current || !cameraRef.current) return
              const rect = canvasRef.current.getBoundingClientRect()
              const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
              )
              const raycaster = new THREE.Raycaster()
              raycaster.setFromCamera(mouse, cameraRef.current)
              const intersects = raycaster.intersectObjects(Array.from(hexMeshesRef.current.values()), true)
              let targetCoords: { q: number; r: number } | null = null

              if (intersects.length > 0) {
                let hitMesh: THREE.Object3D | null = intersects[0].object
                let hexKey: string | null = null
                while (hitMesh && !hexKey) {
                  const found = Array.from(hexMeshesRef.current.entries()).find(([_, m]) => m === hitMesh)
                  if (found) hexKey = found[0]
                  else hitMesh = hitMesh.parent
                }
                if (hexKey) {
                  // Parse key format: "q,r_height"
                  const parts = hexKey.split('_')
                  const [q, r] = parts[0].split(',').map(Number)
                  targetCoords = { q, r }
                }
              }

              if (!targetCoords) {
                const planeIntersects = raycaster.intersectObjects(
                  sceneRef.current?.children.filter((c) => c.name === '__hitPlane') || []
                )
                if (planeIntersects.length > 0) {
                  targetCoords = _worldToHex(planeIntersects[0].point.x, planeIntersects[0].point.z)
                }
              }

              if (targetCoords) {
                const { q, r } = targetCoords
                setSelectedModel(draggedModelRef.current)

                if (selectedCategory === 'tiles') {
                  let t = selectedTerrain
                  if (selectedFolder === 'roads') t = TERRAIN_TYPES.ROAD
                  else if (selectedFolder === 'coast') t = TERRAIN_TYPES.WATER

                  // Validate coordinates before proceeding
                  if (!Number.isFinite(q) || !Number.isFinite(r)) {
                    console.error('Invalid coordinates from drop:', q, r)
                    return
                  }

                  // Find next available level starting from current global level
                  let targetLevel = currentHeightLevel
                  while (targetLevel <= 4 && mapRef.current.hasHex(q, r, targetLevel)) {
                    targetLevel++
                  }

                  // Only place if we found a free level
                  if (targetLevel <= 4) {
                    const h = new Hex(q, r, t)
                    h.modelData = draggedModelRef.current
                    h.height = targetLevel
                    mapRef.current.setHex(q, r, h)
                    await updateHexMesh(q, r, targetLevel)
                    // Отмечаем изменения
                    setHasUnsavedChanges(true)
                  }
                } else {
                  // For buildings, same logic
                  let targetLevel = currentHeightLevel
                  while (targetLevel <= 4 && mapRef.current.hasHex(q, r, targetLevel)) {
                    targetLevel++
                  }

                  if (targetLevel <= 4) {
                    const h = new Hex(q, r, TERRAIN_TYPES.PLAINS)
                    h.modelData = draggedModelRef.current
                    h.height = targetLevel
                    mapRef.current.setHex(q, r, h)
                    await updateHexMesh(q, r, targetLevel)
                    // Отмечаем изменения
                    setHasUnsavedChanges(true)
                  }
                }
              }
              draggedModelRef.current = null
            }}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onMouseDown={(e) => {
              if (e.button === 0) {
                // Left click: remember position for potential drag
                // Don't start drag immediately - wait for mouse movement
                const coords = getHexAtMousePosition(e)
                if (coords && mapRef.current && mapRef.current.hasHex(coords.q, coords.r)) {
                  mouseDownPosRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    coords: coords
                  }
                } else {
                  mouseDownPosRef.current = null
                }
              } else if (e.button === 2) {
                // Right click: rotate camera
                isRotatingRef.current = true
              } else if (e.button === 1) {
                // Middle click: pan camera
                isPanningRef.current = true
              }
            }}
            onMouseUp={(e) => {
              if (e.button === 0) {
                // Handle tile drag end in handleCanvasClick
                // Clear mouse down position
                mouseDownPosRef.current = null
              } else {
                isDraggingTileRef.current = false
                isCopyModeRef.current = false
                dragStartHexRef.current = null
                mouseDownPosRef.current = null
              }
              isRotatingRef.current = false
              isPanningRef.current = false
            }}
            onMouseLeave={() => {
              isDraggingTileRef.current = false
              isCopyModeRef.current = false
              dragStartHexRef.current = null
              mouseDownPosRef.current = null
              isRotatingRef.current = false
              isPanningRef.current = false
            }}
            onWheel={handleWheel}
            onContextMenu={e => e.preventDefault()}
          />
        </div>
      </main>

      <style jsx global>{`
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
      `}</style>

      {/* Notification Toast - positioned at bottom right of viewport */}
      {notification && (
        <div className={cn(
          "fixed bottom-6 right-6 z-[100] p-4 rounded-lg shadow-2xl border backdrop-blur-xl animate-in slide-in-from-bottom-4",
          notification.type === 'success'
            ? "bg-green-500/90 border-green-400/50 text-white"
            : "bg-red-500/90 border-red-400/50 text-white"
        )}>
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <FloppyDisk size={20} weight="fill" />
            ) : (
              <Trash size={20} weight="fill" />
            )}
            <span className="font-bold text-sm">{notification.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}
