import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // fleet.db (+ its SQLite -wal/-shm/-journal files) is rewritten every 5s
      // by the live telemetry simulator in server.ts. Left unwatched-ignore,
      // Vite's own config/.env watcher was misfiring on every one of those
      // writes and force-restarting the whole dev server in a tight loop
      // (".env changed, restarting server..." every ~5s despite .env being
      // untouched) -- which killed the page's live connection continuously.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/fleet.db', '**/fleet.db-journal', '**/fleet.db-wal', '**/fleet.db-shm'],
      },
    },
  };
});
