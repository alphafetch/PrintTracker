const globals = require('globals');

module.exports = [
    {
        files: ['js/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
            'no-import-assign': 'error',
            'no-const-assign': 'error'
        }
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
        rules: { 'no-undef': 'error', 'no-const-assign': 'error' }
    }
];
