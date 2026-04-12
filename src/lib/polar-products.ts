import { POLAR_ORGANIZATION_ID, polar } from "@/lib/polar";

type PolarProduct = Awaited<ReturnType<typeof polar.products.get>>;

export function formatPolarPrice(product: PolarProduct) {
  const price = product.prices.find(
    (entry: { amountType?: string }) => entry.amountType === "fixed",
  );

  if (!price || price.amountType !== "fixed") {
    return "Custom pricing";
  }

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.priceCurrency,
    maximumFractionDigits: 2,
  }).format(price.priceAmount / 100);

  if (!product.isRecurring) {
    return formattedAmount;
  }

  const interval = product.recurringInterval ?? "month";
  const intervalCount =
    product.recurringIntervalCount && product.recurringIntervalCount > 1
      ? ` every ${product.recurringIntervalCount} ${interval}s`
      : ` / ${interval}`;

  return `${formattedAmount}${intervalCount}`;
}

export async function loadPolarProducts() {
  const page = await polar.products.list({
    organizationId: POLAR_ORGANIZATION_ID,
    isArchived: false,
    isRecurring: true,
    limit: 100,
  });

  const products: PolarProduct[] = [];
  for await (const result of page) {
    const items = result?.result?.items ?? [];
    products.push(...items);
  }

  return products.sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      left.name.localeCompare(right.name),
  );
}

export async function loadDefaultPolarProduct() {
  const products = await loadPolarProducts();
  return products[0] ?? null;
}
