/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'pg', '@prisma/adapter-pg'],
};

module.exports = nextConfig;
