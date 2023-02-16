module.exports = {
    presets: [
      // ['@babel/preset-env', { targets: { node: 'current' } }],
      '@babel/preset-env',
      '@babel/preset-typescript'
    ],
    plugins: ["@babel/plugin-transform-runtime"]
  };