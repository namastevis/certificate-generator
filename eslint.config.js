/*!
 * Kagaz — ESLint flat config.
 *
 * Optional. `npm run check` (lint + verify + tests) runs on a bare Node install
 * with no dependencies at all; this only applies if you have chosen to run
 * `npm install`. It covers shared/*.js and the test suites — the code that
 * lives in real files. Logic inside <script> tags is checked by tests/lint.mjs,
 * which parses every block and enforces the project's own rules.
 *
 * The rules here are deliberately few. This is a project where a contributor
 * should be able to make a change without arguing with a linter about style.
 */
export default [
  {
    // Browser code. ES5 idiom on purpose: there is no transpiler, so it has to
    // run as written in whatever browser someone brings.
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        Blob: 'readonly', URL: 'readonly', FileReader: 'readonly',
        ImageData: 'readonly', OffscreenCanvas: 'readonly',
        createImageBitmap: 'readonly', Promise: 'readonly',
        Uint8Array: 'readonly', ArrayBuffer: 'readonly', TextDecoder: 'readonly',
        module: 'writable', self: 'readonly', globalThis: 'readonly',
        PDFLib: 'readonly', JSZip: 'readonly', pdfjsLib: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-self-compare': 'error',
      'no-constant-condition': 'error',
      'valid-typeof': 'error',
      'eqeqeq': ['error', 'smart'],
      // The project rules that matter are enforced by tests/lint.mjs, which
      // can also see inside HTML. These are the belt to that pair of braces.
      'no-restricted-globals': ['error',
        { name: 'localStorage', message: 'Kagaz never writes to disk — see tests/lint.mjs' },
        { name: 'sessionStorage', message: 'Kagaz never writes to disk — see tests/lint.mjs' },
        { name: 'fetch', message: 'Kagaz makes no network requests — see tests/lint.mjs' }
      ]
    }
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly', process: 'readonly', Buffer: 'readonly',
        URLSearchParams: 'readonly', Uint8Array: 'readonly', Set: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
      'no-undef': 'error',
      'eqeqeq': ['error', 'smart']
    }
  }
];
