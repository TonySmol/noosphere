export const CONFIG = {
  // ⚠️ ЗАМЕНИ НА URL СВОЕГО CLOUDFLARE WORKER
  workerUrl: 'https://noosphere-proxy.твой-ник.workers.dev',
  collection: 'noosphere',
  search: {
    threshold: 0.3,
    limit: 5,
    minWaves: 0
  },
  serendipityDelta: 0.15,
  excerptLen: 500
};
