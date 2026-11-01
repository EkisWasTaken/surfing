import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';

// Lists the .bsp files in public/maps so the menu can offer them without a hand-kept index.
export default defineConfig({
  plugins: [
    {
      name: 'maps-index',
      configureServer(server) {
        server.middlewares.use('/maps/index.json', (_req, res) => {
          let files: string[] = [];
          try {
            files = readdirSync('public/maps').filter((f) => /\.bsp$/i.test(f)).sort();
          } catch {} // no folder yet: empty list
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });
      },
    },
  ],
});
