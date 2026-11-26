import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Five pages: home (values + finder), result (one product), assistant (chat), compare and near me.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        chat: fileURLToPath(new URL('./chat.html', import.meta.url)),
        result: fileURLToPath(new URL('./result.html', import.meta.url)),
        compare: fileURLToPath(new URL('./compare.html', import.meta.url)),
        nearme: fileURLToPath(new URL('./nearme.html', import.meta.url)),
      },
    },
  },
});
