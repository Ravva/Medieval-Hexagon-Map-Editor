import * as THREE from 'three'
import { Hex } from '@/lib/game/Hex'
import { Map as GameMap } from '@/lib/game/Map'
import { axialToWorld, worldToAxial, offsetToAxial } from '@/lib/game/HexCoordinateConverter'
import { modelLoader } from '@/lib/three/ModelLoader'

export interface CreateHexMeshParams {
  hex: Hex
  map: GameMap
  selectedModel: { obj: string; mtl: string; name: string } | null
  availableModels?: Array<{ obj: string; mtl: string; name: string }>
  scene: THREE.Scene | null
  tileHeightRef: React.MutableRefObject<number>
  hexToWorld: (q: number, r: number, mWidth?: number, mHeight?: number) => [number, number]
}

/**
 * Creates a Three.js mesh group for a hex tile
 */
export async function createHexMesh(params: CreateHexMeshParams): Promise<THREE.Group | null> {
  const { hex, map, selectedModel, availableModels, scene, tileHeightRef, hexToWorld } = params
  const [worldX, worldZ] = hexToWorld(hex.q, hex.r, map.width, map.height)

  try {
    const model = hex.modelData || selectedModel || (availableModels && availableModels[0]) || null
    if (model) {
      // If hex didn't have modelData, save it now to ensure persistence
      if (!hex.modelData) hex.modelData = model

      const key = `terrain_${hex.terrain}_${model.name}_${hex.q}_${hex.r}`

      // Try to get from cache synchronously first
      let loadedModel = modelLoader.getCachedModel(key)

      // If not in cache, wait for it
      if (!loadedModel) {
        loadedModel = await modelLoader.loadModel(key, model.obj, model.mtl)
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
        const gridGroup = scene?.getObjectByName(`__hexGrid_level_${hex.height || 0}`)
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

export interface CreateHexagonalGridParams {
  width: number
  height: number
  level: number
  map: GameMap
  tileHeightRef: React.MutableRefObject<number>
  hexToWorld: (q: number, r: number, mWidth?: number, mHeight?: number) => [number, number]
}

/**
 * Creates a hexagonal grid visualization for a specific level
 */
export function createHexagonalGrid(params: CreateHexagonalGridParams): THREE.Group {
  const { width, height, level, map, tileHeightRef, hexToWorld } = params

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
  // Always create grid for all positions in the rectangular grid, regardless of map state
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Convert offset to axial for grid creation
      const { q, r } = offsetToAxial(x, y)
      // Create grid for all positions in rectangular bounds, even if map is empty
      // This ensures grid is visible in production build when map is empty
      if (q >= 0 && q < width && r >= -width && r < height + width) {
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

/**
 * Sets up lighting for the Three.js scene
 */
export function setupLighting(scene: THREE.Scene): void {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(50, 100, 50)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  scene.add(directionalLight)
}

/**
 * Creates a selection highlight mesh for a hex tile
 */
export function createSelectionMesh(): THREE.Mesh {
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

