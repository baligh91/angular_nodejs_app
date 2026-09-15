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

  // Lecture publique du signal, sans accès direct à set() ou update().
  readonly products = this.productState.asReadonly();

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

  async addProduct(product: NewProduct): Promise<void> {
    if (!this.productsService) {
      return;
    }

    const savedProduct = await firstValueFrom(this.productsService.createProduct(product));

    this.productState.update((products) => [...products, savedProduct]);
  }
}
