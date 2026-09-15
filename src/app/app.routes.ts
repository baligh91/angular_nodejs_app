import { Routes } from '@angular/router';
import { ProductsList } from './products-list/products-list';
import { AddProduct } from './add-product/add-product';
import { Home } from './home/home';
import { ProductDetails } from './products-list/product/product';


export const routes: Routes = [
	{
		path: '',
		component: Home,
	},
	{
		path: 'products-list',
		component: ProductsList,
	},
    {
		path: 'add-product',
		component: AddProduct,
	},
    {
		path: 'product/:reference',
		component: ProductDetails,
	}
];
