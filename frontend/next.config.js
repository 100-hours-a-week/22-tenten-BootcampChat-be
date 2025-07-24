/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@vapor-ui/core', '@vapor-ui/icons'],

  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right'
  },

  // 정적 export 모드
  output: 'export',

  // 이미지 최적화 비활러 (export 시 필수)
  images: {
    unoptimized: true
  },

  ...(process.env.NODE_ENV === 'development' && {
    experimental: {
      forceSwcTransforms: true
    }
  })
};

module.exports = nextConfig;
