import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'src/**/*', 'server.ts', '*.ts', '*.js', '*.mjs'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
