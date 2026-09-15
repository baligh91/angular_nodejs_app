import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { NewProduct, Product } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://localhost:3000/api/products';

  getProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(this.apiUrl);
  }

  createProduct(product: NewProduct): Observable<Product> {
    return this.http.post<Product>(this.apiUrl, product);
  }

  updateProduct(previousReference: string, product: NewProduct): Observable<Product> {
    return this.http.put<Product>(`${this.apiUrl}/${encodeURIComponent(previousReference)}`, product);
  }

  deleteProduct(reference: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${encodeURIComponent(reference)}`);
  }
  
  getProduct(reference: string): Observable<Product> {
    return this.http.get<Product>(`${this.apiUrl}/${encodeURIComponent(reference)}`);
  }
}
