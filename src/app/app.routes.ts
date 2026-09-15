import { Routes } from '@angular/router';
import { ProductsList } from './products-list/products-list';
import { AddProduct } from './add-product/add-product';
import { Home } from './home/home';


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
	}
];
