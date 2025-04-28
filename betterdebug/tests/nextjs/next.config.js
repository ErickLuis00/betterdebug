
// import { withBetterDebug } from './.betterdebug'; // esm
const { withBetterDebug } = require('./.betterdebug'); // cjs

/** @type {import('next').NextConfig} */
const nextConfig = withBetterDebug({
    // Your existing Next.js config options go here...
    reactStrictMode: false,
});

module.exports = nextConfig;

