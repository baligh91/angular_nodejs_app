export type ProductCategory = 'Ordinateurs' | 'Écrans' | 'Accessoires';
export type ProductStatus = 'Disponible' | 'Stock faible' | 'Rupture';

export interface Product {
  readonly name: string;
  readonly category: ProductCategory;
  readonly reference: string;
  readonly stock: number;
  readonly price: number;
  readonly status: ProductStatus;
}

export type NewProduct = Omit<Product, 'status'>;
