import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { checkLicensedMaps } from './scripts/licensed-maps';

export default defineConfig(({ command }) => ({
  // public/ only holds files imported from Steam (maps, knives): never copied into the public build.
  publicDir: command === 'build' ? false : 'public',
  base: './', // works from any folder, e.g. username.github.io/surfing/
  assetsInclude: ['**/*.bsp'],
  plugins: [
    // licensed-maps/ ships publicly: no build unless every map has a manifest entry.
    {
      name: 'licensed-maps-check',
      buildStart() {
        const errors = checkLicensedMaps('licensed-maps');
        if (errors.length) throw new Error(`licensed-maps:\n  ${errors.join('\n  ')}`);
      },
    },
    // Lists the .bsp files in public/maps so the menu can offer them without a hand-kept index.
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
}));
