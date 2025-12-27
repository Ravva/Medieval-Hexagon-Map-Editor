/**
 * ModelLoader - Handles loading and caching of 3D models (OBJ/MTL)
 * TypeScript version adapted from js/core/ModelLoader.js for Next.js
 */

import * as THREE from 'three'

// Dynamic imports для Next.js
type OBJLoaderType = typeof import('three/examples/jsm/loaders/OBJLoader.js').OBJLoader
type MTLLoaderType = typeof import('three/examples/jsm/loaders/MTLLoader.js').MTLLoader

let OBJLoaderClass: OBJLoaderType | null = null
let MTLLoaderClass: MTLLoaderType | null = null

async function loadLoaders() {
  if (!OBJLoaderClass || !MTLLoaderClass) {
    const objModule = await import('three/examples/jsm/loaders/OBJLoader.js')
    const mtlModule = await import('three/examples/jsm/loaders/MTLLoader.js')
    OBJLoaderClass = objModule.OBJLoader
    MTLLoaderClass = mtlModule.MTLLoader
  }
  return { OBJLoader: OBJLoaderClass, MTLLoader: MTLLoaderClass }
}

export class ModelLoader {
  private models: Map<string, THREE.Group>
  private loadingPromises: Map<string, Promise<THREE.Group>>
  private objLoader: InstanceType<OBJLoaderType> | null = null
  private mtlLoader: InstanceType<MTLLoaderType> | null = null
  private loadersReady: Promise<void>

  constructor() {
    this.models = new Map()
    this.loadingPromises = new Map()
    this.loadersReady = loadLoaders().then(({ OBJLoader: OBJ, MTLLoader: MTL }) => {
      this.objLoader = new OBJ() as InstanceType<OBJLoaderType>
      this.mtlLoader = new MTL() as InstanceType<MTLLoaderType>
    })
    console.log('ModelLoader initialized')
  }

  /**
   * Load a 3D model from OBJ/MTL files
   */
  async loadModel(
    key: string,
    objPath: string,
    mtlPath: string | null = null
  ): Promise<THREE.Group> {
    await this.loadersReady

    if (!this.objLoader || !this.mtlLoader) {
      throw new Error('Loaders not initialized')
    }
    // Return cached model if available
    const cached = this.models.get(key)
    if (cached) {
      return cached.clone()
    }

    // Return existing loading promise if already loading
    const existingPromise = this.loadingPromises.get(key)
    if (existingPromise) {
      const model = await existingPromise
      return model.clone()
    }

    // Start loading
    const loadingPromise = this._loadModelInternal(key, objPath, mtlPath)
    this.loadingPromises.set(key, loadingPromise)

    try {
      const model = await loadingPromise
      this.loadingPromises.delete(key)
      return model.clone()
    } catch (error) {
      this.loadingPromises.delete(key)
      throw error
    }
  }

  /**
   * Get a cached model synchronously
   */
  getCachedModel(key: string): THREE.Group | null {
    const cached = this.models.get(key)
    if (cached) {
      return cached.clone()
    }
    return null
  }

  private async _loadModelInternal(
    key: string,
    objPath: string,
    mtlPath: string | null
  ): Promise<THREE.Group> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Model loading timed out for ${key}`)), 5000)
    )

    try {
      if (!this.objLoader || !this.mtlLoader) {
        throw new Error('Loaders not initialized')
      }

      let materials: any = null

      if (mtlPath && this.mtlLoader) {
        const mtlLoadPromise = new Promise<any>((resolve, reject) => {
          this.mtlLoader!.load(
            mtlPath,
            (loadedMaterials) => {
              loadedMaterials.preload()
              resolve(loadedMaterials)
            },
            undefined,
            reject
          )
        })
        materials = await Promise.race([mtlLoadPromise, timeoutPromise])
        if (this.objLoader) {
          this.objLoader.setMaterials(materials)
        }
      }

      const objLoadPromise = new Promise<THREE.Group>((resolve, reject) => {
        if (!this.objLoader) {
          reject(new Error('OBJLoader not initialized'))
          return
        }
        this.objLoader.load(
          objPath,
          (object) => {
            const group = object instanceof THREE.Group ? object : new THREE.Group().add(object)
            this.models.set(key, group)
            resolve(group)
          },
          undefined,
          reject
        )
      })
      const model = await Promise.race([objLoadPromise, timeoutPromise])

      console.log(`Model loaded: ${key} from ${objPath}`)
      return model
    } catch (error) {
      console.error(`Failed to load model ${key}:`, error)
      throw new Error(
        `Failed to load model ${key}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Preload multiple models
   */
  async preloadModels(
    models: Array<{ key: string; obj: string; mtl?: string | null }>
  ): Promise<void> {
    const loadPromises = models.map(({ key, obj, mtl }) =>
      this.loadModel(key, obj, mtl ?? null).catch((error) => {
        console.warn(`Failed to preload model ${key}:`, error)
        return null
      })
    )

    const globalTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Overall model preloading timed out')), 15000)
    )

    try {
      await Promise.race([Promise.all(loadPromises), globalTimeout])
      console.log(`Preloaded ${models.length} models`)
    } catch (error) {
      console.error('Error during model preloading:', error)
    }
  }

  /**
   * Clear all cached models
   */
  clearCache(): void {
    this.models.clear()
    this.loadingPromises.clear()
  }

  /**
   * Get a fallback mesh if model loading fails
   */
  createFallbackMesh(terrainType: string): THREE.Mesh {
    const hexSize = 3.5
    // Радиус вписанной окружности для плотного размещения без зазоров
    const radius = hexSize
    const geometry = new THREE.CylinderGeometry(radius, radius, 0.2, 6)
    const material = new THREE.MeshStandardMaterial({
      color: this.getTerrainColor(terrainType),
      roughness: 0.7,
      metalness: 0.1,
    })
    return new THREE.Mesh(geometry, material)
  }

  private getTerrainColor(terrainType: string): number {
    const colors: Record<string, number> = {
      PLAINS: 0x90ee90,
      FOREST: 0x228b22,
      MOUNTAIN: 0x8b4513,
      WATER: 0x4169e1,
      ROAD: 0xd2b48c,
    }
    return colors[terrainType] ?? 0xffffff
  }
}

// Singleton instance
export const modelLoader = new ModelLoader()
