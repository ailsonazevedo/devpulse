/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @devpulse/core é TS puro consumido direto do workspace.
  transpilePackages: ["@devpulse/core"],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "secure.gravatar.com" },
      { protocol: "https", hostname: "gitlab.com" },
    ],
  },
  // @devpulse/core usa specifiers ESM ".js" (NodeNext). Faz o webpack
  // resolver esses ".js" para os fontes ".ts" do workspace.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
