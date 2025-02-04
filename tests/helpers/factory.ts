import { faker } from '@faker-js/faker';

export const factory = {
  tenantName: (): string => faker.company.name(),
  apiKey: (): string => faker.string.alphanumeric(32),
  url: (): string => `https://${faker.internet.domainName()}/hooks`,
  eventType: (): string => `${faker.word.noun()}.${faker.word.verb()}`,
};
