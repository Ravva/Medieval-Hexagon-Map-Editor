# Технический Контекст

## Языки программирования

- **JavaScript (ES6+)**: Основной язык для игровой логики
- **TypeScript**: Для нового редактора карт (editor-nextjs)
- **HTML5/CSS3**: Структура и стили

## Основные зависимости

### Основной проект (Vanilla JS)
```json
{
  "three": "^0.182.0"  // Three.js для 3D рендеринга
}
```

### Редактор карт (Next.js)
```json
{
  "next": "16.1.1",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "three": "^0.182.0",
  "@radix-ui/react-*": "Компоненты UI",
  "class-variance-authority": "^0.7.1",  // Для вариантов компонентов
  "lucide-react": "Иконки",
  "@biomejs/biome": "^2.3.10"  // Линтер
}
```

## Фреймворки и библиотеки

### Основной проект
- **Three.js** (v0.182.0): 3D рендеринг игровой карты
- **Vanilla JavaScript**: Без фреймворков для игровой логики
- **Canvas API**: 2D рендеринг (альтернативный режим)
- **Jest**: Тестирование

### Редактор карт
- **Next.js 16.1.1**: React фреймворк (App Router)
- **React 19.2.3**: UI библиотека
- **Turbopack**: Bundler для dev сборки (в 10-700 раз быстрее webpack)
- **Shadcn/ui**: Компоненты интерфейса (Maia style, Cyan theme)
  - **class-variance-authority**: Для вариантов компонентов (Button, Badge)
  - **lucide-react**: Иконки для UI компонентов
  - **@radix-ui/react-***: Базовые примитивы (Dialog, Select, Slot)
- **Tailwind CSS**: Утилитарная стилизация
- **Biome**: Линтер и форматер (быстрее ESLint+Prettier)
- **Bun**: Пакетный менеджер (быстрее npm)

## Загрузчики моделей

- **OBJLoader**: Загрузка .obj файлов
- **MTLLoader**: Загрузка материалов .mtl
- **TextureLoader**: Загрузка текстур .png

## Структура assets

```
assets/
└── terrain/
    ├── tiles/           # Тайлы местности (base, coast, rivers, roads)
    ├── buildings/       # Здания (neutral, blue, green, red, yellow)
    └── decoration/      # Декорации (nature, props)
```

## Локальное окружение

- **Разработка**: 
  - Python HTTP Server (порт 8000) для основного проекта
  - Next.js dev server с Turbopack (порт 3000) - команда `bun dev`
  - Next.js dev server с webpack (порт 3000) - команда `bun dev:webpack` (fallback)
- **Тестирование**: Jest с jsdom окружением
- **Форматирование**: Biome для редактора, ручное для основного проекта

## Особенности

1. **ES Modules**: Проект использует `"type": "module"` в package.json
2. **Динамические импорты**: Three.js загрузчики работают асинхронно
3. **LocalStorage**: Сохранения хранятся в браузере
4. **CORS**: Нужен локальный сервер для загрузки assets (нельзя просто открыть index.html)

## Версии Node.js/Bun

- **Node.js**: 18+ (для основного проекта)
- **Bun**: Последняя версия (для editor-nextjs)

## Shadcn/ui Интеграция

### Для Vanilla JS проекта

**Файлы**:
- `styles/shadcn-theme.css` - CSS переменные и тема (Maia, Cyan, Large radius, Public Sans)
- `styles/shadcn-components.css` - Стили компонентов (Button, Card, Dialog, Input, Badge, Alert)
- `js/ui/shadcn.js` - JavaScript классы компонентов

**Использование**:
- Использование через CSS классы напрямую в HTML
- Или через JavaScript API из `js/ui/shadcn.js`
- Темная тема: класс `dark` на `<html>`

**Шаблон**: https://ui.shadcn.com/create?base=radix&style=maia&baseColor=neutral&theme=cyan&iconLibrary=phosphor&font=public-sans&menuAccent=subtle&menuColor=default&radius=large

### Для Next.js проекта

**Нативная интеграция**:
- Shadcn/ui компоненты через React
- Настроена тема Maia с Cyan акцентами
- Компоненты: Button, Card, Input, Select, Dialog, Badge
- Расположение: `editor-nextjs/components/ui/`

## Анализ Миграции на React/Next.js

### Принятое решение: Гибридный подход

**Архитектура**:
- Основной проект остается на Vanilla JS
- Редактор карт мигрирует на Next.js 16 + React 19
- Игровая логика остается в vanilla JS классах
- TypeScript версии общих классов в `editor-nextjs/lib/game/`

**Преимущества гибридного подхода**:
- ✅ UI в React (Shadcn работает нативно)
- ✅ Игровая логика остается простой и производительной
- ✅ Минимальный рефакторинг core логики
- ✅ Canvas не конфликтует с React

**Почему не полная миграция**:
- Высокий риск рефакторинга 27+ core файлов
- Canvas/Three.js не требует React
- Bundle size увеличится на +50-100KB
- Игровая логика стабильна и работает

## Запрещенные технологии

- ❌ Серверные фреймворки (Express, FastAPI и т.д.)
- ❌ Базы данных (только LocalStorage)
- ❌ Облачные сервисы
- ❌ npm/yarn для editor-nextjs (используется Bun)

