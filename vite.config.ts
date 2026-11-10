import { createReadStream, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Track the dev server starts with (instead of the demo loop); VISUALIZER_AUDIO overrides it. */
const DEV_AUDIO = process.env.VISUALIZER_AUDIO ?? join(homedir(), 'downloads', '1.wav');

/** Dev server only: serves DEV_AUDIO at /dev-audio, 404 when the file is missing. */
function devAudio(): Plugin {
  return {
    name: 'dev-audio',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-audio', (_req, res) => {
        if (!existsSync(DEV_AUDIO)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', DEV_AUDIO.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(DEV_AUDIO).size));
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Audio-Name', encodeURIComponent(basename(DEV_AUDIO)));
        createReadStream(DEV_AUDIO).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [devAudio()],
  build: {
    rollupOptions: {
      // settings.html: the settings window of the desktop app (desktop/visualizer.py)
      input: { main: 'index.html', settings: 'settings.html' },
    },
  },
});
