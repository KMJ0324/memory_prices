/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig = {
  reactStrictMode: true,
  // Fully static site: the daily GitHub Actions job writes public/data/*.json,
  // so there is no server to run and it deploys to GitHub Pages as-is.
  output: "export",
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
