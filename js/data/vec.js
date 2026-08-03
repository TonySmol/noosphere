// ─── DATA/Vec ─── START ──────────────────────────────────────
/**
 * Векторная математика: кодирование для Nostr-тегов, косинусное сходство,
 * нормализация и k-means для центроидов.
 *
 * Сетевая упаковка — Int16-квантование: нормализованные значения [-1,1]
 * → [-32767,32767]. Размер тега вдвое меньше сырого Float32 (1024 байта
 * base64 вместо 2048) — влезает в лимиты рэлеев на значение тега.
 * Локальная точность не страдает: квантуется только упаковка.
 *
 * @exports Vec
 */
DI.register('Vec', function () {
  /** Приводит вход к Float32Array. @param {*} v @returns {Float32Array} */
  const f32 = v => (v instanceof Float32Array ? v : Float32Array.from(v || []));

  /**
   * Вектор → компактный base64 (Int16) для тега ['v', …].
   * @param {Float32Array|number[]} vec
   * @returns {string}
   */
  function toB64(vec) {
    const f = f32(vec);
    const i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      let x = f[i];
      if (x > 1) x = 1; else if (x < -1) x = -1;
      i16[i] = Math.round(x * 32767);
    }
    const bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  /**
   * base64 (Int16) → вектор. Защитный: на битых данных вернёт null.
   * @param {string} b64
   * @returns {Float32Array|null}
   */
  function fromB64(b64) {
    try {
      const bin = atob(String(b64 || ''));
      if (!bin || bin.length < 2 || bin.length % 2 !== 0) return null;
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const i16 = new Int16Array(bytes.buffer);
      const out = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32767;
      return normalize(out);   // ренормализуем после деквантования
    } catch (_) { return null; }
  }

  /**
   * Косинусное сходство нормализованных векторов.
   * @param {Float32Array|number[]} a @param {Float32Array|number[]} b
   * @returns {number}
   */
  function cosine(a, b) {
    if (!a || !b) return 0;
    const n = Math.min(a.length, b.length);
    if (!n) return 0;
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  }

  /**
   * Нормализация до единичной длины.
   * @param {Float32Array|number[]} v
   * @returns {Float32Array}
   */
  function normalize(v) {
    const f = f32(v);
    let norm = 0;
    for (let i = 0; i < f.length; i++) norm += f[i] * f[i];
    norm = Math.sqrt(norm);
    const out = new Float32Array(f.length);
    if (!norm) return out;
    for (let i = 0; i < f.length; i++) out[i] = f[i] / norm;
    return out;
  }

  /** Квадрат евклидова расстояния. @param {*} a @param {*} b @returns {number} */
  function sqDist(a, b) {
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
    return s;
  }

  /**
   * k-means (Ллойд) с детерминированным farthest-point стартом.
   * @param {Array<Float32Array|number[]>} vectors
   * @param {number} k
   * @param {number} [iterations=10]
   * @returns {Float32Array[]} Центроиды.
   */
  function kmeans(vectors, k, iterations) {
    const iters = iterations || 10;
    const n = vectors.length;
    if (!n || !k) return [];
    if (n <= k) return vectors.map(v => f32(v));
    const dim = vectors[0].length;

    const cents = [f32(vectors[0])];
    while (cents.length < k) {
      let bestI = 0, bestD = -1;
      for (let i = 0; i < n; i++) {
        let minD = Infinity;
        for (const c of cents) { const d = sqDist(vectors[i], c); if (d < minD) minD = d; }
        if (minD > bestD) { bestD = minD; bestI = i; }
      }
      cents.push(f32(vectors[bestI]));
    }

    for (let it = 0; it < iters; it++) {
      const sums = Array.from({ length: k }, () => new Float32Array(dim));
      const counts = new Array(k).fill(0);
      for (let i = 0; i < n; i++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) { const d = sqDist(vectors[i], cents[c]); if (d < bestD) { bestD = d; best = c; } }
        counts[best]++;
        for (let d = 0; d < dim; d++) sums[best][d] += vectors[i][d];
      }
      for (let c = 0; c < k; c++) {
        if (counts[c]) for (let d = 0; d < dim; d++) cents[c][d] = sums[c][d] / counts[c];
      }
    }
    return cents;
  }

  return { toB64, fromB64, cosine, normalize, kmeans };
}, []);
// ─── DATA/Vec ─── END ────────────────────────────────────────
