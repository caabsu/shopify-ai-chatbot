// Reuse the existing graphql helper from shopify-admin.service.ts
import { graphql as shopifyGraphQL } from './shopify-admin.service.js';

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
  const data = await shopifyGraphQL<{
    customerCreate: { customer: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(
    `mutation($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { message }
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
    throw new Error(`Customer creation failed: ${data.customerCreate.userErrors[0].message}`);
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
  await shopifyGraphQL(
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

export async function createCompany(
  input: { name: string; externalId: string; note?: string },
  brandId?: string
): Promise<{ companyId: string; locationId: string }> {
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
    throw new Error(`Company creation failed: ${data.companyCreate.userErrors[0].message}`);
  }
  const company = data.companyCreate.company;
  if (!company) throw new Error('Company creation returned null');

  const locationId = company.locations.edges[0]?.node.id;
  if (!locationId) throw new Error('Company created without default location');

  return { companyId: company.id, locationId };
}

export async function createCompanyContact(
  companyId: string,
  customerId: string,
  brandId?: string
): Promise<void> {
  const data = await shopifyGraphQL<{
    companyAssignCustomerAsContact: { companyContact: { id: string } | null; userErrors: Array<{ message: string }> };
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
    throw new Error(`Contact creation failed: ${data.companyAssignCustomerAsContact.userErrors[0].message}`);
  }
}

export async function assignCatalogToLocation(
  catalogId: string,
  locationId: string,
  brandId?: string
): Promise<void> {
  const data = await shopifyGraphQL<{
    catalogContextUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($catalogId: ID!, $contextsToAdd: [CatalogContextInput!]!) {
      catalogContextUpdate(catalogId: $catalogId, contextsToAdd: $contextsToAdd) {
        userErrors { message }
      }
    }`,
    {
      catalogId,
      contextsToAdd: [{ companyLocationId: locationId }],
    },
    brandId
  );

  if (data.catalogContextUpdate.userErrors.length > 0) {
    throw new Error(`Catalog assignment failed: ${data.catalogContextUpdate.userErrors[0].message}`);
  }
}

export async function removeCatalogFromLocation(
  catalogId: string,
  locationId: string,
  brandId?: string
): Promise<void> {
  const data = await shopifyGraphQL<{
    catalogContextUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($catalogId: ID!, $contextsToRemove: [CatalogContextInput!]!) {
      catalogContextUpdate(catalogId: $catalogId, contextsToRemove: $contextsToRemove) {
        userErrors { message }
      }
    }`,
    {
      catalogId,
      contextsToRemove: [{ companyLocationId: locationId }],
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
