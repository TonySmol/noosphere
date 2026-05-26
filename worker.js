// Импортируем библиотеку. В реальном проекте вы скачиваете этот файл к себе, 
// чтобы не зависеть от CDN и обойти ошибку ERR_TUNNEL_CONNECTION_FAILED
import { pipeline, env } from 'https://jsdelivr.net';

// Разрешаем удаленные модели (чтобы они качались с Hugging Face напрямую)
env.allowRemoteModels = true;

let extractor = null;

// Слушаем команды от главного окна
self.onmessage = async (event) => {
    const { text } = event.data;

    try {
        // Инициализируем пайплайн только один раз при первом клике
        if (!extractor) {
            self.postMessage({ status: 'progress', message: 'Инициализация пайплайна...' });
            
            extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                device: 'wasm' // CPU вычисления для гарантированной работы везде
            });
        }

        self.postMessage({ status: 'ready' });

        // Считаем эмбеддинг
        const result = await extractor(text, { pooling: 'mean', normalize: true });
        
        // Возвращаем результат обратно в интерфейс
        self.postMessage({ 
            status: 'complete', 
            data: Array.from(result.data) 
        });

    } catch (error) {
        self.postMessage({ status: 'error', message: error.message });
    }
};
