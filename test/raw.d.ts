// Vite `?raw` imports (test/brand.test.ts reads the committed generated files).
declare module '*?raw' {
  const content: string;
  export default content;
}
