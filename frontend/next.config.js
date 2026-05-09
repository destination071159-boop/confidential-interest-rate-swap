const path = require('path');
const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  webpack(config) {
    // Stub out React-Native-only package pulled in by @metamask/sdk
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': path.resolve(
        __dirname,
        'lib/async-storage-stub.js',
      ),
    };

    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^wagmi\/actions$/,
        (resource) => {
          if (resource.context && resource.context.includes('@zama-fhe')) {
            resource.request = path.resolve(__dirname, 'lib/wagmi-actions-shim.ts');
          }
        },
      ),
    );
    return config;
  },
};

module.exports = nextConfig;
