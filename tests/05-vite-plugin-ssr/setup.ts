import path from 'path';
import { setup } from '../setup';
import react from '@vitejs/plugin-react';
import ssr from 'vite-plugin-ssr/plugin';
import vercel from 'vite-plugin-vercel';
import vitePluginSsrVercelPlugin from '../../prerender/vite-plugin-ssr';

const globalSetup = setup(path.basename(__dirname), {
  configFile: false,
  mode: 'production',
  root: process.cwd(),
  plugins: [react(), ssr(), vercel(), vitePluginSsrVercelPlugin()],
  vercel: {
    expiration: 25,
  },
  build: {
    outDir: 'dist',
  },
});
export default globalSetup;
