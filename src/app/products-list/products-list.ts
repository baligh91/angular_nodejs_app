import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ProductCategory } from '../models/product.model';
import { ProductsStore } from '../services/products.store';

@Component({
  standalone: true,
  selector: 'app-products-list',
  imports: [CurrencyPipe, FormsModule, RouterLink],
  templateUrl: './products-list.html',
  styleUrl: './products-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsList {
  private readonly productsStore = inject(ProductsStore);
  // Signal modifiable contenant le texte saisi dans la recherche.
  protected readonly searchTerm = signal('');

  // Signal modifiable contenant la catégorie sélectionnée.
  protected readonly selectedCategory = signal<'Toutes' | ProductCategory>('Toutes');

  // Signal contenant la source des produits affichés dans le tableau.
  protected readonly products = this.productsStore.products;

  // Valeur dérivée : Angular recalcule la liste quand un signal utilisé change.
  protected readonly filteredProducts = computed(() => {
    // Lire un signal avec () crée automatiquement une dépendance réactive.
    const query = this.searchTerm().trim().toLowerCase();
    const category = this.selectedCategory() ;

    return this.products().filter((product) => {
      const matchesQuery = !query || [product.name, product.reference, product.category]
        .some((value) => value.toLowerCase().includes(query));
      const matchesCategory = category === 'Toutes' || product.category === category;

      return matchesQuery && matchesCategory;
    });
  });

  // Valeur dérivée : total du stock recalculé si la liste des produits change.
  protected readonly totalStock = computed(() =>
    this.products().reduce((total, product) => total + product.stock, 0),
  );

  protected resetFilters(): void {
    // set() modifie les signaux et déclenche la mise à jour du template.
    this.searchTerm.set('');
    this.selectedCategory.set('Toutes');
  }
}
