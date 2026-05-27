export const CONFIG = {
  repo: 'tonysmol/noosphere',  // ← ЗАМЕНИ НА СВОЙ!
  branch: 'main',
  worldFile: 'world.json',
  get worldRawUrl() {
    return `https://raw.githubusercontent.com/${this.repo}/${this.branch}/${this.worldFile}`;
  },
  search: {
    threshold: 0.3,
    limit: 5
  },
  serendipityDelta: 0.15,
  excerptLen: 500
};
