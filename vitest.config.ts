import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 各测试文件用 @vitest-environment 注解声明 jsdom；setup 给 jsdom 补 createEl 等全局函数
    setupFiles: ['tests/setup.ts'],
  },
});
