const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = [
  {
    entry: './src/main.ts',
    mode: 'production',
    target: 'node',
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    output: {
      filename: 'main.js',
      path: path.resolve(__dirname, 'dist'),
    },
    externals: [nodeExternals()],
  },
  {
    entry: './src/workers/crawler.ts',
    mode: 'production',
    target: 'node',
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    output: {
      filename: 'workers/crawler.js',
      path: path.resolve(__dirname, 'dist'),
    },
    externals: [nodeExternals()],
  }
];
