// Загружаем библиотеку из CDN
const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

let model = null;

export async function initEmbedder(onProgress) {
  model = await pipeline(
    'feature-extraction',
    'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    { 
      quantized: true,
      progress_callback: onProgress
    }
  );
  return model;
}

export async function embed(text) {
  if (!model) throw new Error('Model not initialized');
  const output = await model(text);
  return Array.from(output.data); // 384 числа
}
