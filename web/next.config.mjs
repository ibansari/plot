/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.API_BASE_URL ?? "http://localhost:3000",
  },
};
export default nextConfig;
