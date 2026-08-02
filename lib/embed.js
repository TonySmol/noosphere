let extractor = null;
let loading = null;

export async function embed(text, onProgress) {
  if (!extractor) {
    if (!loading) {
      loading = import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2')
        .then(({ pipeline, env }) => {
          env.allowLocalModels = false;
          env.useBrowserCache = true;
          return pipeline('feature-extraction',
            'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
            { quantized: true, progress_callback: onProgress });
        })
        .then(ex => { extractor = ex; return ex; });
    }
    await loading;
  }
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(out.data);
}

export const isReady = () => !!extractor;
