# Технический Контекст

## Языки программирования

- **TypeScript**: Основной язык для всего проекта
- **HTML5/CSS3**: Структура и стили

## Основные зависимости

```json
{
  "next": "16.1.1",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "three": "^0.182.0",
  "@radix-ui/react-dialog": "^1.2.2",
  "@radix-ui/react-popover": "^1.2.1",
  "@radix-ui/react-select": "^2.2.2",
  "@radix-ui/react-separator": "^1.1.0",
  "@radix-ui/react-slot": "^1.1.0",
  "@radix-ui/react-tabs": "^1.1.1",
  "@radix-ui/react-tooltip": "^1.2.2",
  "class-variance-authority": "^0.7.1",
  "lucide-react": "^0.468.0",
  "@phosphor-icons/react": "^2.1.30",
  "@biomejs/biome": "^2.3.10",
  "tailwindcss": "^3.4.17",
  "vitest": "^2.1.8"
}
```

## Фреймворки и библиотеки

- **Next.js 16.1.1**: React фреймворк с App Router
- **React 19.2.3**: UI библиотека
- **Turbopack**: Bundler для dev сборки (в 10-700 раз быстрее webpack)
- **Three.js** (v0.182.0): 3D рендеринг карты
- **Shadcn/ui**: Компоненты интерфейса (Maia style, Cyan theme)
  - **class-variance-authority**: Для вариантов компонентов (Button, Badge)
  - **lucide-react**: Иконки для UI компонентов
  - **@phosphor-icons/react**: Дополнительные иконки
  - **@radix-ui/react-***: Базовые примитивы (Dialog, Select, Slot, Tabs, Tooltip, Popover, Separator)
- **Tailwind CSS**: Утилитарная стилизация
- **Biome**: Линтер и форматер (быстрее ESLint+Prettier)
- **Bun**: Пакетный менеджер (быстрее npm)
- **Vitest**: Тестирование

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
  - Next.js dev server с Turbopack (порт 3000) - команда `bun dev`
  - Next.js dev server с webpack (порт 3000) - команда `bun dev:webpack` (fallback)
- **Тестирование**: Vitest с jsdom окружением
- **Форматирование**: Biome
- **Сборка**: Next.js build с production оптимизациями

## Особенности

1. **ES Modules**: Проект использует современный синтаксис ES модулей
2. **Динамические импорты**: Three.js загрузчики работают асинхронно
3. **LocalStorage**: Сохранения карт хранятся в браузере
4. **Server Components**: Использование React Server Components где применимо
5. **TypeScript**: Строгая типизация для всех компонентов
6. **Осевые координаты**: Использование (q, r) координат для LLM-совместимости

## Версии Node.js/Bun

- **Bun**: Последняя версия (рекомендуется)
- **Node.js**: 18+ (альтернатива)

## Shadcn/ui Интеграция

**Нативная интеграция**:
- Shadcn/ui компоненты через React
- Настроена тема Maia с Cyan акцентами
- Компоненты: Button, Card, Input, Select, Dialog, Badge, Tabs, Tooltip, Popover, Separator, ScrollArea, Label, Slider
- Расположение: `components/ui/`
- Тема настроена в `app/globals.css`

**Шаблон**: https://ui.shadcn.com/create?base=radix&style=maia&baseColor=neutral&theme=cyan&iconLibrary=phosphor&font=public-sans&menuAccent=subtle&menuColor=default&radius=large

## Запрещенные технологии

- ❌ Серверные фреймворки (Express, FastAPI и т.д.)
- ❌ Базы данных (только LocalStorage)
- ❌ Облачные сервисы
- ❌ npm/yarn (используется Bun)
- ❌ ESLint/Prettier (используется Biome)
