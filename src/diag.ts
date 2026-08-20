/**
 * 构建期诊断开关。esbuild（生产 false / dev true）与 vitest（true）向所有模块
 * 注入全局常量 __DIAG__，直接在使用点写 if (__DIAG__)——define 会在每个引用处
 * 原地替换，false 分支经 minify + tree-shaking 整体剔除，不进发行包。
 * 注意：不要把它包进导出常量再 import，那样 esbuild 无法跨模块折叠，生产包删不掉。
 */
declare global {
  const __DIAG__: boolean;
}

export {};
