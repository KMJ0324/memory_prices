/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The CSV is read through a runtime path, so Next's tracer can't see it.
  // Without this it is missing from the Vercel/standalone bundle.
  outputFileTracingIncludes: {
    "/api/memory": ["./data/**"],
  },
};

export default nextConfig;
