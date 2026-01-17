import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Enable WASM support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    
    // Handle WASM files as assets
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
      generator: {
        filename: 'static/wasm/[name][ext]',
      },
    });
    
    // Add resolver alias for hasher.rs WASM files to point to public folder
    // This makes webpack resolve 'light_wasm_hasher_bg.wasm' to our public files
    config.resolve.alias = {
      ...config.resolve.alias,
      'light_wasm_hasher_bg.wasm': path.resolve(__dirname, 'public/light_wasm_hasher_bg.wasm'),
      'hasher_wasm_simd_bg.wasm': path.resolve(__dirname, 'public/hasher_wasm_simd_bg.wasm'),
    };
    
    // Provide fallbacks for Node.js modules in browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        'node-localstorage': false,
      };
    }
    
    return config;
  },
};

export default nextConfig;
