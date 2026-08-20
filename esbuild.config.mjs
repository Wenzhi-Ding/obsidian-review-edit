import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";
// diag：一次性构建但保留诊断分支（__DIAG__=true），用于现场排障；产物不要发给用户
const diag = process.argv[2] === "diag";

const context = await esbuild.context({
  banner: { js: "/* 由 review-edit 构建生成 */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  // 生产构建剔除诊断代码（见 src/diag.ts）；dev 保留完整排障能力
  define: { __DIAG__: prod ? "false" : "true" },
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod || diag) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
