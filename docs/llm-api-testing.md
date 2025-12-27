# Тестирование Gemini API

## Настройка

1. Создайте файл `.env.local` в корне проекта:
```env
GEMINI_API_KEY=your_api_key_here
```

**Важно:** Файл `.env.local` автоматически игнорируется Git (добавлен в `.gitignore`), поэтому ваш API ключ не будет сохранен в репозитории.

2. Получите API ключ от Google AI Studio:
   - Перейдите на https://makersuite.google.com/app/apikey
   - Создайте новый API ключ
   - Скопируйте ключ в `.env.local`

**Важно:** Проект использует модель `gemini-2.5-flash` с отличными лимитами токенов (1M input, 64K output) — идеально для генерации карт с большими реестрами тайлов

## Тестирование

### Шаг 1: Проверьте доступные модели

Сначала проверьте, какие модели доступны для вашего API ключа:

1. Запустите dev сервер:
```bash
bun dev
```

2. Откройте в браузере:
```
http://localhost:3000/test-llm
```

3. Нажмите кнопку **"Список доступных моделей"** - это покажет все модели, доступные для вашего API ключа

### Шаг 2: Тестирование API

После проверки списка моделей, попробуйте:

1. **Тест 1**: Простое подключение (GET запрос)
2. **Тест 2**: JSON Schema (структурированный вывод)
3. **Тест 3**: Пример генерации hex карты

**Если модель не найдена (404):**

Попробуйте разные имена моделей через простой тест:
- `http://localhost:3000/api/llm/test-simple?model=gemini-pro`
- `http://localhost:3000/api/llm/test-simple?model=gemini-1.5-pro`
- `http://localhost:3000/api/llm/test-simple?model=gemini-1.5-flash-001`

### Вариант 2: Через API напрямую

#### Простой тест (GET):
```bash
curl http://localhost:3000/api/llm/test
```

#### Тест JSON Schema (POST):
```bash
curl -X POST http://localhost:3000/api/llm/test \
  -H "Content-Type: application/json" \
  -d '{"testType": "json-schema"}'
```

#### Тест hex карты (POST):
```bash
curl -X POST http://localhost:3000/api/llm/test \
  -H "Content-Type: application/json" \
  -d '{"testType": "hex-map-sample"}'
```

## Ожидаемые результаты

### Тест 1 (Простое подключение)
- ✅ `success: true`
- ✅ `apiKeyPresent: true`
- ✅ `response` содержит ответ от Gemini

### Тест 2 (JSON Schema)
- ✅ `success: true`
- ✅ `response` - валидный JSON объект со структурой:
  ```json
  {
    "message": "JSON Schema test successful",
    "status": "success",
    "data": {
      "testNumber": 42,
      "testBoolean": true
    }
  }
  ```

### Тест 3 (Hex Map Sample)
- ✅ `success: true`
- ✅ `response.hexes` - массив из 9 объектов
- ✅ Каждый объект содержит: `q`, `r`, `tile_id`, `rotation`, `height`

## Устранение проблем

### Ошибка: "GEMINI_API_KEY not found"
- Убедитесь, что файл `.env.local` существует в корне проекта
- Убедитесь, что ключ указан правильно (без кавычек)
- Перезапустите dev сервер после создания/изменения `.env.local`

### Ошибка API: "API key not valid"
- Проверьте, что API ключ скопирован полностью
- Убедитесь, что API ключ активен в Google AI Studio
- Проверьте лимиты использования (бесплатный tier имеет ограничения)

### Ошибка 429: "Quota exceeded" / "Too Many Requests"
- ⚠️ **Free tier может иметь очень ограниченные квоты (0 запросов в некоторых регионах)**
- Подождите несколько минут перед повторной попыткой
- Проверьте вашу квоту на https://ai.dev/usage?tab=rate-limit
- Для production использования рекомендуется платный tier
- Альтернатива: используйте локальные модели (Ollama) для разработки

### Ошибка: "Model not found"
- Убедитесь, что используется правильное имя модели: `gemini-1.5-flash`
- Проверьте доступность модели в вашем регионе
- Список доступных моделей: https://ai.google.dev/models/gemini

## Следующие шаги

После успешного тестирования:
1. ✅ API ключ работает
2. ✅ JSON Schema поддерживается
3. ✅ Можно переходить к реализации MapGenerator

