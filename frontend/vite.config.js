import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Three pages: main (inputs), result (one product), and the assistant (chat).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        chat: fileURLToPath(new URL('./chat.html', import.meta.url)),
        result: fileURLToPath(new URL('./result.html', import.meta.url)),
      },
    },
  },
});
