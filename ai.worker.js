// ai.worker.js — Web Worker для векторизации через Transformers.js
// Запускается как module worker: new Worker('ai.worker.js', { type: 'module' })

let extractor = null;
let pipelineFn = null;

// Глобальный обработчик входящих сообщений от основного потока
self.onmessage = async function (event) {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  try {
    if (msg.type === 'load') {
      await handleLoad(msg.modelName, msg.options || {});
    } else if (msg.type === 'embed') {
      await handleEmbed(msg.id, msg.text);
    }
  } catch (err) {
    // Глобальный перехват на случай неожиданных ошибок
    if (msg && msg.type === 'embed' && msg.id != null) {
      self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
    } else {
      self.postMessage({ type: 'error', id: null, message: String(err && err.message || err) });
    }
  }
};

/**
 * Загрузка модели Transformers.js с пробросом прогресса в основной поток.
 * @param {string} modelName - путь к модели (например, Xenova/multilingual-e5-small)
 * @param {Object} options - параметры (quantized)
 */
async function handleLoad(modelName, options) {
  try {
    if (!pipelineFn) {
      // Динамический импорт библиотеки внутри module worker
      const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      pipelineFn = mod.pipeline || (mod.default && mod.default.pipeline);
      if (!pipelineFn) {
        throw new Error('transformers: pipeline not found in module');
      }
      // Настройки окружения: запрет локальных моделей, включение кэша браузера
      if (mod.env) {
        mod.env.allowLocalModels = false;
        mod.env.useBrowserCache = true;
      }
    }

    // Загрузка модели с трансляцией прогресса
    extractor = await pipelineFn('feature-extraction', modelName, {
      quantized: !!options.quantized,
      progress_callback: function (p) {
        if (p && p.status === 'progress' && p.total > 0) {
          const pct = (p.loaded / p.total) * 100;
          self.postMessage({ type: 'progress', pct: pct });
        }
      }
    });

    self.postMessage({ type: 'ready' });
  } catch (err) {
    extractor = null;
    self.postMessage({ type: 'error', id: null, message: String(err && err.message || err) });
  }
}

/**
 * Выполнение эмбеддинга текста и отправка результата в основной поток.
 * @param {number} id - идентификатор запроса для корреляции
 * @param {string} text - текст для векторизации
 */
async function handleEmbed(id, text) {
  if (!extractor) {
    self.postMessage({ type: 'error', id: id, message: 'Model not loaded' });
    return;
  }
  try {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);
    self.postMessage({ type: 'result', id: id, vector: vector });
  } catch (err) {
    self.postMessage({ type: 'error', id: id, message: String(err && err.message || err) });
  }
}
