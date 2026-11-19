// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['@/data/**', '@/application/**', '@/features/**', '@/components/**', '@/hooks/**', '**/data/**', '**/application/**', '**/features/**', '**/components/**', '**/hooks/**', 'expo', 'expo-*', 'react', 'react-native', 'react-native-*'],
        message: 'domain 只依赖纯业务规则，不依赖 UI、用例或原生适配器。',
      }] }],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['@/data/**', '**/data/**'],
        message: '功能 UI 通过 application 端口访问数据，由组合根注入适配器。',
      }] }],
    },
  },
]);
