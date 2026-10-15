// Minimal lint setup: catches typos, unused code and accidental globals.
export default [
  {
    files: ['src/frontend/**/*.js', 'test/**/*.js', 'test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        sessionStorage: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        Blob: 'readonly', Event: 'readonly', getComputedStyle: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', atob: 'readonly',
        btoa: 'readonly', Uint8Array: 'readonly', process: 'readonly', Promise: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    files: ['src/backend/**/*.js', 'test/backend.smoke.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { tjs: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', console: 'readonly', Promise: 'readonly' },
    },
    rules: { 'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }], 'no-undef': 'error' },
  },
];
