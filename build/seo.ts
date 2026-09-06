import type { Plugin } from "vite";

export const site = {
  name: "Mechanical Wheel",
  title: "Mechanical Wheel – Free Online Spinning Wheel",
  description: "Create a free spinning wheel with 2–50 choices. Pick names, decide what to eat, or choose your next activity. Share your wheel and replay the result.",
};

/** Emit metadata in the initial HTML so crawlers do not need JavaScript. */
export function seo(siteUrl = "https://wheel.glotlabs.com/"): Plugin {
  const url = new URL(siteUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SITE_URL must be an HTTPS origin, such as https://your-domain.com");
  }
  const canonical = url.href;
  const image = new URL("social-preview.png", canonical).href;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite", name: site.name, url: canonical, inLanguage: "en",
        "@id": `${canonical}#website`,
      },
      {
        "@type": "WebApplication", name: site.name, url: canonical,
        "@id": `${canonical}#app`, isPartOf: { "@id": `${canonical}#website` },
        description: site.description, applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any", browserRequirements: "Requires JavaScript and a browser with WebGPU support.",
        isAccessibleForFree: true, inLanguage: "en",
        featureList: ["2–50 custom choices", "Batch editing", "Shareable wheels", "Spin history and replay"],
      },
    ],
  };
  return {
    name: "site-seo",
    transformIndexHtml() {
      return [
        { tag: "title", children: site.title },
        { tag: "meta", attrs: { name: "description", content: site.description } },
        { tag: "meta", attrs: { name: "robots", content: "index, follow, max-image-preview:large" } },
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
        { tag: "meta", attrs: { property: "og:site_name", content: site.name } },
        { tag: "meta", attrs: { property: "og:title", content: site.title } },
        { tag: "meta", attrs: { property: "og:description", content: site.description } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:title", content: site.title } },
        { tag: "meta", attrs: { name: "twitter:description", content: site.description } },
        { tag: "link", attrs: { rel: "canonical", href: canonical } },
        { tag: "meta", attrs: { property: "og:url", content: canonical } },
        { tag: "meta", attrs: { property: "og:image", content: image } },
        { tag: "meta", attrs: { property: "og:image:type", content: "image/png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: "Mechanical Wheel: a colorful spinning wheel with custom choices." } },
        { tag: "meta", attrs: { name: "twitter:image", content: image } },
        { tag: "meta", attrs: { name: "twitter:image:alt", content: "Mechanical Wheel: a colorful spinning wheel with custom choices." } },
        { tag: "script", attrs: { type: "application/ld+json" }, children: JSON.stringify(structuredData).replace(/</g, "\\u003c") },
      ].map(tag => ({ ...tag, injectTo: "head" as const }));
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\n\nSitemap: ${canonical}sitemap.xml\n` });
      const escaped = canonical.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escaped}</loc></url></urlset>\n` });
    },
  };
}
