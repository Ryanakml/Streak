function deriveIssuerFromPublishableKey(key: string | undefined) {
  if (!key) return undefined;

  const encoded = key.split("_").slice(2).join("_");
  if (!encoded) return undefined;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
    const frontendApi = decoded.replace(/\$$/, "");
    if (!frontendApi) return undefined;
    return `https://${frontendApi}`;
  } catch {
    return undefined;
  }
}

const issuer =
  process.env.CLERK_ISSUER_URL ??
  process.env.CLERK_JWT_ISSUER_DOMAIN ??
  deriveIssuerFromPublishableKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

if (!issuer) {
  throw new Error(
    "Missing Clerk issuer for Convex auth. Set CLERK_ISSUER_URL or CLERK_JWT_ISSUER_DOMAIN.",
  );
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer,
      jwks: `${issuer}/.well-known/jwks.json`,
      algorithm: "RS256",
    },
  ],
};
