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
    'SELECT * FROM products ORDER BY id DESC',
    (error, results) => {
      if (error) {
        response.status(500).json({ message: 'Impossible de récupérer les produits.' });
        return;
      }

      const products = results as ProductRow[];
      response.json(products);
    },
  );
});

router.get('/:reference', (_request, response) => {
  database.query(
    'SELECT * FROM products WHERE reference = ? ',
    [ _request.params['reference'] ],
    (error, results) => {
      if (error) {
        response.status(500).json({ message: 'Impossible de récupérer les produits.' });
        return;
      }

      const product = (results as ProductRow[])[0];

      if (!product) {
        response.status(404).json({ message: 'Produit introuvable.' });
        return;
      }

      response.json(product);
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

router.put('/:reference', (request, response) => {
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
    'UPDATE products SET name = ?, category = ?, reference = ?, stock = ?, price = ?, status = ? WHERE reference = ?',
    [name, category, reference, stock, price, status, request.params['reference']],
    (error, result) => {
      if (error) {
        response.status(500).json({ message: 'Impossible de modifier le produit.' });
        return;
      }

      if ((result as { affectedRows: number }).affectedRows === 0) {
        response.status(404).json({ message: 'Produit introuvable.' });
        return;
      }

      response.json({ name, category, reference, stock, price, status });
    },
  );
});

router.delete('/:reference', (request, response) => {
  database.query(
    'DELETE FROM products WHERE reference = ?',
    [request.params['reference']],
    (error, result) => {
      if (error) {
        response.status(500).json({ message: 'Impossible de supprimer le produit.' });
        return;
      }

      if ((result as { affectedRows: number }).affectedRows === 0) {
        response.status(404).json({ message: 'Produit introuvable.' });
        return;
      }

      response.sendStatus(204);
    },
  );
});

export default router;
