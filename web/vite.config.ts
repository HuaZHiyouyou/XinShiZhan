import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: {
    /* 不产出 sourcemap：线上无法从压缩产物反推出原始 TypeScript 源码与目录结构 */
    sourcemap: false,
    minify: 'esbuild',
    reportCompressedSize: false,
    /* 构建产物只保留哈希文件名，避免暴露模块命名规律 */
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
    },
  },
  esbuild: {
    /* 去掉 console/debugger 与版权注释：既减少信息泄露，也避免调试输出被用来推断内部逻辑 */
    drop: ['console', 'debugger'],
    legalComments: 'none',
    /* 压缩标识符，进一步降低可读性 */
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  },
});
