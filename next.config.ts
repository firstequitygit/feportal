import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // /apply is the only route we deliberately allow to be iframe-embedded.
        // The CSP frame-ancestors directive locks embedding to the FEF marketing
        // site (apex + any subdomain) and our own portal. Without this header,
        // browsers default to allowing embedding from ANY origin, which would
        // let arbitrary sites pose as us.
        source: "/apply/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://firstequityfundingllc.com https://*.firstequityfundingllc.com",
          },
        ],
      },
      {
        source: "/apply",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://firstequityfundingllc.com https://*.firstequityfundingllc.com",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
