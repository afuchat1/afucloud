const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.VITE_API_BASE_URL ??
  'https://api.afuchat.com/afucloud';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@workspace/api-client-react'],
  ...(apiBaseUrl ? { env: { NEXT_PUBLIC_API_BASE_URL: apiBaseUrl } } : {}),
};

export default nextConfig;