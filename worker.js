// Импортируем нашу локальную прослойку библиотеки
import { pipeline, env } from './transformers.js';

// Говорим библиотеке качать саму модель напрямую из репозитория Hugging Face
env.allowRemoteModels = true;
env.allowLocalModels = false;

let extractor = null;

// Принимаем текст на расчет от главного HTML
self.onmessage = async (event) => {
    const { text } = event.data;

    try {
        if (!extractor) {
            self.postMessage({ status: 'progress', message: 'Загрузка весов модели из Hugging Face...' });
            
            // Инициализируем модель (all-MiniLM-L6-v2) на процессоре (wasm)
            extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                device: 'wasm'
            });
        }

        self.postMessage({ status: 'ready', message: 'Модель готова. Считаем...' });

        // Вычисляем эмбеддинг
        const result = await extractor(text, { pooling: 'mean', normalize: true });
        
        // Отправляем вектор обратно в index.html
        self.postMessage({ 
            status: 'complete', 
            data: Array.from(result.data) 
        });

    } catch (error) {
        self.postMessage({ status: 'error', message: error.message });
    }
};
