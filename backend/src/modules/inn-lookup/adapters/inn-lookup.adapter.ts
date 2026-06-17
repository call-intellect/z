export type InnPayerType = 'legal_entity' | 'individual_entrepreneur' | 'self_employed';

export interface InnLookupResult {
  source: 'mock' | 'dadata' | 'tochka';
  payerType: InnPayerType;
  legalName: string;
  inn: string;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  directorName?: string | null;
  bankBik?: string | null;
  bankAccount?: string | null;
}

export interface InnLookupAdapter {
  readonly name: 'mock' | 'dadata' | 'tochka';
  lookup(inn: string): Promise<InnLookupResult | null>;
}
