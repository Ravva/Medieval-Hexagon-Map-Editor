'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Cube } from '@phosphor-icons/react'
import { modelLoader } from '@/lib/three/ModelLoader'
import { cn } from '@/lib/utils'

let renderQueue: Promise<void> = Promise.resolve()
let sharedPreviewRenderer: THREE.WebGLRenderer | null = null
let sharedPreviewScene: THREE.Scene | null = null
let sharedPreviewCamera: THREE.PerspectiveCamera | null = null

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
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  return Promise.all(
    textures.map((texture) => {
      return new Promise<void>((resolve) => {
        if (!texture.image) {
          const checkInterval = setInterval(() => {
            if (texture.image) {
              clearInterval(checkInterval)
              clearTimeout(timeout)
              resolve()
            }
          }, 50)

          const timeout = setTimeout(() => {
            clearInterval(checkInterval)
            resolve()
          }, maxWait)
          return
        }

        const image = texture.image as HTMLImageElement | HTMLCanvasElement | VideoFrame | ImageBitmap | null

        if (image instanceof HTMLCanvasElement || image instanceof ImageBitmap || image instanceof VideoFrame) {
          resolve()
          return
        }

        if (image instanceof HTMLImageElement) {
          if (image.complete && image.naturalWidth > 0) {
            resolve()
            return
          }

          let resolved = false
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true
              resolve()
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
              resolve()
            }
          }
        } else {
          resolve()
        }
      })
    })
  ).then(() => {
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
      sharedPreviewRenderer.setPixelRatio(1)
      sharedPreviewRenderer.setSize(120, 120)

      sharedPreviewScene = new THREE.Scene()
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

interface TilePreviewProps {
  obj: string
  mtl: string
  className?: string
}

export function TilePreview({ obj, mtl, className }: TilePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hasImage, setHasImage] = useState(false)
  const previewIdRef = useRef<string>(`preview_${Date.now()}_${Math.random()}`)

  useEffect(() => {
    const shared = initSharedPreview()
    if (!shared || !canvasRef.current) return

    setHasImage(false)
    const ctx = canvasRef.current.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, 120, 120)
    }

    let isMounted = true
    const { renderer, scene, camera } = shared
    const previewId = previewIdRef.current
    let tempGroup: THREE.Group | null = null

    modelLoader.loadModel(`${obj}_preview`, obj, mtl).then(model => {
      if (!isMounted) return

      const modelInstance = model.clone()

      const box = new THREE.Box3().setFromObject(modelInstance)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())

      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = 3.8 / (maxDim || 1)

      modelInstance.scale.set(scale, scale, scale)

      const scaledCenter = center.clone().multiplyScalar(scale)
      modelInstance.position.sub(scaledCenter)

      modelInstance.rotation.y = Math.PI / 2

      renderQueue = renderQueue.then(() => {
        return new Promise<void>((resolve) => {
          if (!isMounted) {
            resolve()
            return
          }

          const existingPreview = scene.getObjectByName(previewId)
          if (existingPreview) {
            scene.remove(existingPreview)
          }

          tempGroup = new THREE.Group()
          tempGroup.name = previewId
          tempGroup.add(modelInstance)
          scene.add(tempGroup)

          waitForTexturesLoaded(modelInstance, 3000).then(() => {
            if (!isMounted || !tempGroup) {
              resolve()
              return
            }

            renderer.setClearColor(0x000000, 0)
            renderer.render(scene, camera)

            const ctx = canvasRef.current?.getContext('2d')
            if (ctx && canvasRef.current) {
              ctx.clearRect(0, 0, 120, 120)
              ctx.drawImage(
                renderer.domElement,
                0, 0, 120, 120,
                0, 0, 120, 120
              )

              if (isMounted) {
                setHasImage(true)
              }
            }

            if (tempGroup) {
              scene.remove(tempGroup)
              tempGroup = null
            }

            resolve()
          }).catch(() => {
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
      renderQueue = renderQueue.then(() => {
        const existingPreview = scene.getObjectByName(previewId)
        if (existingPreview) {
          scene.remove(existingPreview)
        }
      })
    }
  }, [obj, mtl])

  return (
    <div className={cn("relative w-full h-full bg-muted/20 rounded-lg overflow-hidden flex items-center justify-center", className)}>
      {!hasImage && <div className="absolute inset-0 flex items-center justify-center"><Cube className="animate-spin text-muted-foreground/30" size={24} /></div>}
      <canvas ref={canvasRef} width={120} height={120} className={cn("w-full h-full pointer-events-none transition-opacity duration-300", hasImage ? "opacity-100" : "opacity-0")} />
    </div>
  )
}

