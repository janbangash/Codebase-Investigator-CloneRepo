import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow ngrok origin in development
  allowedDevOrigins: ['enrich-sappiness-aloe.ngrok-free.dev'],

  // Disable HTTP agent keep-alive for better SSE streaming
  httpAgentOptions: {
    keepAlive: false,
  },

  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const baseUrl = apiUrl.replace(/\/$/, '');

    return {
      beforeFiles: [
        // These routes are handled by Next.js API routes, not proxied
        {
          source: '/api/ai/chat-stream/:repoName',
          destination: '/api/ai/chat-stream/:repoName',
        },
        {
          source: '/api/ai/agent-stream/:repoName',
          destination: '/api/ai/agent-stream/:repoName',
        },
        {
          source: '/api/search/agent-stream/:repoName',
          destination: '/api/search/agent-stream/:repoName',
        },
      ],
      afterFiles: [
        {
          source: '/api/:path*',
          destination: `${baseUrl}/api/:path*`,
        },
      ],
      fallback: [],
    };
  },

  // Configure webpack to not buffer SSE
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.experiments = { ...config.experiments, topLevelAwait: true };
    }
    return config;
  },
};

export default nextConfig;
