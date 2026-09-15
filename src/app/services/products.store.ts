import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NewProduct, Product } from '../models/product.model';
import { firstValueFrom } from 'rxjs';
import { ProductsService } from './products.service';

// Service partagé entre le formulaire d'ajout et la liste des produits.
@Injectable({ providedIn: 'root' })
export class ProductsStore {
  private readonly productsService = inject(ProductsService, { optional: true });
  private readonly platformId = inject(PLATFORM_ID);

  // Etat privé : les composants ne peuvent pas modifier directement la liste.
  private readonly productState = signal<readonly Product[]>([]);

  private readonly singleProductState = signal<Product | null>(null);


  // Lecture publique du signal, sans accès direct à set() ou update().
  readonly products = this.productState.asReadonly();
  readonly singleProduct = this.singleProductState.asReadonly();
  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      void this.loadProducts();
    }
  }

  private async loadProducts(): Promise<void> {
    if (!this.productsService) {
      return;
    }

    try {
      const products = await firstValueFrom(this.productsService.getProducts());
      this.productState.set(products);
    } catch (error) {
      console.error('Impossible de charger les produits.', error);
    }
  }

  async loadProduct(reference: string): Promise<void> {
    if (!this.productsService) {
      return;
    }

    try {
      const response = await firstValueFrom(this.productsService.getProduct(reference));
      const product = Array.isArray(response) ? response[0] : response;

      if (!product) {
        throw new Error('Produit introuvable.');
      }

      this.singleProductState.set(product);
    } catch (error) {
      console.error('Impossible de charger le produit.', error);
    }
  }

  async addProduct(product: NewProduct): Promise<void> {
    if (!this.productsService) {
      return;
    }

    const savedProduct = await firstValueFrom(this.productsService.createProduct(product));

    this.productState.update((products) => [...products, savedProduct]);
  }

  async updateProduct(previousReference: string, product: NewProduct): Promise<void> {
    if (!this.productsService) {
      return;
    }

    const updatedProduct = await firstValueFrom(
      this.productsService.updateProduct(previousReference, product),
    );
    this.productState.update((products) => products.map((currentProduct) =>
      currentProduct.reference === previousReference ? updatedProduct : currentProduct,
    ));
  }

  async deleteProduct(reference: string): Promise<void> {
    if (!this.productsService) {
      return;
    }

    await firstValueFrom(this.productsService.deleteProduct(reference));
    this.productState.update((products) =>
      products.filter((product) => product.reference !== reference),
    );
  }
}
