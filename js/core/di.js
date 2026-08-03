'use strict';

// ═══════════════════════════════════════════════════════════════
// CORE/DI — Dependency Injection Container
// ═══════════════════════════════════════════════════════════════
const DI = (() => {
  const factories = new Map();
  const instances = new Map();
  
  /**
   * Registers a module factory.
   * @param {string} name - Module name.
   * @param {Function} factory - Factory function that receives resolved dependencies as arguments.
   * @param {string[]} [deps] - Dependency names.
   */
  function register(name, factory, deps) { 
    factories.set(name, { factory, deps: deps || [] }); 
  }
  
  /**
   * Resolves a module (lazy, with caching and cycle detection).
   * @param {string} name
   * @param {Set<string>} [visiting]
   * @returns {*} Module instance.
   */
  function resolve(name, visiting) {
    if (instances.has(name)) return instances.get(name);
    const def = factories.get(name);
    if (!def) throw new Error('Module not found: ' + name);
    visiting = visiting || new Set();
    if (visiting.has(name)) throw new Error('Circular dependency: ' + name);
    visiting.add(name);
    const args = def.deps.map(d => resolve(d, visiting));
    visiting.delete(name);
    const inst = def.factory(...args);
    instances.set(name, inst);
    return inst;
  }
  
  return { register, resolve };
})();

export { DI };
