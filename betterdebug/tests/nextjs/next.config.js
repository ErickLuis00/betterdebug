const path = require('path');
const { withBetterDebug } = require('../../interceptor/my-extension-config');

/** @type {import('next').NextConfig} */
const nextConfig = withBetterDebug({
    // Your existing Next.js config options go here...
    reactStrictMode: false,

});

module.exports = nextConfig;

