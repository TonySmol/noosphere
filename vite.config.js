import { defineConfig } from 'vite';
export default defineConfig({
  base: '/noosphere/', // ← замени на имя своего репо
  build: { target: 'esnext' }
});
