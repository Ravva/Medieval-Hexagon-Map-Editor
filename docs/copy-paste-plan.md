# План реализации: Копирование и вставка тайлов с учетом глобального уровня

**Статус:** ✅ РЕАЛИЗОВАНО

## Обзор
Реализация функциональности копирования (Ctrl+C) и вставки (Ctrl+V) тайлов с учетом глобального уровня высоты (`currentHeightLevel`).

## Архитектура решения

### 1. Структура данных для буфера обмена

```typescript
interface ClipboardData {
  hex: {
    q: number
    r: number
    terrain: TerrainType
    height: number  // Абсолютная высота скопированного тайла
    rotation?: number
    modelData?: ModelData
    hasRiver?: boolean
  }
  sourceHeight: number  // Высота, с которой был скопирован тайл
  globalLevel: number   // Глобальный уровень на момент копирования
}
```

### 2. Логика копирования (Ctrl+C)

**Триггер**: Пользователь нажимает Ctrl+C при выбранном тайле (`selectedHex`)

**Алгоритм**:
1. Проверить наличие `selectedHex`
2. Получить тайл на текущем глобальном уровне (`currentHeightLevel`) из позиции `selectedHex`
3. Если тайла на текущем глобальном уровне нет:
   - Вариант А: Скопировать верхний тайл из стека
   - Вариант Б: Показать уведомление "Нет тайла на текущем уровне"
4. Если тайл найден:
   - Создать объект `ClipboardData` с данными тайла
   - Сохранить в `localStorage` (для персистентности между сессиями)
   - Сохранить в состояние React (`useState` или `useRef`)
   - Опционально: скопировать в системный буфер обмена (для совместимости)

**Код**:
```typescript
const copyHex = () => {
  if (!selectedHex || !mapRef.current) return false

  // Получаем тайл на текущем глобальном уровне
  const hex = mapRef.current.getHex(selectedHex.q, selectedHex.r, currentHeightLevel)

  if (!hex) {
    // Вариант: копируем верхний тайл
    const topHex = mapRef.current.getHex(selectedHex.q, selectedHex.r)
    if (!topHex) {
      showNotification('warning', 'Нет тайла для копирования')
      return false
    }
    // Используем верхний тайл, но сохраняем информацию об уровне
  }

  const clipboardData: ClipboardData = {
    hex: {
      q: hex.q,
      r: hex.r,
      terrain: hex.terrain,
      height: hex.height,
      rotation: hex.rotation,
      modelData: hex.modelData,
      hasRiver: hex.hasRiver,
    },
    sourceHeight: hex.height,
    globalLevel: currentHeightLevel,
  }

  // Сохраняем в localStorage
  localStorage.setItem('mapEditor_clipboard', JSON.stringify(clipboardData))

  // Сохраняем в состояние
  setClipboardData(clipboardData)

  showNotification('success', 'Тайл скопирован')
  return true
}
```

### 3. Логика вставки (Ctrl+V)

**Триггер**: Пользователь нажимает Ctrl+V при выбранном тайле (`selectedHex`)

**Алгоритм**:
1. Проверить наличие данных в буфере обмена
2. Проверить наличие `selectedHex` (куда вставлять)
3. Вычислить целевую высоту:
   - Если вставляем на текущий глобальный уровень:
     - Проверить, свободен ли этот уровень
     - Если занят, найти следующий свободный уровень выше текущего глобального
   - Если вставляем с сохранением относительной высоты:
     - Вычислить разницу между исходной высотой и глобальным уровнем при копировании
     - Применить эту разницу к текущему глобальному уровню
4. Создать новый Hex с данными из буфера обмена
5. Установить тайл на карту через `mapRef.current.setHex()`
6. Обновить визуализацию через `updateHexMesh()`
7. Обновить выделение

**Код**:
```typescript
const pasteHex = async () => {
  if (!selectedHex || !mapRef.current) return false

  // Получаем данные из буфера обмена
  const stored = localStorage.getItem('mapEditor_clipboard')
  if (!stored) {
    showNotification('warning', 'Буфер обмена пуст')
    return false
  }

  const clipboardData: ClipboardData = JSON.parse(stored)

  // Создаем новый Hex
  const newHex = new Hex(
    selectedHex.q,
    selectedHex.r,
    clipboardData.hex.terrain
  )

  // Вычисляем целевую высоту с учетом глобального уровня
  const heightOffset = clipboardData.hex.height - clipboardData.globalLevel
  let targetHeight = currentHeightLevel + heightOffset

  // Проверяем, что целевая высота в допустимых пределах
  if (targetHeight < 0) targetHeight = 0
  if (targetHeight > 4) {
    showNotification('error', 'Максимальная высота достигнута')
    return false
  }

  // Проверяем, свободен ли целевой уровень
  if (mapRef.current.hasHex(selectedHex.q, selectedHex.r, targetHeight)) {
    // Ищем следующий свободный уровень выше текущего глобального
    let nextLevel = currentHeightLevel
    while (nextLevel <= 4 && mapRef.current.hasHex(selectedHex.q, selectedHex.r, nextLevel)) {
      nextLevel++
    }
    if (nextLevel > 4) {
      showNotification('error', 'Нет свободных уровней')
      return false
    }
    targetHeight = nextLevel
  }

  // Применяем свойства из скопированного тайла
  newHex.height = targetHeight
  newHex.rotation = clipboardData.hex.rotation || 0
  newHex.modelData = clipboardData.hex.modelData
  newHex.hasRiver = clipboardData.hex.hasRiver || false

  // Устанавливаем тайл на карту
  mapRef.current.setHex(selectedHex.q, selectedHex.r, newHex)

  // Обновляем визуализацию
  await updateHexMesh(selectedHex.q, selectedHex.r, targetHeight)

  // Обновляем выделение для обновления подсветки
  setSelectedHex({ ...selectedHex })

  showNotification('success', 'Тайл вставлен')
  return true
}
```

### 4. Обработка горячих клавиш

**Место**: Существующий `useEffect` с обработкой клавиатуры (около строки 1147)

**Добавить**:
```typescript
// В handleKeyDown функцию
if (e.ctrlKey || e.metaKey) {
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault()
    copyHex()
    return
  }

  if (e.key === 'v' || e.key === 'V') {
    e.preventDefault()
    pasteHex()
    return
  }
}
```

### 5. Состояние компонента

**Добавить**:
```typescript
const [clipboardData, setClipboardData] = useState<ClipboardData | null>(null)
```

Или использовать `useRef` для избежания лишних ререндеров:
```typescript
const clipboardDataRef = useRef<ClipboardData | null>(null)
```

### 6. Обработка зданий (опционально)

Если нужно копировать здания:
1. При копировании проверить наличие здания на позиции и уровне
2. Сохранить данные здания в `ClipboardData`
3. При вставке создать здание через `placeBuilding() или аналогичную функцию

**Расширенная структура**:
```typescript
interface ClipboardData {
  hex: { ... }
  building?: {
    modelData: ModelData
    height?: number
  }
  sourceHeight: number
  globalLevel: number
}
```

## Этапы реализации

### Этап 1: Базовая структура ✅
- [x] Создать интерфейс `ClipboardData`
- [x] Добавить состояние для буфера обмена
- [x] Создать функции `copyHex()` и `pasteHex()`

### Этап 2: Копирование ✅
- [x] Реализовать логику получения верхнего тайла в ячейке
- [x] Реализовать сохранение в localStorage
- [x] Добавить обработку случая отсутствия тайла

### Этап 3: Вставка ✅
- [x] Реализовать вычисление целевой высоты с учетом глобального уровня
- [x] Реализовать проверку свободных уровней
- [x] Реализовать создание и установку нового тайла
- [x] Реализовать обновление визуализации
- [x] Вставка происходит в ячейку под текущей позицией курсора мыши

### Этап 4: Горячие клавиши ✅
- [x] Добавить обработку Ctrl+C в `handleKeyDown`
- [x] Добавить обработку Ctrl+V в `handleKeyDown`
- [x] Протестировать предотвращение стандартного поведения браузера

### Этап 5: Тестирование ✅
- [x] Тест: копирование верхнего тайла в ячейке
- [x] Тест: вставка в позицию курсора мыши
- [x] Тест: копирование при отсутствии тайла
- [x] Тест: вставка при занятом целевом уровне
- [x] Тест: вставка при достижении максимальной высоты

### Этап 6: Улучшения ✅
- [x] Добавить поддержку множественного выделения (Ctrl+ЛКМ)
- [x] Добавить отмену/повтор (undo/redo) для операций копирования/вставки (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)

## Статус: ✅ РЕАЛИЗОВАНО

**Дата реализации:** 2024

**Особенности реализации:**
- Копируется всегда верхний тайл в ячейке (независимо от глобального уровня)
- Вставка происходит в ячейку под текущей позицией курсора мыши
- Отслеживание позиции курсора через `lastMouseHexRef`
- Сохранение относительной высоты при вставке с учетом глобального уровня

## Важные моменты

1. **Глобальный уровень**: При вставке нужно учитывать текущий `currentHeightLevel` и вычислять целевую высоту относительно него
2. **Относительная высота**: Сохранять разницу между высотой тайла и глобальным уровнем при копировании, чтобы при вставке сохранить относительное положение
3. **Конфликты уровней**: Если целевой уровень занят, искать следующий свободный уровень выше текущего глобального
4. **Валидация**: Проверять границы карты и допустимые значения высоты (0-4)
5. **Персистентность**: Использовать localStorage для сохранения буфера обмена между сессиями

## Примеры использования

### Пример 1: Простое копирование-вставка
1. Выбрать тайл на позиции (5, 3) на уровне 0
2. Установить глобальный уровень на 1
3. Нажать Ctrl+C (копирует тайл с уровня 0)
4. Выбрать позицию (10, 7)
5. Нажать Ctrl+V (вставит тайл на уровень 1, сохраняя относительную высоту)

### Пример 2: Копирование с другого уровня
1. Выбрать тайл на позиции (5, 3) на уровне 2
2. Установить глобальный уровень на 2
3. Нажать Ctrl+C (копирует тайл с уровня 2)
4. Выбрать позицию (10, 7)
5. Установить глобальный уровень на 0
6. Нажать Ctrl+V (вставит тайл на уровень 0, так как разница была 0)

