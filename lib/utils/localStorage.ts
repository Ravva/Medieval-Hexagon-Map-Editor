/**
 * Утилиты для безопасного локального хранения настроек пользователя
 */

// Простое XOR шифрование для API ключей (базовая защита от случайного просмотра)
const STORAGE_KEY = 'mapEditor_settings'
const XOR_KEY = 'medieval_hex_map_editor_2025' // Статический ключ для простоты

interface UserSettings {
  // Gemini API settings
  geminiApiKey?: string // Будет зашифрован

  // Generation settings
  lastPrompt?: string
  lastBiome?: 'plains' | 'water' | 'forest' | 'mountain'
  lastMapSize?: string

  // Local model settings
  useLocalModel?: boolean
  localModelUrl?: string
  selectedLocalModel?: string

  // UI preferences
  lastCategory?: string
  lastFolder?: string
}

/**
 * Простое XOR шифрование/дешифрование
 */
function xorEncrypt(text: string, key: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return btoa(result) // Base64 encode
}

function xorDecrypt(encrypted: string, key: string): string {
  try {
    const decoded = atob(encrypted) // Base64 decode
    let result = ''
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return result
  } catch {
    return '' // Возвращаем пустую строку если дешифровка не удалась
  }
}

/**
 * Сохранить настройки пользователя
 */
export function saveUserSettings(settings: Partial<UserSettings>): void {
  try {
    // Получаем существующие настройки
    const existing = getUserSettings()

    // Объединяем с новыми
    const updated = { ...existing, ...settings }

    // Шифруем API ключ если он есть
    const toStore = { ...updated }
    if (toStore.geminiApiKey) {
      toStore.geminiApiKey = xorEncrypt(toStore.geminiApiKey, XOR_KEY)
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
  } catch (error) {
    console.warn('Failed to save user settings:', error)
  }
}

/**
 * Получить настройки пользователя
 */
export function getUserSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return {}

    const parsed = JSON.parse(stored) as UserSettings

    // Дешифруем API ключ если он есть
    if (parsed.geminiApiKey) {
      parsed.geminiApiKey = xorDecrypt(parsed.geminiApiKey, XOR_KEY)
    }

    return parsed
  } catch (error) {
    console.warn('Failed to load user settings:', error)
    return {}
  }
}

/**
 * Очистить все настройки пользователя
 */
export function clearUserSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('Failed to clear user settings:', error)
  }
}

/**
 * Сохранить только API ключ Gemini
 */
export function saveGeminiApiKey(apiKey: string): void {
  saveUserSettings({ geminiApiKey: apiKey })
}

/**
 * Получить API ключ Gemini
 */
export function getGeminiApiKey(): string {
  return getUserSettings().geminiApiKey || ''
}

/**
 * Сохранить настройки генерации
 */
export function saveGenerationSettings(settings: {
  prompt?: string
  biome?: 'plains' | 'water' | 'forest' | 'mountain'
  mapSize?: string
  useLocalModel?: boolean
  localModelUrl?: string
  selectedLocalModel?: string
}): void {
  saveUserSettings({
    lastPrompt: settings.prompt,
    lastBiome: settings.biome,
    lastMapSize: settings.mapSize,
    useLocalModel: settings.useLocalModel,
    localModelUrl: settings.localModelUrl,
    selectedLocalModel: settings.selectedLocalModel,
  })
}

/**
 * Получить настройки генерации
 */
export function getGenerationSettings() {
  const settings = getUserSettings()
  return {
    lastPrompt: settings.lastPrompt || '',
    lastBiome: settings.lastBiome || 'plains',
    lastMapSize: settings.lastMapSize || 'tiny',
    useLocalModel: settings.useLocalModel || false,
    localModelUrl: settings.localModelUrl || 'http://localhost:1234',
    selectedLocalModel: settings.selectedLocalModel || '',
  }
}

/**
 * Сохранить настройки UI
 */
export function saveUISettings(settings: {
  category?: string
  folder?: string
}): void {
  saveUserSettings({
    lastCategory: settings.category,
    lastFolder: settings.folder,
  })
}

/**
 * Получить настройки UI
 */
export function getUISettings() {
  const settings = getUserSettings()
  return {
    lastCategory: settings.lastCategory || '',
    lastFolder: settings.lastFolder || '',
  }
}
