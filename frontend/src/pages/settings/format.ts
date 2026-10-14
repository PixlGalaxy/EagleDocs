import type { Tier } from '../../api/types';

export function formatPrice(tier: Pick<Tier, 'price_cents' | 'currency'>, language: string): string {
  return new Intl.NumberFormat(language, { style: 'currency', currency: tier.currency.toUpperCase() }).format(tier.price_cents / 100);
}
