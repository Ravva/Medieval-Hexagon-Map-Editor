# План Интеграции LLM в Генерацию Гексагональных Карт

## Оглавление

1. [Анализ бесплатных LLM API (2024-2025)](#1-анализ-бесплатных-llm-api-2024-2025)
2. [Семантическая интерпретация 3D-ассетов](#2-семантическая-интерпретация-3d-ассетов)
3. [Создание реестра тайлов (Tile Database)](#3-создание-реестра-тайлов-tile-database)
4. [Архитектура системы генерации](#4-архитектура-системы-генерации)
5. [Промпт-инжиниринг и JSON Schema](#5-промпт-инжиниринг-и-json-schema)
6. [Логика биомов и реалистичность](#6-логика-биомов-и-реалистичность)
7. [Детальный план реализации](#7-детальный-план-реализации)

---

## 1. Анализ бесплатных LLM API (2024-2025)

### 1.1. Критерии выбора API

Для автоматизированной генерации карт необходимы следующие возможности:

- ✅ **JSON Mode / Structured Output**: Поддержка структурированного вывода для гарантированного формата ответа
- ✅ **Бесплатный tier**: Достаточный для разработки и демонстрации
- ✅ **Скорость ответа**: Приемлемое время генерации (до 10 секунд для карты)
- ✅ **Токены контекста**: Достаточно для передачи реестра тайлов + промпта
- ✅ **Качество следования инструкциям**: Высокая точность соблюдения JSON Schema

### 1.2. Рекомендуемые провайдеры

#### 1.2.1. Google Gemini 2.5 Flash (Приоритет #1)

**Преимущества:**
- ✅ Отличные лимиты токенов: 1,048,576 input токенов, 65,536 output токенов
- ✅ Нативная поддержка JSON Schema через `responseMimeType` и `responseSchema`
- ✅ Высокая скорость генерации
- ✅ Хорошее понимание структурированных данных
- ✅ Идеальна для больших промптов (например, с полным реестром тайлов)

**API Endpoint:**
```typescript
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
```

**Пример запроса:**
```typescript
{
  contents: [...],
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: { /* JSON Schema */ }
  }
}
```

**Лимиты токенов:**
- Input: 1,048,576 токенов (~4M символов)
- Output: 65,536 токенов (~262K символов)
- ⚠️ Важно: Проверьте доступность модели и квоты в вашем регионе

#### 1.2.2. OpenAI GPT-4o-mini (Альтернатива #1)

**Преимущества:**
- ✅ Бесплатный tier через платформы-посредники (Groq, Together.ai)
- ✅ JSON Mode через `response_format: { type: "json_object" }`
- ✅ Отличное качество следования инструкциям

**Недостатки:**
- ❌ Нет нативной JSON Schema (только JSON object)
- ❌ Требуются посредники для бесплатного доступа

#### 1.2.3. Anthropic Claude 3.5 Haiku (Альтернатива #2)

**Преимущества:**
- ✅ Бесплатный tier через некоторые платформы
- ✅ Высокое качество генерации

**Недостатки:**
- ❌ Нет нативной JSON Schema (только через prompt engineering)
- ❌ Более медленный, чем Gemini Flash

#### 1.2.4. Локальные модели (Ollama, LM Studio)

**Преимущества:**
- ✅ Полностью бесплатно
- ✅ Нет лимитов на запросы
- ✅ Приватность данных

**Недостатки:**
- ❌ Требует локальной установки
- ❌ Меньше токенов контекста
- ❌ Медленнее облачных решений
- ❌ Меньше качество JSON генерации

### 1.3. Рекомендация

**Выбор: Google Gemini 2.5 Flash** с возможностью fallback на локальную модель (Ollama) для офлайн режима.

**Обоснование:**
1. Нативная поддержка JSON Schema — ключевое преимущество
2. Большие лимиты токенов (1M input, 64K output) — идеально для передачи полного реестра тайлов в промпт
3. Высокая скорость генерации
4. Можно добавить поддержку локальной модели позже
5. Достаточные лимиты для генерации больших карт с детальным реестром тайлов

---

## 2. Семантическая интерпретация 3D-ассетов

### 2.1. Проблема

LLM не могут напрямую анализировать бинарные данные (OBJ, MTL, PNG). Необходимо преобразовать 3D-ассеты в текстовые дескрипторы ("геометрические токены"), которые модель может интерпретировать.

### 2.2. Методы обработки

#### 2.2.1. Извлечение метаданных из OBJ файлов

**Парсинг геометрии:**
- Количество вершин (`v`)
- Количество граней (`f`)
- Bounding Box (min/max координаты)
- Высотные характеристики (Y координаты)
- Сложность модели (vertex count → complexity score)

**Скрипт для анализа:**
```typescript
interface OBJMetadata {
  vertexCount: number
  faceCount: number
  boundingBox: { min: [number, number, number], max: [number, number, number] }
  heightRange: number
  complexity: 'low' | 'medium' | 'high'
}
```

#### 2.2.2. Анализ MTL файлов

**Извлечение информации:**
- Материалы (Ka, Kd, Ks — цвета)
- Пути к текстурам (map_Kd)
- Параметры освещения
- Тип поверхности (roughness, metalness через эвристики)

**Информация для LLM:**
```typescript
interface MTLMetadata {
  baseColor: string // RGB hex
  hasTexture: boolean
  texturePath?: string
  materialType: 'stone' | 'grass' | 'water' | 'wood' | 'metal' | 'unknown'
}
```

#### 2.2.3. Семантический анализ текстур PNG (опционально)

**Методы:**
1. **Vision Language Model (VLM)**: Gemini Vision для анализа изображений
2. **Цветовая палитра**: Доминирующие цвета → биом
3. **Название файла**: Эвристический парсинг (`forest_hex_01` → forest biome)

**Рекомендация для MVP**: Использовать название файла и путь к файлу для семантической интерпретации. VLM анализ — для будущих улучшений.

### 2.3. Автоматизация разметки

**Создать утилиту:** `lib/llm/AssetAnalyzer.ts`

**Функциональность:**
1. Сканирование папки `assets/terrain/`
2. Для каждого OBJ файла:
   - Парсинг геометрии
   - Парсинг соответствующего MTL файла
   - Извлечение семантических тегов из пути/имени
3. Генерация JSON реестра тайлов

---

## 3. Создание реестра тайлов (Tile Database)

### 3.1. Структура записи тайла

**Формат JSON для одного тайла:**

```typescript
interface TileDescriptor {
  // Идентификация
  tile_id: string                    // Уникальный ID: "tiles_base_hex_grass"
  name: string                       // Человекочитаемое имя: "Grass Hex"

  // Пути к файлам
  obj_path: string                   // "/assets/terrain/tiles/base/hex_grass.obj"
  mtl_path: string                   // "/assets/terrain/tiles/base/hex_grass.mtl"
  texture_path?: string              // "/assets/terrain/tiles/base/hexagons_medieval.png"

  // Геометрические свойства
  base_height: number                // 0-4 (уровень высоты по умолчанию)
  can_rotate: boolean                // true (все тайлы можно вращать)
  rotation_steps: number[]           // [0, 60, 120, 180, 240, 300] (углы вращения)

  // Семантика
  biome: string                      // "plains" | "forest" | "mountain" | "water" | "coast"
  category: string                   // "tiles" | "buildings" | "decoration"
  subcategory?: string               // "base" | "coast" | "rivers" | "roads" | "nature" | "props"

  // Игровые свойства
  tags: string[]                     // ["walkable", "cover", "resource_lumber"]
  walkable: boolean                  // true/false
  passable?: boolean                 // true для воды (корабли), false для суши
  height_modifier?: number           // +1, -1 для склонов

  // Визуальные характеристики
  visual_style: string               // "fantasy_medieval" | "realistic"
  color_palette?: string[]           // ["#90EE90", "#228B22"] (доминирующие цвета)

  // Связность (для дорог, рек, побережья)
  exits?: {                          // Направления выхода (для roads/rivers)
    north?: boolean
    northeast?: boolean
    southeast?: boolean
    south?: boolean
    southwest?: boolean
    northwest?: boolean
  }

  // Метаданные для генерации
  rarity?: number                    // 0.0-1.0 (вероятность появления)
  preferred_neighbors?: string[]     // ["tiles_base_hex_grass", "tiles_roads_*"]
  incompatible_neighbors?: string[]  // ["tiles_base_hex_water"]
}
```

### 3.2. Примеры записей

**Базовый тайл травы:**
```json
{
  "tile_id": "tiles_base_hex_grass",
  "name": "Grass Hex",
  "obj_path": "/assets/terrain/tiles/base/hex_grass.obj",
  "mtl_path": "/assets/terrain/tiles/base/hex_grass.mtl",
  "base_height": 0,
  "can_rotate": true,
  "rotation_steps": [0, 60, 120, 180, 240, 300],
  "biome": "plains",
  "category": "tiles",
  "subcategory": "base",
  "tags": ["walkable", "terrain_base"],
  "walkable": true,
  "visual_style": "fantasy_medieval"
}
```

**Тайл дороги (с выходами):**
```json
{
  "tile_id": "tiles_roads_road_straight_ns",
  "name": "Road Straight North-South",
  "obj_path": "/assets/terrain/tiles/roads/road_straight_ns.obj",
  "mtl_path": "/assets/terrain/tiles/roads/road_straight_ns.mtl",
  "base_height": 0,
  "can_rotate": true,
  "rotation_steps": [0, 60, 120, 180, 240, 300],
  "biome": "plains",
  "category": "tiles",
  "subcategory": "roads",
  "tags": ["walkable", "road", "movement_bonus"],
  "walkable": true,
  "exits": {
    "north": true,
    "south": true,
    "northeast": false,
    "southeast": false,
    "southwest": false,
    "northwest": false
  },
  "preferred_neighbors": ["tiles_roads_*"],
  "visual_style": "fantasy_medieval"
}
```

**Здание:**
```json
{
  "tile_id": "buildings_neutral_building_castle",
  "name": "Castle",
  "obj_path": "/assets/terrain/buildings/neutral/building_castle.obj",
  "mtl_path": "/assets/terrain/buildings/neutral/building_castle.mtl",
  "base_height": 1,
  "can_rotate": true,
  "rotation_steps": [0, 60, 120, 180, 240, 300],
  "biome": "plains",
  "category": "buildings",
  "tags": ["structure", "defense", "landmark"],
  "walkable": false,
  "visual_style": "fantasy_medieval",
  "rarity": 0.1
}
```

### 3.3. Генерация реестра

**Создать скрипт:** `scripts/generate-tile-registry.ts`

**Процесс:**
1. Сканирует `assets/terrain/`
2. Для каждого `.obj` файла:
   - Парсит метаданные (OBJ + MTL)
   - Извлекает семантику из пути/имени
   - Генерирует `tile_id` по паттерну: `{category}_{subcategory}_{filename}`
   - Определяет биом по категории/подкатегории
   - Определяет игровые свойства по тегам
3. Сохраняет в `lib/llm/tile-registry.json`

**Результат:** Единый JSON файл со всеми доступными тайлами (~200-300 записей)

---

## 4. Архитектура системы генерации

### 4.1. Иерархический синтез контента

Для генерации больших карт (50x50+) рекомендуется многоуровневый подход:

#### Уровень 1: Генерация схемы биомов (Biome Layout)

**Цель:** Определить макро-регионы карты в низком разрешении (кластеры 4x4 или 8x8 гексов)

**Входные данные:**
- Размер карты (width, height)
- Тема карты ("fantasy_war", "peaceful_kingdom", "mountain_realm")
- Процент покрытия биомами (например: 40% plains, 30% forest, 20% mountains, 10% water)

**Выходные данные:**
```typescript
interface BiomeCluster {
  cluster_q: number        // Координаты кластера (в масштабе кластеров)
  cluster_r: number
  biome: string            // "plains" | "forest" | "mountain" | "water"
  intensity: number        // 0.0-1.0 (насколько "чистый" биом)
}
```

#### Уровень 2: Генерация ландшафтного графа (Height Graph)

**Цель:** Расставить уровни высоты внутри каждого кластера, создавая естественные перепады

**Входные данные:**
- Схема биомов (уровень 1)
- Правила высот для каждого биома (горы выше равнин)

**Выходные данные:**
```typescript
interface HeightMap {
  q: number
  r: number
  base_height: number      // 0-4
  height_variation: number // ±1 для склонов
}
```

#### Уровень 3: Финальная расстановка тайлов (Tile Placement)

**Цель:** Подобрать конкретные tile_id из реестра для каждой позиции

**Входные данные:**
- Схема биомов
- Ландшафтный граф
- Реестр тайлов

**Выходные данные:**
```typescript
interface GeneratedHex {
  q: number
  r: number
  tile_id: string
  rotation: number         // 0, 60, 120, 180, 240, 300
  height: number           // 0-4
}
```

### 4.2. Архитектурная диаграмма

```
┌─────────────────────────────────────────────────────────┐
│                    MapEditor Component                   │
│                  (React UI Component)                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              LLM Map Generator Service                   │
│              (lib/llm/MapGenerator.ts)                  │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐  │
│  │  Phase 1: Biome Layout Generator                  │  │
│  │  - Input: map size, theme, biome distribution     │  │
│  │  - Output: BiomeCluster[]                         │  │
│  └───────────────────────────────────────────────────┘  │
│                         │                                 │
│                         ▼                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Phase 2: Height Graph Generator                  │  │
│  │  - Input: BiomeCluster[], height rules            │  │
│  │  - Output: HeightMap[]                            │  │
│  └───────────────────────────────────────────────────┘  │
│                         │                                 │
│                         ▼                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Phase 3: Tile Placement Generator                │  │
│  │  - Input: BiomeCluster[], HeightMap[], registry   │  │
│  │  - Output: GeneratedHex[]                         │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              LLM API Client                              │
│              (lib/llm/LLMClient.ts)                     │
│  - Gemini 2.0 Flash (primary)                           │
│  - Ollama (fallback for offline)                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Tile Registry                               │
│              (lib/llm/tile-registry.json)               │
│  - ~200-300 tile descriptors                            │
│  - Generated by AssetAnalyzer                           │
└─────────────────────────────────────────────────────────┘
```

### 4.3. Реализация сервиса

**Создать:** `lib/llm/MapGenerator.ts`

**Основные методы:**
```typescript
class MapGenerator {
  // Генерация полной карты (все 3 фазы)
  async generateMap(params: GenerateMapParams): Promise<GeneratedHex[]>

  // Фаза 1: Схема биомов
  private async generateBiomeLayout(params: BiomeLayoutParams): Promise<BiomeCluster[]>

  // Фаза 2: Ландшафтный граф
  private async generateHeightGraph(params: HeightGraphParams): Promise<HeightMap[]>

  // Фаза 3: Расстановка тайлов
  private async generateTilePlacement(params: TilePlacementParams): Promise<GeneratedHex[]>
}
```

---

## 5. Промпт-инжиниринг и JSON Schema

### 5.1. Системный промпт для генерации карты

**Структура промпта:**

```typescript
const SYSTEM_PROMPT = `You are an expert game designer specializing in creating hex-based tactical maps for turn-based strategy games.

Your task is to generate a hex map layout based on the provided parameters.

MAP COORDINATES SYSTEM:
- This map uses AXIAL coordinates (q, r)
- q ranges from 0 to ${width - 1}
- r ranges from 0 to ${height - 1}
- Distance formula: distance(a, b) = (|a.q - b.q| + |a.q + a.r - b.q - b.r| + |a.r - b.r|) / 2
- Each hex has 6 neighbors

HEIGHT SYSTEM:
- Height levels: 0 (lowest) to 4 (highest)
- Adjacent hexes should not differ by more than 1 height level (realistic slopes)
- Mountains (height 3-4) should cluster together
- Water is always height 0

TILE PLACEMENT RULES:
1. Match biome to tile_id (use tiles with matching biome property)
2. Ensure walkable paths between important areas
3. Roads/rivers should form connected networks (use exits property)
4. Buildings should be placed on flat terrain (height 0-1)
5. Rotation should align tile exits with neighboring tiles

OUTPUT FORMAT:
You must output a JSON array of hex objects with the following structure:
- q: number (axial coordinate)
- r: number (axial coordinate)
- tile_id: string (must match a tile_id from the provided registry)
- rotation: number (0, 60, 120, 180, 240, or 300 degrees)
- height: number (0-4)

CONSTRAINTS:
- Theme: ${theme}
- Map size: ${width}x${height}
- Biome distribution: ${JSON.stringify(biomeDistribution)}
- Maximum slope: 1 (adjacent hexes can differ by at most 1 height level)

TILE REGISTRY:
${JSON.stringify(tileRegistry, null, 2)}

Generate a realistic and playable map that fits the theme.`;
```

### 5.2. JSON Schema для валидации

**Schema для генерации карты:**

```typescript
const MAP_GENERATION_SCHEMA = {
  type: "object",
  properties: {
    hexes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          q: { type: "integer", minimum: 0 },
          r: { type: "integer", minimum: 0 },
          tile_id: { type: "string" },
          rotation: {
            type: "integer",
            minimum: 0,
            maximum: 300
            // Note: Valid values are 0, 60, 120, 180, 240, 300 (specify in prompt, not enum)
          },
          height: {
            type: "integer",
            minimum: 0,
            maximum: 4
          }
        },
        required: ["q", "r", "tile_id", "rotation", "height"]
      }
    }
  },
  required: ["hexes"]
};
```

**Важно:** Gemini API не поддерживает поле `additionalProperties` в `responseSchema`, поэтому его нужно исключить из схемы.

### 5.3. Оптимизация промпта

**Стратегии для уменьшения токенов:**

1. **Компактный реестр тайлов:**
   - Удалить дублирующиеся поля
   - Группировать тайлы по категориям
   - Передавать только релевантные тайлы для текущего биома

2. **Частичная генерация:**
   - Генерировать карту по частям (chunks 10x10)
   - Использовать контекст соседних chunks для связности

3. **Кэширование:**
   - Кэшировать промпты для похожих запросов
   - Использовать меньшие модели для простых задач

---

## 6. Логика биомов и реалистичность

### 6.1. Правила распределения биомов

**Базовые правила:**

1. **Водные биомы:**
   - Формируют связные области (озера, реки, побережья)
   - Реки текут с гор к низменностям (по градиенту высоты)
   - Побережья обрамляют водные области

2. **Горные биомы:**
   - Кластеризуются (не изолированные гексы)
   - Имеют высоту 2-4
   - Окружены предгорьями (переходные зоны)

3. **Лесные биомы:**
   - Формируют крупные массивы
   - Могут граничить с равнинами и горами
   - Предпочитают средние высоты (0-2)

4. **Равнинные биомы:**
   - Самый распространенный биом
   - Высота 0-1
   - Подходят для дорог и поселений

### 6.2. Промпт для реалистичности

**Добавить в системный промпт:**

```
BIOME REALISM RULES:

1. WATER BIOMES:
   - Rivers flow from high (mountains) to low (plains/coast)
   - Rivers connect to form networks
   - Lakes are circular/oval shaped
   - Coast tiles border water areas

2. MOUNTAIN BIOMES:
   - Cluster in groups of 5+ hexes
   - Gradually transition to plains (use height 1-2 for foothills)
   - Peaks are height 3-4
   - Rarely isolated single hexes

3. FOREST BIOMES:
   - Form large continuous areas (10+ hexes)
   - Can border plains or mountains
   - Avoid placing directly next to water (use coast transition)

4. PLAINS BIOMES:
   - Most common biome type
   - Flat terrain (height 0-1)
   - Good for roads and settlements
   - Can transition to any other biome

5. TRANSITIONS:
   - Biomes should blend gradually (don't create hard borders)
   - Use intermediate tiles (coast, foothills) for transitions
   - Avoid checkerboard patterns
```

### 6.3. Валидация реалистичности

**Постобработка сгенерированной карты:**

```typescript
class RealismValidator {
  // Проверка связности биомов
  validateBiomeConnectivity(hexes: GeneratedHex[]): boolean

  // Проверка градиентов высоты
  validateHeightGradients(hexes: GeneratedHex[]): boolean

  // Проверка связности дорог/рек
  validatePathConnectivity(hexes: GeneratedHex[]): boolean

  // Исправление нарушений
  fixViolations(hexes: GeneratedHex[]): GeneratedHex[]
}
```

---

## 7. Детальный план реализации

### Фаза 1: Подготовка инфраструктуры (1-2 дня)

#### Задача 1.1: Создание Asset Analyzer
- [ ] Создать `lib/llm/AssetAnalyzer.ts`
- [ ] Реализовать парсинг OBJ файлов (извлечение метаданных)
- [ ] Реализовать парсинг MTL файлов (материалы, текстуры)
- [ ] Реализовать извлечение семантики из путей/имен файлов
- [ ] Создать функцию генерации `tile_id` по паттерну
- [ ] Тесты для AssetAnalyzer

#### Задача 1.2: Генерация Tile Registry
- [ ] Создать скрипт `scripts/generate-tile-registry.ts`
- [ ] Интегрировать AssetAnalyzer в скрипт
- [ ] Реализовать сканирование `assets/terrain/`
- [ ] Генерация JSON реестра
- [ ] Сохранение в `lib/llm/tile-registry.json`
- [ ] Валидация реестра (проверка уникальности tile_id)

#### Задача 1.3: Настройка LLM API клиента
- [ ] Создать `lib/llm/LLMClient.ts`
- [ ] Реализовать интеграцию с Gemini 2.0 Flash API
- [ ] Добавить поддержку JSON Schema через `responseSchema`
- [ ] Реализовать обработку ошибок и retry логику
- [ ] Добавить rate limiting для бесплатного tier
- [ ] Опционально: добавить поддержку Ollama (локальный fallback)

**Результат:** Готовая инфраструктура для работы с LLM и реестр всех тайлов

---

### Фаза 2: Базовая генерация карт (2-3 дня)

#### Задача 2.1: Создание Map Generator сервиса
- [ ] Создать `lib/llm/MapGenerator.ts`
- [ ] Реализовать базовый метод `generateMap()`
- [ ] Интеграция с LLMClient
- [ ] Загрузка tile registry
- [ ] Формирование промпта для генерации

#### Задача 2.2: JSON Schema и валидация
- [ ] Определить JSON Schema для выходных данных
- [ ] Интегрировать Schema в Gemini API запрос
- [ ] Реализовать валидацию ответа LLM
- [ ] Обработка ошибок парсинга

#### Задача 2.3: Простая генерация (без иерархии)
- [ ] Реализовать простую генерацию всей карты одним запросом
- [ ] Базовая логика размещения тайлов
- [ ] Интеграция с Map классом (конвертация GeneratedHex → Hex)
- [ ] Тесты для MapGenerator

**Результат:** Рабочая генерация карт через LLM (простая версия)

---

### Фаза 3: Иерархическая генерация (3-4 дня)

#### Задача 3.1: Генерация схемы биомов
- [ ] Реализовать `generateBiomeLayout()`
- [ ] Промпт для генерации макро-регионов
- [ ] Конвертация в кластеры 4x4 или 8x8
- [ ] Валидация распределения биомов

#### Задача 3.2: Генерация ландшафтного графа
- [ ] Реализовать `generateHeightGraph()`
- [ ] Правила высот для каждого биома
- [ ] Проверка градиентов (макс. разница 1 между соседями)
- [ ] Генерация высот для всех позиций

#### Задача 3.3: Финальная расстановка тайлов
- [ ] Реализовать `generateTilePlacement()`
- [ ] Фильтрация tile registry по биому
- [ ] Выбор конкретных tile_id
- [ ] Определение rotation для связности (дороги, реки)
- [ ] Интеграция всех 3 фаз в единый пайплайн

**Результат:** Иерархическая генерация с реалистичными биомами

---

### Фаза 4: Логика биомов и реалистичность (2-3 дня)

#### Задача 4.1: Правила распределения биомов
- [ ] Реализовать правила для водных биомов (связность, течение)
- [ ] Реализовать правила для горных биомов (кластеризация)
- [ ] Реализовать правила для лесных биомов (массивы)
- [ ] Реализовать правила для равнинных биомов
- [ ] Обновить промпты с правилами реалистичности

#### Задача 4.2: Валидатор реалистичности
- [ ] Создать `lib/llm/RealismValidator.ts`
- [ ] Проверка связности биомов
- [ ] Проверка градиентов высоты
- [ ] Проверка связности путей (дороги, реки)
- [ ] Автоматическое исправление нарушений

#### Задача 4.3: Постобработка
- [ ] Интеграция валидатора в пайплайн генерации
- [ ] Автоматическое исправление нарушений
- [ ] Логирование предупреждений

**Результат:** Реалистичные карты с правильной логикой биомов

---

### Фаза 5: Интеграция в UI (2-3 дня)

#### Задача 5.1: UI для генерации карт
- [ ] Создать диалог генерации карты в MapEditor
- [ ] Поля для параметров:
  - Размер карты (width, height)
  - Тема карты (select/dropdown)
  - Распределение биомов (sliders для каждого биома)
  - Использовать иерархическую генерацию (checkbox)
- [ ] Кнопка "Generate Map"
- [ ] Индикатор загрузки (LLM может работать 5-10 секунд)

#### Задача 5.2: Интеграция с редактором
- [ ] Вызов MapGenerator из UI
- [ ] Конвертация GeneratedHex[] → Map (через MapSerializer)
- [ ] Очистка текущей карты перед генерацией
- [ ] Загрузка сгенерированной карты в редактор
- [ ] Обработка ошибок (показ toast уведомлений)

#### Задача 5.3: Предпросмотр и настройки
- [ ] Предпросмотр параметров перед генерацией
- [ ] Возможность сохранить шаблоны параметров
- [ ] История сгенерированных карт (опционально)

**Результат:** Полная интеграция генерации в UI редактора

---

### Фаза 6: Оптимизация и улучшения (2-3 дня)

#### Задача 6.1: Оптимизация промптов
- [ ] Уменьшение размера промпта (компактный реестр)
- [ ] Частичная генерация (chunks) для больших карт
- [ ] Кэширование промптов

#### Задача 6.2: Обработка ошибок
- [ ] Retry логика для API запросов
- [ ] Fallback на простую генерацию при ошибках
- [ ] Детальное логирование ошибок

#### Задача 6.3: Производительность
- [ ] Асинхронная генерация (не блокирует UI)
- [ ] Прогресс-бар для многофазовой генерации
- [ ] Отмена генерации (если пользователь передумал)

**Результат:** Оптимизированная и стабильная система генерации

---

### Фаза 7: Тестирование и документация (1-2 дня)

#### Задача 7.1: Тестирование
- [ ] Unit-тесты для всех компонентов
- [ ] Интеграционные тесты (генерация тестовой карты)
- [ ] Тесты валидации реалистичности
- [ ] Тесты обработки ошибок

#### Задача 7.2: Документация
- [ ] Обновить `docs/llm-integration-plan.md` с результатами
- [ ] Создать руководство пользователя (как генерировать карты)
- [ ] Документация API для MapGenerator
- [ ] Примеры использования

**Результат:** Протестированная и задокументированная система

---

## Итоговая оценка времени

**Общее время реализации: 13-20 дней** (2.5-4 недели при работе 5-6 часов в день)

**Приоритизация для MVP:**

**Минимальный MVP (7-10 дней):**
- Фаза 1: Инфраструктура
- Фаза 2: Базовая генерация
- Фаза 5: Базовая UI интеграция

**Полная версия (13-20 дней):**
- Все фазы включая иерархическую генерацию и реалистичность

---

## Риски и митигация

### Риск 1: Лимиты бесплатного API
**Митигация:**
- Использовать кэширование
- Реализовать fallback на локальную модель (Ollama)
- Оптимизировать промпты для уменьшения токенов

### Риск 2: Низкое качество генерации
**Митигация:**
- Тщательный промпт-инжиниринг
- JSON Schema для гарантии формата
- Валидация и постобработка

### Риск 3: Медленная генерация
**Митигация:**
- Асинхронная генерация (не блокирует UI)
- Прогресс-бар для пользователя
- Возможность отмены

### Риск 4: Галлюцинации (несуществующие tile_id)
**Митигация:**
- JSON Schema с enum значений (если возможно)
- Валидация tile_id против registry
- Fallback на ближайший валидный тайл при ошибке

---

## Следующие шаги

1. **Начать с Фазы 1:** Создать AssetAnalyzer и сгенерировать tile registry
2. **Протестировать LLM API:** Проверить Gemini 2.0 Flash с тестовым промптом
3. **Создать простой прототип:** Генерация маленькой карты (5x5) для проверки концепции
4. **Итеративно улучшать:** Добавлять функции по фазам

