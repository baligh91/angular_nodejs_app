import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NewProduct, Product, ProductCategory } from '../models/product.model';
import { ProductsStore } from '../services/products.store';

@Component({
  selector: 'app-add-product',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './add-product.html',
  styleUrl: './add-product.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddProduct {
  private readonly formBuilder = inject(FormBuilder);
  private readonly productsStore = inject(ProductsStore);
  private readonly router = inject(Router);
  public readonly productToEdit = this.router.getCurrentNavigation()?.extras.state?.['product'] as Product | undefined;

  protected readonly categories: readonly ProductCategory[] = [
    'Ordinateurs',
    'Écrans',
    'Accessoires',
  ];

  protected readonly productForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    category: ['Ordinateurs' as ProductCategory, Validators.required],
    reference: ['', [Validators.required, Validators.minLength(3)]],
    stock: [0, [Validators.required, Validators.min(0)]],
    price: [0, [Validators.required, Validators.min(0.01)]],
  });

  constructor() {
    if (this.productToEdit) {
      this.productForm.setValue({
        name: this.productToEdit.name,
        category: this.productToEdit.category,
        reference: this.productToEdit.reference,
        stock: this.productToEdit.stock,
        price: this.productToEdit.price,
      });
    }
  }

  protected async submit(): Promise<void> {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }

    const product = this.productForm.getRawValue() as NewProduct;

    if (this.productToEdit) {
      await this.productsStore.updateProduct(this.productToEdit.reference, product);
    } else {
      await this.productsStore.addProduct(product);
    }

    void this.router.navigate(['/products-list']);
  }
}
