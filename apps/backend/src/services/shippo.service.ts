import { supabase } from '../config/supabase.js';

const SHIPPO_API = 'https://api.goshippo.com';

// Two return warehouses — label goes to whichever is cheaper
export const RETURN_ADDRESSES = [
  {
    label: 'Outlight - SWT1 (Tennessee)',
    name: 'Outlight - SWT1',
    company: 'Red Stag Fulfillment',
    street1: '500 Red Stag Way',
    city: 'Sweetwater',
    state: 'TN',
    zip: '37874',
    country: 'US',
    phone: '865-326-8763',
    email: 'returns@outlight.us',
  },
  {
    label: 'Outlight - UT (Utah)',
    name: 'Outlight - UT',
    street1: '5656 John Cannon Dr',
    street2: 'Suite 100',
    city: 'Salt Lake City',
    state: 'UT',
    zip: '84116',
    country: 'US',
    phone: '800-815-7824',
    email: 'returns@outlight.us',
  },
];

function shippoHeaders(): Record<string, string> {
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) throw new Error('Missing SHIPPO_API_KEY environment variable');
  return {
    'Content-Type': 'application/json',
    Authorization: `ShippoToken ${apiKey}`,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface CreateReturnLabelParams {
  customerName: string;
  customerStreet1: string;
  customerStreet2?: string;
  customerCity: string;
  customerState: string;
  customerZip: string;
  customerCountry: string;
  customerEmail?: string;
  customerPhone?: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  weightUnit?: string;
  dimensionUnit?: string;
}

export interface CreateReturnLabelResult {
  success: boolean;
  labelUrl?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  rate?: number;
  error?: string;
}

export interface PackageDimensions {
  length: number;
  width: number;
  height: number;
  weight: number;
  weight_unit?: string;
  dimension_unit?: string;
}

export interface AddressValidationResult {
  valid: boolean;
  messages: string[];
}

// ── createReturnLabel ─────────────────────────────────────────────────────

export async function createReturnLabel(
  params: CreateReturnLabelParams
): Promise<CreateReturnLabelResult> {
  const {
    customerName,
    customerStreet1,
    customerStreet2,
    customerCity,
    customerState,
    customerZip,
    customerCountry,
    customerEmail,
    customerPhone,
    length,
    width,
    height,
    weight,
    weightUnit = 'lb',
    dimensionUnit = 'in',
  } = params;

  try {
    const customerAddress = {
      name: customerName,
      street1: customerStreet1,
      street2: customerStreet2 ?? '',
      city: customerCity,
      state: customerState,
      zip: customerZip,
      country: customerCountry,
      email: customerEmail || 'returns@outlight.us',
      phone: customerPhone || '8653268763',
    };

    const parcel = {
      length: String(length),
      width: String(width),
      height: String(height),
      distance_unit: dimensionUnit,
      weight: String(weight),
      mass_unit: weightUnit,
    };

    // 1. Create shipments to BOTH warehouses in parallel — pick cheapest
    const shipmentPromises = RETURN_ADDRESSES.map(async (warehouse) => {
      const res = await fetch(`${SHIPPO_API}/shipments`, {
        method: 'POST',
        headers: shippoHeaders(),
        body: JSON.stringify({
          address_from: customerAddress,
          address_to: warehouse,
          parcels: [parcel],
          async: false,
        }),
      });

      if (!res.ok) {
        console.error(`[shippo.service] Shipment to ${warehouse.label} failed: ${res.status}`);
        return { warehouse, rates: [] as Array<{ object_id: string; provider: string; servicelevel: { name: string; token: string }; amount: string; currency: string; estimated_days: number | null }> };
      }

      const shipment = await res.json() as {
        object_id: string;
        rates: Array<{ object_id: string; provider: string; servicelevel: { name: string; token: string }; amount: string; currency: string; estimated_days: number | null }>;
      };

      return { warehouse, rates: shipment.rates ?? [] };
    });

    const shipmentResults = await Promise.all(shipmentPromises);

    // 2. Collect all rates across both warehouses
    const allRates: Array<{
      rateId: string;
      provider: string;
      servicelevel: string;
      amount: number;
      currency: string;
      warehouse: string;
      estimatedDays: number | null;
    }> = [];

    for (const result of shipmentResults) {
      for (const rate of result.rates) {
        allRates.push({
          rateId: rate.object_id,
          provider: rate.provider,
          servicelevel: rate.servicelevel.name,
          amount: parseFloat(rate.amount),
          currency: rate.currency,
          warehouse: result.warehouse.label,
          estimatedDays: rate.estimated_days,
        });
      }
    }

    if (allRates.length === 0) {
      return { success: false, error: 'No shipping rates available for this address/package combination' };
    }

    // 3. Pick the cheapest rate — prefer FedEx/UPS (skip USPS if it causes billing issues)
    // First try non-USPS carriers
    const nonUspsRates = allRates.filter(r => !r.provider.toLowerCase().includes('usps'));
    const ratePool = nonUspsRates.length > 0 ? nonUspsRates : allRates;
    ratePool.sort((a, b) => a.amount - b.amount);
    const best = ratePool[0];

    console.log(`[shippo.service] Best rate: $${best.amount.toFixed(2)} via ${best.provider} to ${best.warehouse} (${allRates.length} rates compared across ${RETURN_ADDRESSES.length} warehouses)`);

    const selectedRate = { object_id: best.rateId, provider: best.provider, amount: String(best.amount) };

    // 3. Purchase label (create transaction)
    const txRes = await fetch(`${SHIPPO_API}/transactions`, {
      method: 'POST',
      headers: shippoHeaders(),
      body: JSON.stringify({
        rate: selectedRate.object_id,
        label_file_type: 'PDF',
        async: false,
      }),
    });

    if (!txRes.ok) {
      const text = await txRes.text();
      console.error('[shippo.service] Transaction creation failed:', text);
      return { success: false, error: `Label purchase failed: ${txRes.status}` };
    }

    const tx = await txRes.json() as {
      status: string;
      label_url: string;
      tracking_number: string;
      tracking_url_provider: string;
      messages?: Array<{ text: string }>;
    };

    if (tx.status !== 'SUCCESS') {
      const msgs = (tx.messages ?? []).map((m) => m.text).join('; ');
      console.error('[shippo.service] Transaction not successful:', tx.status, msgs);
      return { success: false, error: `Label creation failed: ${msgs || tx.status}` };
    }

    console.log(`[shippo.service] Label created — tracking: ${tx.tracking_number}, carrier: ${selectedRate.provider}`);

    return {
      success: true,
      labelUrl: tx.label_url,
      trackingNumber: tx.tracking_number,
      trackingUrl: tx.tracking_url_provider,
      carrier: `${selectedRate.provider}`,
      rate: parseFloat(selectedRate.amount),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[shippo.service] createReturnLabel error:', message);
    return { success: false, error: message };
  }
}

// ── getPresetDimensions ───────────────────────────────────────────────────

export async function getPresetDimensions(
  sku: string,
  brandId: string
): Promise<PackageDimensions | null> {
  try {
    const { data, error } = await supabase
      .from('label_presets')
      .select('length, width, height, weight, weight_unit, dimension_unit')
      .eq('brand_id', brandId)
      .eq('sku', sku)
      .single();

    if (error || !data) return null;

    return {
      length: Number(data.length),
      width: Number(data.width),
      height: Number(data.height),
      weight: Number(data.weight),
      weight_unit: data.weight_unit ?? 'lb',
      dimension_unit: data.dimension_unit ?? 'in',
    };
  } catch (err) {
    console.error('[shippo.service] getPresetDimensions error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── validateAddress ───────────────────────────────────────────────────────

export async function validateAddress(address: {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}): Promise<AddressValidationResult> {
  try {
    const res = await fetch(`${SHIPPO_API}/addresses`, {
      method: 'POST',
      headers: shippoHeaders(),
      body: JSON.stringify({
        ...address,
        validate: true,
      }),
    });

    if (!res.ok) {
      return { valid: false, messages: [`Address API error: ${res.status}`] };
    }

    const data = await res.json() as {
      validation_results?: {
        is_valid: boolean;
        messages?: Array<{ code: string; source: string; text: string; type: string }>;
      };
    };

    const vr = data.validation_results;
    if (!vr) return { valid: true, messages: [] };

    return {
      valid: vr.is_valid,
      messages: (vr.messages ?? []).map((m) => m.text),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[shippo.service] validateAddress error:', message);
    return { valid: false, messages: [message] };
  }
}

// ── getShippingEstimate — rate check without purchasing a label ───────────

export async function getShippingEstimate(params: {
  customerStreet1?: string;
  customerCity: string;
  customerState: string;
  customerZip: string;
  customerCountry: string;
  length: number;
  width: number;
  height: number;
  weight: number;
}): Promise<{ cheapestRate: number | null; warehouse: string | null; carrier: string | null; allRates: Array<{ carrier: string; service: string; amount: number; warehouse: string; estimatedDays: number | null }> }> {
  try {
    const customerAddress = {
      name: 'Customer',
      street1: params.customerStreet1 || '123 Main St',
      city: params.customerCity,
      state: params.customerState,
      zip: params.customerZip,
      country: params.customerCountry,
    };

    const parcel = {
      length: String(params.length),
      width: String(params.width),
      height: String(params.height),
      distance_unit: 'in',
      weight: String(params.weight),
      mass_unit: 'lb',
    };

    // Get rates for both warehouses
    const results = await Promise.all(
      RETURN_ADDRESSES.map(async (warehouse) => {
        try {
          const res = await fetch(`${SHIPPO_API}/shipments`, {
            method: 'POST',
            headers: shippoHeaders(),
            body: JSON.stringify({
              address_from: customerAddress,
              address_to: warehouse,
              parcels: [parcel],
              async: false,
            }),
          });
          if (!res.ok) return { warehouse: warehouse.label, cheapest: null, rates: [] };
          const shipment = await res.json() as { rates: Array<{ amount: string; provider: string; servicelevel: { name: string }; estimated_days: number | null }> };
          const rates = shipment.rates ?? [];
          if (rates.length === 0) return { warehouse: warehouse.label, cheapest: null, rates: [] };
          const parsedRates = rates.map(r => ({ provider: r.provider, servicelevel: r.servicelevel?.name || '', amount: parseFloat(r.amount), estimatedDays: r.estimated_days }));
          const cheapest = parsedRates.reduce((best, r) => r.amount < best.amount ? r : best);
          return { warehouse: warehouse.label, cheapest: cheapest.amount, carrier: cheapest.provider, rates: parsedRates };
        } catch {
          return { warehouse: warehouse.label, cheapest: null, rates: [] };
        }
      })
    );

    // Collect ALL rates across both warehouses
    const allEstimateRates: Array<{ carrier: string; service: string; amount: number; warehouse: string; estimatedDays: number | null }> = [];
    for (const result of results) {
      if (!result.cheapest && result.cheapest !== 0) continue;
      const r = result as { warehouse: string; cheapest: number; carrier: string; rates?: Array<{ provider: string; servicelevel: string; amount: number; estimatedDays: number | null }> };
      if (r.rates) {
        for (const rate of r.rates) {
          allEstimateRates.push({ carrier: rate.provider, service: rate.servicelevel, amount: rate.amount, warehouse: r.warehouse, estimatedDays: rate.estimatedDays });
        }
      } else {
        allEstimateRates.push({ carrier: r.carrier, service: '', amount: r.cheapest, warehouse: r.warehouse, estimatedDays: null });
      }
    }
    allEstimateRates.sort((a, b) => a.amount - b.amount);

    // Pick cheapest across both
    const valid = results.filter(r => r.cheapest !== null) as Array<{ warehouse: string; cheapest: number; carrier: string }>;
    if (valid.length === 0) return { cheapestRate: null, warehouse: null, carrier: null, allRates: [] };

    valid.sort((a, b) => a.cheapest - b.cheapest);
    return { cheapestRate: valid[0].cheapest, warehouse: valid[0].warehouse, carrier: valid[0].carrier, allRates: allEstimateRates };
  } catch (err) {
    console.error('[shippo.service] getShippingEstimate error:', err instanceof Error ? err.message : err);
    return { cheapestRate: null, warehouse: null, carrier: null, allRates: [] };
  }
}
