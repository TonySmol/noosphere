const KEY = 'noosphere_my_notes_v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}
function save(notes) { localStorage.setItem(KEY, JSON.stringify(notes)); }

export const MyNotes = {
  list() { return load(); },

  add(text) {
    const note = {
      id: crypto.randomUUID(),
      text,
      date: new Date().toISOString(),
      editedAt: null,
      vec: null
    };
    const notes = load();
    notes.unshift(note);
    save(notes);
    return note;
  },

  updateVec(id, vec) {
    const notes = load();
    const n = notes.find(x => x.id === id);
    if (n) { n.vec = vec; save(notes); }
  },

  updateText(id, newText) {
    const notes = load();
    const n = notes.find(x => x.id === id);
    if (n) {
      n.text = newText;
      n.editedAt = new Date().toISOString();
      n.vec = null;
      save(notes);
    }
  },

  remove(id) {
    save(load().filter(x => x.id !== id));
  },

  clear() { save([]); }
};
