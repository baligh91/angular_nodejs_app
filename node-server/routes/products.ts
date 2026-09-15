import express from 'express';
import { database } from '../config/database.js';

const router = express.Router();

type ProductRow = {
  id: number;
  name: string;
  category: string;
  reference: string;
  stock: number;
  price: number;
  status: string;
};

router.get('/', (_request, response) => {
  database.query(
    'SELECT id, name, category, reference, stock, price, status FROM products ORDER BY id DESC',
    (error, results) => {
      if (error) {
        response.status(500).json({ message: 'Impossible de récupérer les produits.' });
        return;
      }

      response.json(results as ProductRow[]);
    },
  );
});

router.post('/', (request, response) => {
  const { name, category, reference, stock, price } = request.body as Record<string, unknown>;

  if (
    typeof name !== 'string' ||
    typeof category !== 'string' ||
    typeof reference !== 'string' ||
    typeof stock !== 'number' ||
    typeof price !== 'number' ||
    stock < 0 ||
    price < 0
  ) {
    response.status(400).json({ message: 'Les données du produit sont invalides.' });
    return;
  }

  const status = stock === 0 ? 'Rupture' : stock <= 3 ? 'Stock faible' : 'Disponible';

  database.query(
    'INSERT INTO products (name, category, reference, stock, price, status) VALUES (?, ?, ?, ?, ?, ?)',
    [name, category, reference, stock, price, status],
    (error, result) => {
      if (error) {
        const databaseError = error as Error & { code?: string };
        const statusCode = databaseError.code === 'ER_DUP_ENTRY' ? 409 : 500;
        response.status(statusCode).json({
          message: statusCode === 409 ? 'Cette référence existe déjà.' : 'Impossible d’ajouter le produit.',
        });
        return;
      }

      response.status(201).json({
        id: (result as { insertId: number }).insertId,
        name,
        category,
        reference,
        stock,
        price,
        status,
      });
    },
  );
});

export default router;
