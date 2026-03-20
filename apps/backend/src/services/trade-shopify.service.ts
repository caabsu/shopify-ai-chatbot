// Reuse the existing graphql helper from shopify-admin.service.ts
import { graphql as shopifyGraphQL } from './shopify-admin.service.js';

// ========== HELPERS ==========

/**
 * Normalize a catalog GID to use CompanyLocationCatalog type.
 * Shopify B2B catalogs must use gid://shopify/CompanyLocationCatalog/<id>,
 * not CompanyCatalog or plain Catalog.
 */
function normalizeCatalogGid(catalogId: string): string {
  // Extract numeric ID from any catalog GID format
  const match = catalogId.match(/(\d+)$/);
  if (!match) return catalogId;
  return `gid://shopify/CompanyLocationCatalog/${match[1]}`;
}

// ========== CUSTOMER OPERATIONS ==========

export async function findCustomerByEmail(
  email: string,
  brandId?: string
): Promise<{ id: string; tags: string[] } | null> {
  const data = await shopifyGraphQL<{
    customers: { edges: Array<{ node: { id: string; tags: string[] } }> };
  }>(
    `query($query: String!) {
      customers(first: 1, query: $query) {
        edges { node { id tags } }
      }
    }`,
    { query: `email:${email}` },
    brandId
  );

  const customer = data.customers.edges[0]?.node;
  return customer || null;
}

export async function createCustomer(
  input: { firstName: string; lastName: string; email: string; phone?: string },
  brandId?: string
): Promise<{ id: string }> {
  // Check if customer already exists first (handles retries)
  const existing = await findCustomerByEmail(input.email, brandId);
  if (existing) return { id: existing.id };

  const data = await shopifyGraphQL<{
    customerCreate: { customer: { id: string } | null; userErrors: Array<{ message: string; field: string[] }> };
  }>(
    `mutation($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`,
    {
      input: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        ...(input.phone ? { phone: input.phone } : {}),
      },
    },
    brandId
  );

  if (data.customerCreate.userErrors.length > 0) {
    throw new Error(`Customer creation failed: ${data.customerCreate.userErrors.map(e => e.message).join('; ')}`);
  }
  if (!data.customerCreate.customer) {
    throw new Error('Customer creation returned null');
  }
  return data.customerCreate.customer;
}

export async function updateCustomerTags(
  customerId: string,
  tags: string[],
  metafields: Array<{ namespace: string; key: string; value: string; type: string }>,
  brandId?: string
): Promise<void> {
  const data = await shopifyGraphQL<{
    customerUpdate: { customer: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(
    `mutation($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer { id }
        userErrors { message }
      }
    }`,
    {
      input: {
        id: customerId,
        tags,
        metafields: metafields.map((m) => ({
          namespace: m.namespace,
          key: m.key,
          value: m.value,
          type: m.type,
        })),
      },
    },
    brandId
  );

  if (data.customerUpdate.userErrors.length > 0) {
    throw new Error(`Customer update failed: ${data.customerUpdate.userErrors.map(e => e.message).join('; ')}`);
  }
}

export async function removeCustomerTags(
  customerId: string,
  tagsToRemove: string[],
  brandId?: string
): Promise<void> {
  await shopifyGraphQL(
    `mutation($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) {
        userErrors { message }
      }
    }`,
    { id: customerId, tags: tagsToRemove },
    brandId
  );
}

// ========== B2B COMPANY OPERATIONS ==========

export async function findCompanyByExternalId(
  externalId: string,
  brandId?: string
): Promise<{ companyId: string; locationId: string } | null> {
  const data = await shopifyGraphQL<{
    companies: { edges: Array<{ node: { id: string; locations: { edges: Array<{ node: { id: string } }> } } }> };
  }>(
    `query($query: String!) {
      companies(first: 1, query: $query) {
        edges { node { id locations(first: 1) { edges { node { id } } } } }
      }
    }`,
    { query: `external_id:${externalId}` },
    brandId
  );

  const company = data.companies.edges[0]?.node;
  if (!company) return null;

  const locationId = company.locations.edges[0]?.node.id;
  if (!locationId) return null;

  return { companyId: company.id, locationId };
}

export async function createCompany(
  input: { name: string; externalId: string; note?: string },
  brandId?: string
): Promise<{ companyId: string; locationId: string }> {
  // Check if company already exists (handles retries after partial failures)
  const existing = await findCompanyByExternalId(input.externalId, brandId);
  if (existing) return existing;

  const data = await shopifyGraphQL<{
    companyCreate: {
      company: { id: string; locations: { edges: Array<{ node: { id: string } }> } } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($input: CompanyCreateInput!) {
      companyCreate(input: $input) {
        company {
          id
          locations(first: 1) { edges { node { id } } }
        }
        userErrors { message }
      }
    }`,
    {
      input: {
        company: {
          name: input.name,
          externalId: input.externalId,
          note: input.note || '',
        },
      },
    },
    brandId
  );

  if (data.companyCreate.userErrors.length > 0) {
    throw new Error(`Company creation failed: ${data.companyCreate.userErrors.map(e => e.message).join('; ')}`);
  }
  const company = data.companyCreate.company;
  if (!company) throw new Error('Company creation returned null');

  const locationId = company.locations.edges[0]?.node.id;
  if (!locationId) throw new Error('Company created without default location');

  return { companyId: company.id, locationId };
}

/**
 * Assign a customer as a company contact.
 * Uses companyAssignCustomerAsContact which takes companyId and customerId as top-level args.
 * See: https://shopify.dev/docs/api/admin-graphql/latest/mutations/companyAssignCustomerAsContact
 */
export async function createCompanyContact(
  companyId: string,
  customerId: string,
  brandId?: string
): Promise<void> {
  const data = await shopifyGraphQL<{
    companyAssignCustomerAsContact: {
      companyContact: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($companyId: ID!, $customerId: ID!) {
      companyAssignCustomerAsContact(companyId: $companyId, customerId: $customerId) {
        companyContact { id }
        userErrors { message }
      }
    }`,
    {
      companyId,
      customerId,
    },
    brandId
  );

  if (data.companyAssignCustomerAsContact.userErrors.length > 0) {
    const errors = data.companyAssignCustomerAsContact.userErrors.map(e => e.message).join('; ');
    // "already a contact" is not a real error on retries
    if (errors.toLowerCase().includes('already')) {
      console.log(`[trade-shopify] Customer already a contact of company, continuing.`);
      return;
    }
    throw new Error(`Contact creation failed: ${errors}`);
  }
}

/**
 * Assign a catalog to a company location.
 * Uses catalogContextUpdate with contextsToAdd.companyLocationIds.
 * The catalogId MUST be gid://shopify/CompanyLocationCatalog/<id>.
 * See: https://shopify.dev/docs/api/admin-graphql/latest/mutations/catalogContextUpdate
 */
export async function assignCatalogToLocation(
  catalogId: string,
  locationId: string,
  brandId?: string
): Promise<void> {
  const normalizedCatalogId = normalizeCatalogGid(catalogId);

  const data = await shopifyGraphQL<{
    catalogContextUpdate: {
      catalog: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation catalogContextUpdate($catalogId: ID!, $contextsToAdd: CatalogContextInput) {
      catalogContextUpdate(catalogId: $catalogId, contextsToAdd: $contextsToAdd) {
        catalog { id }
        userErrors { field message }
      }
    }`,
    {
      catalogId: normalizedCatalogId,
      contextsToAdd: {
        companyLocationIds: [locationId],
      },
    },
    brandId
  );

  if (data.catalogContextUpdate.userErrors.length > 0) {
    const errors = data.catalogContextUpdate.userErrors.map(e => `${e.field?.join('.')}: ${e.message}`).join('; ');
    // "already associated" is not a real error on retries
    if (errors.toLowerCase().includes('already')) {
      console.log(`[trade-shopify] Catalog already assigned to location, continuing.`);
      return;
    }
    throw new Error(`Catalog assignment failed: ${errors}`);
  }
}

export async function removeCatalogFromLocation(
  catalogId: string,
  locationId: string,
  brandId?: string
): Promise<void> {
  const normalizedCatalogId = normalizeCatalogGid(catalogId);

  const data = await shopifyGraphQL<{
    catalogContextUpdate: {
      catalog: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation catalogContextUpdate($catalogId: ID!, $contextsToRemove: CatalogContextInput) {
      catalogContextUpdate(catalogId: $catalogId, contextsToRemove: $contextsToRemove) {
        catalog { id }
        userErrors { field message }
      }
    }`,
    {
      catalogId: normalizedCatalogId,
      contextsToRemove: {
        companyLocationIds: [locationId],
      },
    },
    brandId
  );

  if (data.catalogContextUpdate.userErrors.length > 0) {
    console.error('[trade-shopify] removeCatalogFromLocation error:', data.catalogContextUpdate.userErrors[0].message);
  }
}

// ========== SEND CUSTOMER ACCOUNT INVITE ==========

export async function sendAccountInvite(customerId: string, brandId?: string): Promise<void> {
  await shopifyGraphQL(
    `mutation($id: ID!) {
      customerSendAccountInviteEmail(customerId: $id) {
        customer { id }
        userErrors { message }
      }
    }`,
    { id: customerId },
    brandId
  );
}
