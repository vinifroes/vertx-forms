// Vertx Forms: renders the Vertx wordmark/icon instead of the Formbricks one. Reuses the
// static icon already served from /favicon (see docker-compose.traefik.yml volume mounts
// on our deployment) rather than re-embedding new SVG paths here.
export const Logo = (props: any) => {
  // eslint-disable-next-line @next/next/no-img-element -- plain static asset, not a Next/Image-optimized route
  return <img src="/favicon/android-chrome-512x512.png" alt="Vertx Forms" {...props} />;
};
