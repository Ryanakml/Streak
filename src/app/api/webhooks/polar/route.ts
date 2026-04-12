import { clerkClient } from "@clerk/nextjs/server";
import { Webhooks } from "@polar-sh/nextjs";

function getClerkUserId(payload: {
  data: {
    metadata?: Record<string, string | number | boolean>;
    externalCustomerId?: string | null;
    customer?: {
      externalId?: string | null;
      metadata?: Record<string, string | number | boolean>;
    };
  };
}) {
  const metadataUserId = payload.data.metadata?.clerkUserId;
  if (typeof metadataUserId === "string" && metadataUserId.length > 0) {
    return metadataUserId;
  }

  const externalCustomerId = payload.data.externalCustomerId;
  if (typeof externalCustomerId === "string" && externalCustomerId.length > 0) {
    return externalCustomerId;
  }

  const customerExternalId = payload.data.customer?.externalId;
  if (typeof customerExternalId === "string" && customerExternalId.length > 0) {
    return customerExternalId;
  }

  const customerMetadataUserId = payload.data.customer?.metadata?.clerkUserId;
  if (
    typeof customerMetadataUserId === "string" &&
    customerMetadataUserId.length > 0
  ) {
    return customerMetadataUserId;
  }

  return null;
}

async function markUserPro(payload: {
  data: {
    metadata?: Record<string, string | number | boolean>;
    externalCustomerId?: string | null;
    customer?: {
      externalId?: string | null;
      metadata?: Record<string, string | number | boolean>;
    };
    status?: string;
  };
}) {
  const userId = getClerkUserId(payload);
  if (!userId) {
    return;
  }

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      subscriptionTier: "pro",
    },
  });
}

const polarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;

if (!polarWebhookSecret) {
  throw new Error("Missing POLAR_WEBHOOK_SECRET");
}

export const POST = Webhooks({
  webhookSecret: polarWebhookSecret,
  onSubscriptionCreated: async (payload) => {
    if (payload.data.status === "active" || payload.data.status === "trialing") {
      await markUserPro(payload);
    }
  },
  onCheckoutUpdated: async (payload) => {
    if (payload.data.status === "succeeded") {
      await markUserPro(payload);
    }
  },
});
