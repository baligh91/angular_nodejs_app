import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProductsStore } from '../../services/products.store';

@Component({
  standalone: true,
  selector: 'app-product',
  imports: [CurrencyPipe, FormsModule, RouterLink],
  templateUrl: './product.html',
  styleUrl: './product.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductDetails {
  private readonly productsStore = inject(ProductsStore);
  private readonly route = inject(ActivatedRoute);
  protected readonly product = this.productsStore.singleProduct;
  protected readonly recipientEmail = signal('');
  protected readonly mailtoLink = computed(() => {
    const product = this.product();
    const recipient = this.recipientEmail().trim();

    if (!product || !recipient) {
      return null;
    }

    const subject = `Produit disponible : ${product.name}`;
    const body = [
      'Bonjour,',
      '',
      `Nous vous proposons le produit suivant : ${product.name}.`,
      `Catégorie : ${product.category}`,
      `Référence : ${product.reference}`,
      `Prix unitaire : ${product.price.toLocaleString('fr-FR')} EUR`,
      `Disponibilité : ${product.status} (${product.stock} en stock).`,
      '',
      'Cordialement,',
    ].join('\n');

    return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  constructor() {
    const reference = this.route.snapshot.paramMap.get('reference');

    if (reference) {
      void this.loadProduct(reference);
    }
  }

  private async loadProduct(reference: string): Promise<void> {
    await this.productsStore.loadProduct(reference);
  }
}
