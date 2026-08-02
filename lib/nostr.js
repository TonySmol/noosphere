import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool }
  from 'https://cdn.jsdelivr.net/npm/nostr-tools@2.7.2/+esm';

export const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://offchain.pub'];
const SK_KEY = 'noomium:sk';

const pool = new SimplePool();
const sk = loadKey();

function loadKey() {
  const hex = localStorage.getItem(SK_KEY);
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) {
    return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  }
  const k = generateSecretKey();
  localStorage.setItem(SK_KEY,
    Array.from(k).map(b => b.toString(16).padStart(2, '0')).join(''));
  return k;
}

export const pubkey = () => getPublicKey(sk);

// Заметка = kind 1 (хранится) + тег комнаты + тег вектора
export async function publishNote(text, vecB64, room) {
  const ev = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', room], ['v', vecB64]],
    content: text,
  }, sk);
  await pool.publish(RELAYS, ev);
  return ev;
}

// Лента = подписка на kind 1 в комнате (векторные фильтруем на клиенте)
export function subscribeFeed(room, onNote) {
  return pool.subscribeMany(RELAYS, [{ kinds: [1], '#t': [room] }], { onevent: onNote });
}
