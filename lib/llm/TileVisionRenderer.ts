/**
 * TileVisionRenderer - Utility for rendering tile screenshots for vision analysis
 *
 * Creates 6 screenshots of a tile from different angles, focusing on each hex edge.
 * Used for vision model analysis of tile connections.
 */

import * as THREE from 'three'

export interface RenderOptions {
  width?: number
  height?: number
  fov?: number
  distance?: number
  backgroundColor?: number
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  width: 512,
  height: 512,
  fov: 45,
  distance: 8,
  backgroundColor: 0x1a1a1a,
}

/**
 * Hexagonal directions (flat-topped)
 * Each direction corresponds to one edge of the hexagon
 */
const HEX_DIRECTIONS = [
  { name: 'east', angle: 0, label: 'E' },
  { name: 'southeast', angle: 60, label: 'SE' },
  { name: 'southwest', angle: 120, label: 'SW' },
  { name: 'west', angle: 180, label: 'W' },
  { name: 'northwest', angle: 240, label: 'NW' },
  { name: 'northeast', angle: 300, label: 'NE' },
] as const

/**
 * Render a tile from 6 different angles (one per edge)
 * Returns base64 encoded PNG images
 */
export async function renderTileFromMultipleAngles(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  options: RenderOptions = {}
): Promise<string[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Сохраняем исходные настройки камеры
  const originalPosition = camera.position.clone()
  const originalLookAt = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()))

  // Настраиваем рендерер
  renderer.setSize(opts.width, opts.height)
  renderer.setClearColor(opts.backgroundColor)

  const images: string[] = []

  // Рендерим с каждого угла
  for (const dir of HEX_DIRECTIONS) {
    // Вычисляем позицию камеры для фокуса на конкретном ребре
    const angleRad = (dir.angle * Math.PI) / 180
    const x = Math.cos(angleRad) * opts.distance
    const z = Math.sin(angleRad) * opts.distance
    const y = opts.distance * 0.6 // Немного сверху для лучшего обзора

    // Позиционируем камеру
    camera.position.set(x, y, z)
    camera.lookAt(0, 0, 0)

    // Рендерим
    renderer.render(scene, camera)

    // Получаем изображение как base64
    const dataUrl = renderer.domElement.toDataURL('image/png')
    images.push(dataUrl)
  }

  // Восстанавливаем исходную позицию камеры
  camera.position.copy(originalPosition)
  camera.lookAt(originalLookAt.x, originalLookAt.y, originalLookAt.z)

  return images
}

/**
 * Render a single tile from a specific angle
 */
export async function renderTileFromAngle(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  angle: number, // в градусах
  options: RenderOptions = {}
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Сохраняем исходные настройки
  const originalPosition = camera.position.clone()
  const originalLookAt = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()))

  // Настраиваем рендерер
  renderer.setSize(opts.width, opts.height)
  renderer.setClearColor(opts.backgroundColor)

  // Вычисляем позицию камеры
  const angleRad = (angle * Math.PI) / 180
  const x = Math.cos(angleRad) * opts.distance
  const z = Math.sin(angleRad) * opts.distance
  const y = opts.distance * 0.6

  // Позиционируем камеру
  camera.position.set(x, y, z)
  camera.lookAt(0, 0, 0)

  // Рендерим
  renderer.render(scene, camera)

  // Получаем изображение
  const dataUrl = renderer.domElement.toDataURL('image/png')

  // Восстанавливаем исходную позицию
  camera.position.copy(originalPosition)
  camera.lookAt(originalLookAt.x, originalLookAt.y, originalLookAt.z)

  return dataUrl
}

/**
 * Extract base64 data from data URL
 */
export function extractBase64FromDataUrl(dataUrl: string): string {
  // Формат: "data:image/png;base64,iVBORw0KGgo..."
  const base64Index = dataUrl.indexOf('base64,')
  if (base64Index === -1) {
    return dataUrl // Уже base64 или другой формат
  }
  return dataUrl.substring(base64Index + 7) // +7 для "base64,"
}

