interface FormbricksLogoProps {
  className?: string;
}

// Vertx Forms: renders the Vertx mark instead of the Formbricks logo. Reuses the same
// static icon already served from /favicon (see docker-compose.traefik.yml volume mounts
// on our deployment) rather than re-embedding new SVG paths here.
export const FormbricksLogo = ({ className }: FormbricksLogoProps) => {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- plain static asset, not a Next/Image-optimized route
    <img src="/favicon/android-chrome-512x512.png" alt="Vertx Forms" className={className} />
  );
};
