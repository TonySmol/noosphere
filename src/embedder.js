const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

let model = null;

export async function init(onProgress) {
  model = await pipeline(
    'feature-extraction',
    'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    { quantized: true, progress_callback: onProgress }
  );
}

export async function embed(text) {
  if (!model) throw new Error('Модель не готова');
  const out = await model(text);
  return normalize(Array.from(out.data));
}

export function normalize(vec) {
  const m = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return m === 0 ? vec : vec.map(x => x / m);
}

export function vecToBase64(arr) {
  const bytes = new Uint8Array(new Float32Array(arr).buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function vecFromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Array.from(new Float32Array(bytes.buffer));
}
