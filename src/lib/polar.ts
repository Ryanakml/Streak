import { Polar } from "@polar-sh/sdk";

const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;
const polarOrganizationId = process.env.POLAR_ORGANIZATION_ID;

if (!polarAccessToken) {
  throw new Error("Missing POLAR_ACCESS_TOKEN");
}

if (!polarOrganizationId) {
  throw new Error("Missing POLAR_ORGANIZATION_ID");
}

export const polar = new Polar({
  accessToken: polarAccessToken,
  server: "sandbox",
});

export const POLAR_ORGANIZATION_ID = polarOrganizationId;
